// The connection trial: step 2 of docs/multi-device-plan.md. One device
// hosts, others join by QR code or link. Guests ping the host to estimate
// the clock offset, and every device plays clicks and songs on the host's
// timeline. Not part of the game.

import { AudioEngine } from '../js/audio.js';
import { clockSample, driftRate, estimateOffset, recentSamples, toLocalTime } from '../js/clock.js';
import { Peer } from '../js/peer.js';
import { drawCode, scanCode } from '../js/qr.js';
import { fromBase64url, parseDescription } from '../js/signal.js';
import { resolveSong } from '../js/song.js';

const PING_INTERVAL = 250;
const ESTIMATE_INTERVAL = 1000;
// Seconds of pings an estimate is made from.
const ESTIMATE_WINDOW = 20;
// Seconds between points on the chart, and kept for the drift.
const HISTORY_INTERVAL = 5;
const TICK_INTERVAL = 25;
// Clicks are scheduled this far ahead, in seconds. Far enough that a
// browser running timers only once a second, as in a background tab, still
// schedules every click in time.
const CLICK_AHEAD = 1.2;
// Seconds from the tap to the song's first count-in beat.
const SONG_LEAD = 1.5;

const $ = (id) => document.getElementById(id);

class TrialAudio extends AudioEngine {
  // Like startSong, with every part on autoplay and the song's start given
  // on this device's clock.
  startSongAt(song, songStart) {
    this.stopSong();
    this.songStart = songStart;
    const now = this.context.currentTime;
    for (const beat of song.countIn.clicks) {
      const time = songStart + beat * song.secondsPerBeat;
      if (time > now) {
        this.click(time);
      }
    }
    this.queue = song.parts
      .flatMap((part) => part.notes.map((note) => ({ note, sound: part.sound })))
      .sort((a, b) => a.note.start - b.note.start);
    this.queueIndex = 0;
    while (this.queueIndex < this.queue.length && songStart + this.queue[this.queueIndex].note.start < now) {
      this.queueIndex++;
    }
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_INTERVAL);
  }
}

let audio = null;
let role = null;
let songs = [];
let clockSource = '—';
// How far the context's render clock runs ahead of what is heard, smoothed.
let lead = null;
let clicksOn = false;
let nextClick = null;
// The first few clicks after the clicks start are logged, to check their
// timing on a device.
let clicksToLog = 0;
let waitingLogged = false;
let wakeLock = null;

// Host
const guests = [];
let invite = null;
let scanner = null;

// Guest
let hostPeer = null;
let hostLead = 0;
let samples = [];
let offsetHistory = [];
let estimate = null;
let firstOffset = null;
let joinedAt = null;
let lastHistory = -Infinity;

function log(text) {
  const item = document.createElement('li');
  item.textContent = `${new Date().toLocaleTimeString()} ${text}`;
  const list = $('log');
  list.append(item);
  list.scrollTop = list.scrollHeight;
}

function ms(seconds, digits = 1) {
  return seconds === null || seconds === undefined || Number.isNaN(seconds) ? '—' : `${(seconds * 1000).toFixed(digits)} ms`;
}

// ---- Clocks

// This device's clock: the context time of the sound leaving the speaker
// now. A note scheduled at context time T is heard when this reads T. See
// AudioEngine.audibleTime for how the output latency is allowed for.
function audibleNow() {
  const stamped = audio.context.getOutputTimestamp?.()?.contextTime > 0;
  clockSource = stamped
    ? `getOutputTimestamp, less ${ms(audio.missingLatency())} it leaves out`
    : 'currentTime less the reported latency';
  return audio.audibleTime(performance.now());
}

function updateLead() {
  if (audio.context.state !== 'running') {
    return;
  }
  const value = audio.context.currentTime - audibleNow();
  lead = lead === null ? value : lead * 0.95 + value * 0.05;
}

