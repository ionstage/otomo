// Playing together: hosting a group, joining one, and the lobby between
// songs. The host's side is on the setup screen, and a guest has a screen
// of its own. See section 9 of docs/design.md and steps 3 and 4 of
// docs/multi-device-plan.md.
//
// The host keeps the lobby (lobby.js) and sends it to every guest whenever
// it changes. Guests send their taps to the host.
//
// From the host: welcome (the guest's number), lobby, pong, start, stop
// (the host quit the song) and end. From a guest: song, choose, ping,
// synced and leave.

import { clockSample, estimateOffset, recentSamples, toLocalTime } from './clock.js';
import {
  addLobbyPlayer,
  allReady,
  choose,
  chooseSong,
  createLobby,
  finishSong,
  isReady,
  removeLobbyPlayer,
  startSong,
  takenParts,
} from './lobby.js';
import { Peer } from './peer.js';
import { drawCode, scanCode } from './qr.js';
import { addPlayer, createRoster, playerName, removePlayer } from './roster.js';
import { findPackedText } from './signal.js';

// How long the host waits, after reading a player's code, for the
// connection to open.
const OPEN_TIMEOUT = 20000;

// Guests ping the host this often, in milliseconds, once their audio runs,
// and keep pinging during the song.
const PING_INTERVAL = 100;
// The offset is estimated from the pings of this many seconds.
const CLOCK_WINDOW = 20;
// A guest is ready to start once it has this many pings.
const CLOCK_SAMPLES = 8;
// The host sends the count-in's start this far ahead, in seconds, so that
// it reaches every guest in time.
const START_LEAD = 1;
// During a song, a guest retimes it to the latest offset this often, in
// milliseconds.
const RETIME_INTERVAL = 1000;

const CONNECT_HELP = 'Both devices need to be on the same Wi-Fi. Some guest and public Wi-Fi keeps '
  + 'devices apart, and a phone’s hotspot usually works instead. On a Mac, the browser also needs '
  + 'permission in System Settings › Privacy & Security › Local Network.';

const HOST = 1;

const $ = (id) => document.getElementById(id);