// Host time minus this device's, for scheduling. Without allowing for
// output latency, the offset is the one between the render clocks, as if
// both devices had pinged with currentTime.
function scheduleOffset() {
  if (role === 'host') {
    return 0;
  }
  if (!estimate) {
    return null;
  }
  return $('latency-on').checked ? estimate.offset : estimate.offset + hostLead - (lead ?? 0);
}

// ---- Audio

// Called during a user gesture. As in the game, the page plays like a music
// player, so iOS does not mute it in silent mode.
function startAudio() {
  if (navigator.audioSession) {
    navigator.audioSession.type = 'playback';
  }
  if (!audio) {
    audio = new TrialAudio();
    setInterval(tick, TICK_INTERVAL);
    setInterval(showAudio, 1000);
  }
  audio.resume().then(applySound);
}

function applySound() {
  audio.fadeMaster($('sound-on').checked ? 1 : 0);
}

function tick() {
  updateLead();
  if (clicksOn) {
    scheduleClicks();
  }
}

// A click on every whole second of the host's clock.
function scheduleClicks() {
  const offset = scheduleOffset();
  if (offset === null) {
    if (!waitingLogged) {
      waitingLogged = true;
      log('The clicks wait for a clock estimate.');
    }
    return;
  }
  const now = audio.context.currentTime;
  let second = nextClick ?? Math.ceil(now + offset + 0.05);
  while (toLocalTime(second, offset) < now + CLICK_AHEAD) {
    const at = toLocalTime(second, offset);
    if (at > now) {
      audio.click(at);
    }
    if (clicksToLog > 0) {
      clicksToLog--;
      log(`Click for host second ${second}: ${at > now ? 'scheduled' : 'skipped, too late'} at context time ${at.toFixed(3)}, now ${now.toFixed(3)}, heard time ${audibleNow().toFixed(3)}, offset ${ms(offset)}, audio ${audio.context.state}.`);
    }
    second++;
  }
  nextClick = second;
}

function setClicks(on) {
  clicksOn = on;
  nextClick = null;
  clicksToLog = on ? 3 : 0;
  waitingLogged = false;
  $('clicks-button').textContent = on ? 'Stop the clicks' : 'Start the clicks';
  log(on ? 'Clicks on.' : 'Clicks off.');
}

function playSong(file, hostStart) {
  const entry = songs.find((candidate) => candidate.file === file);
  if (!entry) {
    log(`No song ${file} on this device.`);
    return;
  }
  const offset = scheduleOffset();
  if (offset === null) {
    log('No clock estimate yet, so the song cannot start here.');
    return;
  }
  clicksOn = false;
  nextClick = null;
  $('clicks-button').textContent = 'Start the clicks';
  audio.startSongAt(entry.song, toLocalTime(hostStart, offset));
  log(`Playing ${entry.song.title}.`);
}

function stopSong() {
  audio.stopSong();
  log('Song stopped.');
}

function showAudio() {
  const stamp = audio.context.getOutputTimestamp?.();
  const stampText = stamp ? `output timestamp ${stamp.contextTime?.toFixed(3)} at ${stamp.performanceTime?.toFixed(1)} ms` : 'no output timestamp';
  $('audio-state').textContent = `${audio.context.state}, ${audio.context.sampleRate} Hz; context time ${audio.context.currentTime.toFixed(3)}, heard time ${audibleNow().toFixed(3)}; ${stampText}; performance.now ${performance.now().toFixed(1)} ms`;
  const output = audio.context.outputLatency;
  $('audio-latency').textContent = `${ms(audio.reportedLatency())} (output ${output === undefined ? 'not reported' : ms(output)}, base ${ms(audio.context.baseLatency)}); timestamp lead ${ms(audio.stampLead)}, measured lead ${ms(lead)}`;
  $('audio-clock').textContent = clockSource;
}