export class Group {
  // show(name) switches to a screen: "setup" or "guest".
  // songs() lists { file, song } for the loaded songs.
  // startAudio() creates or resumes the audio engine, during a tap, and
  // returns it. audio() returns it, or null before the first tap.
  // onStart({ file, partIndex, difficulty, takenParts, devices,
  // countInStart }) starts this device's song, with the count-in at
  // countInStart on its audio clock. onRetime(countInStart) moves it there
  // for drift. onStop() ends it when the host quits.
  constructor({ show, songs, startAudio, audio, onStart, onRetime, onStop }) {
    this.show = show;
    this.songs = songs;
    this.startAudio = startAudio;
    this.audio = audio;
    this.onStart = onStart;
    this.onRetime = onRetime;
    this.onStop = onStop;
    this.role = null;
    this.wakeLock = null;
    this.reset();

    $('host-button').addEventListener('click', () => this.host());
    $('join-button').addEventListener('click', () => {
      $('join-paste').hidden = false;
      $('join-input').focus();
    });
    $('join-input-button').addEventListener('click', () => {
      const data = findPackedText($('join-input').value);
      if (data) {
        this.join(data);
      } else {
        this.message('That is not a link from a host.');
      }
    });
    $('add-player-button').addEventListener('click', () => this.invite());
    $('end-group-button').addEventListener('click', () => this.end());
    $('invite-copy').addEventListener('click', () => copyText($('invite-text')));
    $('invite-cancel').addEventListener('click', () => this.cancelInvite());
    $('scan-button').addEventListener('click', () => this.scan());
    $('scan-stop').addEventListener('click', () => this.stopScan());
    $('reply-button').addEventListener('click', () => this.acceptReply($('reply-input').value));
    $('reply-copy').addEventListener('click', () => copyText($('reply-text')));
    $('leave-button').addEventListener('click', () => this.leave());

    // Every tap in the lobby starts the audio, which also lets a guest's
    // clock sync begin.
    $('song-buttons').addEventListener('click', (event) => {
      const button = event.target.closest('[data-file]');
      if (button) {
        this.tap();
        this.act({ type: 'song', song: button.dataset.file });
      }
    });
    $('part-buttons').addEventListener('click', (event) => {
      const button = event.target.closest('[data-part]');
      if (button) {
        this.tap();
        this.act({ type: 'choose', part: Number(button.dataset.part) });
      }
    });
    $('difficulty-buttons').addEventListener('click', (event) => {
      const button = event.target.closest('[data-difficulty]');
      if (button) {
        this.tap();
        this.act({ type: 'choose', difficulty: button.dataset.difficulty });
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.role) {
        this.keepAwake();
      }
    });
    // The camera needs a secure context, which a phone reaching a
    // development server on the local network does not have.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      $('scan-button').hidden = true;
    }
    this.lobbyHome = { parent: $('lobby').parentElement, before: $('lobby').nextElementSibling };
  }

  reset() {
    clearInterval(this.pinger);
    this.pinger = null;
    this.stopRetiming();
    this.roster = null;
    this.lobby = null;
    // Host: the joined players' connections by number, those still
    // connecting, and the players whose clocks are synced.
    this.guests = new Map();
    this.connecting = new Set();
    this.synced = new Set();
    this.pending = null;
    this.scanner = null;
    // Guest: the connection to the host, this player's number and the
    // clock samples.
    this.peer = null;
    this.number = null;
    this.samples = [];
    this.syncSent = false;
  }

  // In a group, or was until the connection was lost and the player has
  // not yet gone back.
  get active() {
    return this.role !== null;
  }

  // The screen to go back to after a song.
  get homeScreen() {
    return this.role === 'guest' ? 'guest' : 'setup';
  }

  get me() {
    return this.role === 'host' ? HOST : this.number;
  }

  // Joins from a host's link (#join=…), if the page was opened from one.
  // The fragment is cleared, so that reloading does not join again.
  // Returns whether it is joining.
  openJoinLink() {
    if (!location.hash.startsWith('#join=')) {
      return false;
    }
    const data = findPackedText(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (!data) {
      this.message('That link has no code in it. Ask the host for a fresh one.');
      return false;
    }
    this.join(data);
    return true;
  }

  // Called as any song starts. The host's code is shown only between songs.
  songStarting() {
    this.cancelInvite();
  }

  // Called when this device's song ends or its player quits. After the
  // host's song, the turn passes on.
  songEnded() {
    this.stopRetiming();
    if (this.role === 'host' && this.lobby?.phase === 'playing') {
      this.setLobby(finishSong(this.lobby));
    }
  }

  // The host's Quit ends the song for everyone.
  quitSong() {
    if (this.role === 'host') {
      this.sendAll({ type: 'stop' });
    }
    this.songEnded();
  }

  message(text) {
    $(this.role === 'guest' ? 'guest-message' : 'together-message').textContent = text;
  }

  async keepAwake() {
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      // Not allowed now. Tried again when the page is shown.
    }
  }

  releaseWake() {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  // Every tap in the lobby starts the audio. Some browsers report it
  // running only a moment later, so the host checks again then whether the
  // song can start.
  tap() {
    const audio = this.startAudio();
    if (!this.listening) {
      this.listening = true;
      audio.context.addEventListener('statechange', () => {
        if (this.role === 'host') {
          this.maybeStart();
        }
      });
    }
  }

  // A tap in the lobby. The host applies it, and a guest sends it.
  act(action) {
    if (this.role === 'host') {
      this.apply(HOST, action);
    } else {
      this.peer?.send(action);
    }
  }

  // ---- Host

  host() {
    this.role = 'host';
    this.roster = createRoster();
    this.lobby = createLobby([HOST]);
    this.message('');
    $('together-start').hidden = true;
    $('group').hidden = false;
    $('setup-form').hidden = true;
    document.querySelector('#setup .help').hidden = true;
    this.placeLobby(this.lobbyHome.parent, this.lobbyHome.before);
    this.keepAwake();
    this.render();
  }

  // The host applies a player's tap to the lobby.
  apply(number, action) {
    if (action.type === 'song') {
      const entry = this.songs().find(({ file }) => file === action.song);
      if (entry) {
        this.setLobby(chooseSong(this.lobby, number, entry.file, entry.song.parts.length));
      }
    } else if (action.type === 'choose') {
      const choice = {};
      if (Number.isInteger(action.part)) {
        choice.part = action.part;
      }
      if (typeof action.difficulty === 'string') {
        choice.difficulty = action.difficulty;
      }
      this.setLobby(choose(this.lobby, number, choice));
    }
  }

  setLobby(lobby) {
    if (lobby === this.lobby) {
      return;
    }
    this.lobby = lobby;
    this.sendAll({ type: 'lobby', lobby });
    this.render();
    this.maybeStart();
  }

  // The song starts as soon as every player is ready and every guest's
  // clock is synced.
  maybeStart() {
    const audio = this.audio();
    if (!this.lobby || !allReady(this.lobby) || audio?.context.state !== 'running') {
      return;
    }
    if (!this.lobby.players.every((number) => number === HOST || this.synced.has(number))) {
      return;
    }
    const lobby = startSong(this.lobby);
    const at = audio.audibleTime(performance.now()) + START_LEAD;
    this.lobby = lobby;
    this.sendAll({ type: 'lobby', lobby });
    this.sendAll({ type: 'start', at });
    this.render();
    this.startHere(at);
  }

  // Starts this device's part of the song, with the count-in at `at` on
  // this device's clock.
  startHere(at) {
    const choice = this.lobby.choices[this.me];
    if (!choice) {
      return;
    }
    this.onStart({
      file: this.lobby.song,
      partIndex: choice.part,
      difficulty: choice.difficulty,
      takenParts: takenParts(this.lobby),
      devices: this.lobby.players.length,
      countInStart: at,
    });
  }

  sendAll(message) {
    for (const peer of this.guests.values()) {
      peer.send(message);
    }
  }

  async invite() {
    this.message('');
    $('group-buttons').hidden = true;
    let peer;
    try {
      peer = await Peer.host();
    } catch (error) {
      $('group-buttons').hidden = false;
      this.message(`Could not make a code. ${error.message}`);
      return;
    }
    if (this.role !== 'host') {
      peer.close();
      return;
    }
    this.pending = peer;
    const link = `${location.origin}${location.pathname}#join=${peer.packed}`;
    $('invite').hidden = false;
    $('invite-text').value = link;
    $('invite-text').hidden = true;
    $('reply-input').value = '';
    drawCode($('invite-code'), link);
    offerShare($('invite-share'), { url: link });
  }

  cancelInvite() {
    this.stopScan();
    this.pending?.close();
    this.pending = null;
    $('invite').hidden = true;
    $('group-buttons').hidden = this.role !== 'host';
  }

  async scan() {
    $('scan-video').hidden = false;
    $('scan-stop').hidden = false;
    $('scan-button').disabled = true;
    this.scanner = scanCode($('scan-video'));
    try {
      const text = await this.scanner.result;
      if (text) {
        this.stopScan();
        await this.acceptReply(text);
      }
    } catch (error) {
      this.message(`Could not use the camera. ${error.message}`);
    } finally {
      this.stopScan();
    }
  }

  stopScan() {
    this.scanner?.stop();
    this.scanner = null;
    $('scan-video').hidden = true;
    $('scan-stop').hidden = true;
    $('scan-button').disabled = false;
  }

  async acceptReply(text) {
    const data = findPackedText(text);
    const peer = this.pending;
    if (!peer) {
      return;
    }
    if (!data) {
      this.message('That is not a code from a player’s device.');
      return;
    }
    try {
      await peer.acceptAnswer(data);
    } catch {
      this.message('That code did not work. Check it is the one the new player’s device shows.');
      return;
    }
    this.pending = null;
    $('invite').hidden = true;
    $('group-buttons').hidden = false;
    this.message('');
    this.connecting.add(peer);
    this.render();

    let number = null;
    const failed = () => {
      this.connecting.delete(peer);
      peer.close();
      this.message(`Could not connect to the new player. ${CONNECT_HELP}`);
      this.render();
    };
    const timer = setTimeout(() => {
      if (number === null) {
        failed();
      }
    }, OPEN_TIMEOUT);
    peer.onstatechange = (state) => {
      if (this.role !== 'host') {
        return;
      }
      if (state === 'open' && number === null) {
        clearTimeout(timer);
        this.connecting.delete(peer);
        ({ roster: this.roster, number } = addPlayer(this.roster));
        this.guests.set(number, peer);
        peer.send({ type: 'welcome', number });
        this.setLobby(addLobbyPlayer(this.lobby, number));
        peer.send({ type: 'lobby', lobby: this.lobby });
      } else if (state !== 'open' && number !== null) {
        this.removeGuest(number);
      } else if (state === 'failed' && number === null) {
        clearTimeout(timer);
        failed();
      }
    };
    peer.onmessage = (message) => {
      if (number === null) {
        return;
      }
      if (message.type === 'ping') {
        const audio = this.audio();
        peer.send({
          type: 'pong',
          t0: message.t0,
          th: audio ? audio.audibleTime(performance.now()) : 0,
          running: audio?.context.state === 'running',
        });
      } else if (message.type === 'synced') {
        this.synced.add(number);
        this.maybeStart();
      } else if (message.type === 'leave') {
        this.removeGuest(number);
      } else {
        this.apply(number, message);
      }
    };
  }

  removeGuest(number) {
    const peer = this.guests.get(number);
    if (!peer) {
      return;
    }
    this.guests.delete(number);
    this.synced.delete(number);
    peer.onstatechange = null;
    peer.close();
    this.roster = removePlayer(this.roster, number);
    this.setLobby(removeLobbyPlayer(this.lobby, number));
  }

  end() {
    this.cancelInvite();
    for (const peer of [...this.guests.values(), ...this.connecting]) {
      peer.onstatechange = null;
      peer.send({ type: 'end' });
      // Closing at once can drop the message before it is sent.
      setTimeout(() => peer.close(), 200);
    }
    this.role = null;
    this.reset();
    this.releaseWake();
    this.message('');
    $('group').hidden = true;
    $('together-start').hidden = false;
    $('lobby').hidden = true;
    $('setup-form').hidden = false;
    document.querySelector('#setup .help').hidden = false;
  }

  // ---- Guest

  async join(data) {
    this.role = 'guest';
    this.show('guest');
    $('guest-reply').hidden = true;
    $('guest-message').textContent = '';
    $('leave-button').textContent = 'Leave';
    this.placeLobby($('guest-lobby'), null);
    $('lobby').hidden = true;
    this.status('Getting ready…');
    this.keepAwake();
    let peer;
    try {
      peer = await Peer.join(data);
    } catch {
      this.lost('That link did not work. Ask the host to add a player again, for a fresh code.');
      return;
    }
    if (this.role !== 'guest') {
      peer.close();
      return;
    }
    this.peer = peer;
    $('guest-reply').hidden = false;
    $('reply-text').value = peer.packed;
    $('reply-text').hidden = true;
    drawCode($('reply-code'), peer.packed);
    offerShare($('reply-share'), { text: peer.packed });
    this.status('Waiting for the host to scan this code.');

    let opened = false;
    let timer = null;
    peer.onstatechange = (state) => {
      if (this.peer !== peer) {
        return;
      }
      if (state === 'open') {
        opened = true;
        clearTimeout(timer);
        $('guest-reply').hidden = true;
        $('guest-message').textContent = '';
        this.status('Joined.');
        this.pinger = setInterval(() => this.ping(), PING_INTERVAL);
      } else if (opened) {
        this.lost('Lost the connection to the host. To join again, scan the host’s code again.');
      } else if (state === 'connecting' && timer === null) {
        timer = setTimeout(() => this.message(`Could not connect to the host yet. ${CONNECT_HELP}`), OPEN_TIMEOUT);
      } else if (state === 'failed') {
        clearTimeout(timer);
        this.lost(`Could not connect to the host. ${CONNECT_HELP}`);
      }
    };
    peer.onmessage = (message) => this.hostMessage(message);
  }

  hostMessage(message) {
    if (message.type === 'welcome') {
      this.number = message.number;
      this.status(`You are ${playerName(this.number)}.`);
      this.render();
    } else if (message.type === 'lobby') {
      this.lobby = message.lobby;
      this.render();
    } else if (message.type === 'pong') {
      this.pong(message);
    } else if (message.type === 'start') {
      this.startFromHost(message.at);
    } else if (message.type === 'stop') {
      this.stopRetiming();
      this.onStop();
    } else if (message.type === 'end') {
      this.lost('The host ended the group.');
    }
  }

  ping() {
    const audio = this.audio();
    if (this.peer?.state === 'open' && audio?.context.state === 'running') {
      this.peer.send({ type: 'ping', t0: audio.audibleTime(performance.now()) });
    }
  }

  pong({ t0, th, running }) {
    const audio = this.audio();
    if (!running || audio?.context.state !== 'running') {
      return;
    }
    const t1 = audio.audibleTime(performance.now());
    this.samples.push(clockSample(t0, th, t1));
    this.samples = recentSamples(this.samples, t1, CLOCK_WINDOW);
    if (!this.syncSent && this.samples.length >= CLOCK_SAMPLES) {
      this.syncSent = true;
      this.peer.send({ type: 'synced' });
    }
  }

  // The host's time minus this device's, or null without pings.
  offset() {
    const audio = this.audio();
    if (!audio) {
      return null;
    }
    const now = audio.audibleTime(performance.now());
    return estimateOffset(recentSamples(this.samples, now, CLOCK_WINDOW))?.offset ?? null;
  }

  startFromHost(at) {
    const offset = this.offset();
    if (offset === null || !this.lobby || this.lobby.phase !== 'playing') {
      return;
    }
    this.startHere(toLocalTime(at, offset));
    // The clocks drift apart during the song, so it follows the latest
    // offset.
    this.stopRetiming();
    this.retimer = setInterval(() => {
      const latest = this.offset();
      if (latest !== null) {
        this.onRetime(toLocalTime(at, latest));
      }
    }, RETIME_INTERVAL);
  }

  stopRetiming() {
    clearInterval(this.retimer);
    this.retimer = null;
  }

  status(text) {
    $('guest-status').textContent = text;
  }

  // The connection has ended. The guest's screen says why, and Back goes
  // back. A song being played plays on to the end, and the guest's screen
  // is shown after it.
  lost(text) {
    const peer = this.peer;
    this.peer = null;
    if (peer) {
      peer.onstatechange = null;
      peer.close();
    }
    clearInterval(this.pinger);
    this.pinger = null;
    // A song being played plays on, on this device's own clock.
    this.stopRetiming();
    this.lobby = null;
    $('lobby').hidden = true;
    $('guest-reply').hidden = true;
    this.status('');
    this.message(text);
    $('leave-button').textContent = 'Back';
    this.releaseWake();
  }

  leave() {
    if (this.peer) {
      this.peer.send({ type: 'leave' });
      const peer = this.peer;
      this.peer = null;
      peer.onstatechange = null;
      // Closing at once can drop the message before it is sent.
      setTimeout(() => peer.close(), 200);
    }
    this.role = null;
    this.reset();
    this.releaseWake();
    $('guest-message').textContent = '';
    $('lobby').hidden = true;
    this.placeLobby(this.lobbyHome.parent, this.lobbyHome.before);
    this.show('setup');
  }

  // ---- The lobby, on either side

  placeLobby(parent, before) {
    parent.insertBefore($('lobby'), before);
  }

  render() {
    const lobby = this.lobby;
    const me = this.me;
    if (!lobby || me === null || me === undefined) {
      $('lobby').hidden = true;
      return;
    }
    $('lobby').hidden = false;
    const entry = this.songs().find(({ file }) => file === lobby.song);
    const chooserName = lobby.chooser === me ? 'you' : playerName(lobby.chooser);
    const inSong = lobby.players.includes(me);

    $('song-buttons').hidden = !(lobby.phase === 'song' && lobby.chooser === me);
    $('lobby-parts').hidden = !(lobby.phase === 'parts' && inSong);
    let status = '';
    if (lobby.phase === 'song') {
      if (lobby.chooser === me) {
        $('lobby-title').textContent = 'Your turn to choose the song';
        $('song-buttons').replaceChildren(...this.songs().map(({ file, song }) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.file = file;
          button.textContent = song.title;
          return button;
        }));
      } else {
        $('lobby-title').textContent = `${playerName(lobby.chooser)} is choosing the song…`;
      }
    } else {
      $('lobby-title').textContent = `${entry?.song.title ?? lobby.song} · chosen by ${chooserName}`;
    }
    if (lobby.phase === 'parts' && inSong) {
      const choice = lobby.choices[me] ?? {};
      $('part-buttons').replaceChildren(...(entry?.song.parts ?? []).map((part, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.part = index;
        button.textContent = part.name;
        button.setAttribute('aria-pressed', String(choice.part === index));
        return button;
      }));
      for (const button of $('difficulty-buttons').querySelectorAll('[data-difficulty]')) {
        button.setAttribute('aria-pressed', String(choice.difficulty === button.dataset.difficulty));
      }
      if (allReady(lobby)) {
        status = 'Starting…';
      } else if (isReady(lobby, me)) {
        status = 'Ready. The song starts when everyone has chosen. You can still change.';
      } else {
        status = 'Choose your part and your difficulty.';
      }
    } else if (lobby.phase === 'playing') {
      status = 'A song is playing. You join in from the next one.';
    }
    $('lobby-status').textContent = status;

    const items = lobby.players.map((number) => {
      const item = document.createElement('li');
      const labels = [number === me ? 'you' : null, number === HOST ? 'host' : null].filter(Boolean);
      item.textContent = playerName(number) + (labels.length ? ` (${labels.join(', ')})` : '');
      let state = '';
      if (lobby.phase === 'song' && number === lobby.chooser) {
        state = 'choosing the song';
      } else if (lobby.phase === 'parts') {
        state = isReady(lobby, number)
          ? `ready · ${entry?.song.parts[lobby.choices[number].part]?.name ?? ''}`
          : 'choosing';
      }
      if (state) {
        item.append(' ', Object.assign(document.createElement('span'), { className: 'ready', textContent: `— ${state}` }));
      }
      return item;
    });
    for (let i = 0; i < this.connecting.size; i++) {
      items.push(Object.assign(document.createElement('li'), { className: 'note', textContent: 'Connecting…' }));
    }
    $('lobby-players').replaceChildren(...items);
  }
}

async function copyText(textarea) {
  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    // Without the clipboard, as on plain HTTP, the text is shown to copy by
    // hand.
    textarea.hidden = false;
    textarea.select();
  }
}

function offerShare(button, data) {
  if (!navigator.share) {
    return;
  }
  button.hidden = false;
  button.onclick = () => navigator.share(data).catch(() => {});
}