async function loadSongs() {
  try {
    const files = await fetch('../songs/index.json').then((response) => response.json());
    songs = await Promise.all(files.map(async (file) => ({
      file,
      song: resolveSong(await fetch(`../songs/${file}`).then((response) => response.json())),
    })));
    $('song-select').replaceChildren(...songs.map(({ file, song }) => new Option(song.title, file)));
  } catch (error) {
    log(`Could not load the songs: ${error.message}`);
  }
}

// ---- Shared

async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Not allowed now. Tried again when the page is shown.
  }
}

// Browsers leave an mDNS candidate's address out of the stats, so it is
// found by its port in the description.
function describeCandidate(candidate, description) {
  if (!candidate) {
    return '?';
  }
  let address = candidate.address;
  if (!address && description) {
    address = parseDescription(description.sdp).candidates.find(({ port }) => port === candidate.port)?.address;
  }
  address ||= '(hidden)';
  const kind = address.endsWith('.local') ? 'mDNS name' : 'IP address';
  return `${address}:${candidate.port} ${candidate.protocol ?? ''} ${candidate.type ?? ''} (${kind})`;
}

async function describeSelected(peer) {
  const selected = await peer.selectedCandidates().catch(() => null);
  if (!selected) {
    return '—';
  }
  const { localDescription, remoteDescription } = peer.connection;
  return `this device ${describeCandidate(selected.local, localDescription)}; other ${describeCandidate(selected.remote, remoteDescription)}`;
}

function offeredCandidates(peer) {
  const { candidates } = parseDescription(peer.connection.localDescription.sdp);
  return candidates.map(({ address, port }) => `${address}:${port}`).join(', ') || 'none';
}

// The packed data from a link, a fragment or the data alone.
function extractData(text) {
  const trimmed = text.trim();
  const match = /(?:join|reply)=([A-Za-z0-9_-]+)/.exec(trimmed);
  if (match) {
    return match[1];
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

async function copyText(textarea) {
  textarea.hidden = false;
  try {
    await navigator.clipboard.writeText(textarea.value);
    log('Copied.');
  } catch {
    textarea.select();
    log(document.execCommand('copy') ? 'Copied.' : 'Could not copy. Select the text and copy it.');
  }
}

function offerShare(button, data) {
  if (!navigator.share) {
    return;
  }
  button.hidden = false;
  button.onclick = () => navigator.share(data).catch(() => {});
}

function showCode(canvas, sizeElement, text, packed, extra = '') {
  const code = drawCode(canvas, text);
  sizeElement.textContent = `${fromBase64url(packed).length} bytes packed, ${text.length} characters, QR version ${code.version}.${extra}`;
}

function rawDescriptions() {
  const peers = role === 'host' ? [...guests.map((guest) => guest.peer), ...(invite ? [invite] : [])] : [hostPeer];
  return JSON.stringify({
    userAgent: navigator.userAgent,
    role,
    descriptions: peers.filter(Boolean).map((peer) => ({
      local: peer.connection.localDescription,
      remote: peer.connection.remoteDescription,
    })),
  }, null, 2);
}

// ---- Host

async function startHost() {
  role = 'host';
  startAudio();
  keepAwake();
  $('start').hidden = true;
  $('host').hidden = false;
  $('sound').hidden = false;
  $('latency-on').disabled = true;
  $('latency-on').parentElement.title = 'Makes no difference on the host. Turn it off on a guest.';
  log('Hosting.');
  await newInvite();
}

async function newInvite() {
  $('invite-button').hidden = true;
  invite = await Peer.host();
  const link = `${location.origin}${location.pathname}#join=${invite.packed}`;
  $('invite').hidden = false;
  $('invite-text').value = link;
  $('reply-input').value = '';
  showCode($('invite-code'), $('invite-size'), link, invite.packed, ` Candidates: ${offeredCandidates(invite)}.`);
  offerShare($('invite-share'), { url: link });
  log(`Code ready for guest ${guests.length + 1}. Candidates: ${offeredCandidates(invite)}.`);
}

async function acceptReply(text) {
  const data = extractData(text);
  if (!data || !invite) {
    log('That is not a reply code.');
    return;
  }
  const peer = invite;
  try {
    await peer.acceptAnswer(data);
  } catch (error) {
    log(`Could not use the reply: ${error.message}`);
    return;
  }
  invite = null;
  $('invite').hidden = true;
  $('invite-button').hidden = false;
  addGuest(peer);
}

function addGuest(peer) {
  const guest = { peer, number: guests.length + 1, report: null, userAgent: '', candidates: '—', item: document.createElement('li') };
  guests.push(guest);
  $('guests').append(guest.item);
  $('no-guests').hidden = true;
  log(`Guest ${guest.number}: reply accepted.`);
  peer.onstatechange = async (state) => {
    log(`Guest ${guest.number}: ${state}.`);
    if (state === 'open') {
      peer.send({ type: 'clicks', on: clicksOn });
      guest.candidates = await describeSelected(peer);
      log(`Guest ${guest.number}: ${guest.candidates}.`);
    }
    showGuest(guest);
  };
  peer.onmessage = (message) => {
    if (message.type === 'ping') {
      peer.send({ type: 'pong', t0: message.t0, th: audibleNow(), lead: lead ?? 0, running: audio.context.state === 'running' });
    } else if (message.type === 'report') {
      guest.report = message;
      showGuest(guest);
    } else if (message.type === 'hello') {
      guest.userAgent = message.userAgent;
    }
  };
  showGuest(guest);
}

function showGuest(guest) {
  const report = guest.report;
  const clock = report
    ? `offset ${ms(report.offset)}, fastest round trip ${ms(report.rtt)}, median ${ms(report.median)}, change ${ms(report.change, 2)}, drift ${report.drift === null ? '—' : `${(report.drift * 1e6).toFixed(1)} ppm`}`
    : 'no clock estimate yet';
  guest.item.replaceChildren(
    Object.assign(document.createElement('strong'), { textContent: `Guest ${guest.number}: ${guest.peer.state}` }),
    document.createElement('br'),
    `Candidates: ${guest.candidates}`,
    document.createElement('br'),
    `Clock: ${clock}`,
    document.createElement('br'),
    Object.assign(document.createElement('span'), { className: 'small', textContent: guest.userAgent }),
  );
}

function broadcast(message) {
  for (const guest of guests) {
    guest.peer.send(message);
  }
}

async function startScan() {
  $('scan-video').hidden = false;
  $('scan-stop').hidden = false;
  $('scan-button').disabled = true;
  scanner = scanCode($('scan-video'));
  try {
    const text = await scanner.result;
    if (text) {
      log('Read a code.');
      await acceptReply(text);
    }
  } catch (error) {
    log(`Camera: ${error.message}`);
  } finally {
    stopScan();
  }
}

function stopScan() {
  scanner?.stop();
  scanner = null;
  $('scan-video').hidden = true;
  $('scan-stop').hidden = true;
  $('scan-button').disabled = false;
}

// ---- Guest

async function join(data) {
  role = 'guest';
  startAudio();
  keepAwake();
  $('start').hidden = true;
  $('join-link').hidden = true;
  $('guest').hidden = false;
  $('sound').hidden = false;
  log('Joining.');
  try {
    hostPeer = await Peer.join(data);
  } catch (error) {
    log(`Could not join: ${error.message}`);
    $('guest-state').textContent = 'could not join';
    return;
  }
  $('reply').hidden = false;
  $('reply-text').value = hostPeer.packed;
  showCode($('reply-code'), $('reply-size'), hostPeer.packed, hostPeer.packed, ` Candidates: ${offeredCandidates(hostPeer)}.`);
  offerShare($('reply-share'), { text: hostPeer.packed });
  log(`Reply ready. Candidates: ${offeredCandidates(hostPeer)}.`);
  $('guest-state').textContent = hostPeer.state;
  hostPeer.onstatechange = async (state) => {
    log(`Host: ${state}.`);
    $('guest-state').textContent = state;
    if (state === 'open') {
      $('reply').hidden = true;
      joinedAt = null;
      hostPeer.send({ type: 'hello', userAgent: navigator.userAgent });
      const candidates = await describeSelected(hostPeer);
      $('guest-candidates').textContent = candidates;
      log(candidates);
    }
  };
  hostPeer.onmessage = guestMessage;
  setInterval(ping, PING_INTERVAL);
  setInterval(updateEstimate, ESTIMATE_INTERVAL);
}

function ping() {
  if (hostPeer.state === 'open' && audio.context.state === 'running') {
    hostPeer.send({ type: 'ping', t0: audibleNow() });
  }
}

function guestMessage(message) {
  if (message.type === 'pong') {
    if (!message.running || audio.context.state !== 'running') {
      return;
    }
    samples.push(clockSample(message.t0, message.th, audibleNow()));
    hostLead = message.lead;
  } else if (message.type === 'clicks') {
    setClicks(message.on);
  } else if (message.type === 'song') {
    playSong(message.file, message.start);
  } else if (message.type === 'stop') {
    stopSong();
  }
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function updateEstimate() {
  if (audio.context.state !== 'running') {
    return;
  }
  const now = audibleNow();
  samples = recentSamples(samples, now, ESTIMATE_WINDOW * 3);
  const recent = recentSamples(samples, now, ESTIMATE_WINDOW);
  estimate = estimateOffset(recent);
  if (!estimate) {
    return;
  }
  joinedAt ??= now;
  firstOffset ??= estimate.offset;
  if (now - lastHistory >= HISTORY_INTERVAL) {
    lastHistory = now;
    offsetHistory.push({ time: now - joinedAt, offset: estimate.offset });
  }
  const drift = driftRate(offsetHistory);
  const medianRtt = median(recent.map((sample) => sample.rtt));
  const change = estimate.offset - firstOffset;
  $('clock-offset').textContent = `${ms(estimate.offset)} ± ${ms(estimate.spread)}${$('latency-on').checked ? '' : ` (used: ${ms(scheduleOffset())})`}`;
  $('clock-rtt').textContent = ms(estimate.rtt);
  $('clock-median').textContent = ms(medianRtt);
  $('clock-change').textContent = ms(change, 2);
  $('clock-drift').textContent = drift === null ? '—' : `${(drift * 1e6).toFixed(1)} ppm, ${ms(drift * 180)} over three minutes`;
  $('clock-count').textContent = `${recent.length} in the last ${ESTIMATE_WINDOW} s, the fastest ${estimate.count} used`;
  drawChart();
  hostPeer.send({ type: 'report', offset: estimate.offset, rtt: estimate.rtt, median: medianRtt, change, drift });
}

function drawChart() {
  const canvas = $('clock-chart');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  const context = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const width = canvas.width;
  const height = canvas.height;
  const points = offsetHistory.map(({ time, offset }) => ({ x: time / 60, y: (offset - firstOffset) * 1000 }));
  const maxX = Math.max(1, ...points.map((point) => point.x));
  const maxY = Math.max(2, ...points.map((point) => Math.abs(point.y)));
  const x = (value) => (value / maxX) * (width - 8 * ratio) + 4 * ratio;
  const y = (value) => height / 2 - (value / maxY) * (height / 2 - 14 * ratio);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = style.getPropertyValue('--border');
  context.lineWidth = ratio;
  context.beginPath();
  context.moveTo(0, y(0));
  context.lineTo(width, y(0));
  context.stroke();
  context.fillStyle = style.getPropertyValue('--muted');
  context.font = `${11 * ratio}px system-ui, sans-serif`;
  context.fillText(`+${maxY.toFixed(1)} ms`, 4 * ratio, 11 * ratio);
  context.fillText(`−${maxY.toFixed(1)} ms`, 4 * ratio, height - 3 * ratio);
  const label = `${maxX.toFixed(1)} min`;
  context.fillText(label, width - context.measureText(label).width - 4 * ratio, y(0) - 4 * ratio);
  context.strokeStyle = style.getPropertyValue('--accent');
  context.lineWidth = 2 * ratio;
  context.beginPath();
  points.forEach((point, index) => (index === 0 ? context.moveTo(x(point.x), y(point.y)) : context.lineTo(x(point.x), y(point.y))));
  context.stroke();
}

// ---- Wiring

$('host-button').addEventListener('click', startHost);
$('join-manual-button').addEventListener('click', () => {
  $('join-manual').hidden = false;
  $('join-input').focus();
});
$('join-input-button').addEventListener('click', () => {
  const data = extractData($('join-input').value);
  if (data) {
    join(data);
  } else {
    log('That is not a host link or code.');
  }
});
$('invite-copy').addEventListener('click', () => copyText($('invite-text')));
$('reply-copy').addEventListener('click', () => copyText($('reply-text')));
$('invite-button').addEventListener('click', newInvite);
$('scan-button').addEventListener('click', startScan);
$('scan-stop').addEventListener('click', stopScan);
$('reply-button').addEventListener('click', () => acceptReply($('reply-input').value));
$('clicks-button').addEventListener('click', () => {
  setClicks(!clicksOn);
  broadcast({ type: 'clicks', on: clicksOn });
});
$('song-button').addEventListener('click', () => {
  const file = $('song-select').value;
  const entry = songs.find((candidate) => candidate.file === file);
  if (!entry) {
    return;
  }
  const { song } = entry;
  const start = audio.context.currentTime + SONG_LEAD + song.countIn.beats * song.secondsPerBeat;
  broadcast({ type: 'song', file, start });
  playSong(file, start);
});
$('song-stop').addEventListener('click', () => {
  broadcast({ type: 'stop' });
  stopSong();
});
$('sound-on').addEventListener('change', () => audio && applySound());
$('latency-on').addEventListener('change', () => {
  nextClick = null;
  log($('latency-on').checked ? 'Allowing for output latency.' : 'Not allowing for output latency.');
});
$('test-sound').addEventListener('click', () => {
  if (!audio) {
    startAudio();
  }
  const at = audio.context.currentTime + 0.05;
  audio.click(at);
  log(`Test click at context time ${at.toFixed(3)}, audio ${audio.context.state}, master gain ${audio.master.gain.value.toFixed(2)}.`);
});
$('raw-button').addEventListener('click', () => {
  $('raw-text').value = rawDescriptions();
  copyText($('raw-text'));
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && role) {
    keepAwake();
  }
});
// iOS can suspend the audio when the page is hidden. Any tap resumes it.
document.addEventListener('pointerdown', () => {
  if (audio && audio.context.state !== 'running') {
    audio.resume().then(applySound);
  }
});

// Errors are shown in the log, since phones have no console to hand.
window.addEventListener('error', (event) => log(`Error: ${event.message}`));
window.addEventListener('unhandledrejection', (event) => log(`Error: ${event.reason?.message ?? event.reason}`));

loadSongs();

// A guest who opens the host's link. The fragment is cleared, so that
// reloading does not try to join again.
const joinData = location.hash.startsWith('#join=') ? extractData(location.hash) : null;
if (joinData) {
  history.replaceState(null, '', location.pathname + location.search);
  $('start').hidden = true;
  $('join-link').hidden = false;
  $('join-link-button').addEventListener('click', () => join(joinData));
} else if (location.hash) {
  log('The link holds no valid code.');
}
log(window.isSecureContext ? 'Secure context: the camera can be used.' : 'Not a secure context: the camera cannot be used here. Use the links.');
