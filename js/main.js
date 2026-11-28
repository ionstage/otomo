// Wires the screens together: setup, play and result, and a guest's screen
// when playing together.

import { AudioEngine } from './audio.js';
import { Group } from './group.js';
import { Input } from './input.js';
import { LATE_MODIFIER_WINDOW, createJudge, pressPitch } from './judge.js';
import { autoplayShare } from './mix.js';
import { buttonPitchName } from './pitch.js';
import { Roll } from './roll.js';
import { positionAt, resolveSong } from './song.js';

// Time after the last bar before the result screen, so the last notes can
// finish sounding.
const END_DELAY = 0.5;

const screens = {
  setup: document.getElementById('setup'),
  guest: document.getElementById('guest'),
  play: document.getElementById('play'),
  result: document.getElementById('result'),
};
const setupForm = document.getElementById('setup-form');
const songSelect = document.getElementById('song-select');
const partSelect = document.getElementById('part-select');
const setupMessage = document.getElementById('setup-message');
const playSong = document.getElementById('play-song');
const playPart = document.getElementById('play-part');
const noteButtons = [...document.querySelectorAll('[data-button]')];
const modifierArea = document.querySelector('.modifiers');
const modifierButtons = [...modifierArea.querySelectorAll('[data-modifier]')];
const bothLabel = modifierArea.querySelector('.both');
const scoreText = document.getElementById('score');
const resultTitle = document.getElementById('result-title');
const quitDialog = document.getElementById('quit-dialog');

const roll = new Roll(document.getElementById('roll'), document.getElementById('play-title'));
// The buttons are no wider than the roll's rows, so their edges line up.
const controls = document.querySelector('.controls');
roll.onLayout = (width) => controls.style.setProperty('--row-width', `${width}px`);
const input = new Input({
  noteButtons,
  modifierArea,
  onPress: handlePress,
  onRelease: handleRelease,
  onModifiers: handleModifiers,
  onChange: showLit,
});

let songs = [];
// The loaded songs with their file names, by which devices in a group
// name a song.
let songEntries = [];
let audio = null;
let game = null;
let lastSettings = null;
const group = new Group({
  show,
  songs: () => songEntries,
  startAudio,
  audio: () => audio,
  onStart: startGroupSong,
  onRetime: (countInStart) => audio?.retime(countInStart),
  onStop: stopGroupSong,
  onNote: playOtherNote,
});
// With several devices, the other players' sounding notes, by player.
const otherVoices = new Map();

function show(name) {
  for (const [key, element] of Object.entries(screens)) {
    element.hidden = key !== name;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function loadSongs() {
  let files;
  try {
    files = await fetchJson('songs/index.json');
  } catch (error) {
    setupMessage.textContent = `Could not load the song list. ${error.message}`;
    return;
  }
  const loaded = await Promise.all(files.map(async (file) => {
    try {
      return { file, song: resolveSong(await fetchJson(`songs/${file}`)) };
    } catch (error) {
      return { file, error };
    }
  }));
  songEntries = loaded.filter((entry) => entry.song);
  songs = songEntries.map((entry) => entry.song);
  const errors = loaded.filter((entry) => entry.error);
  setupMessage.textContent = errors.map((entry) => `${entry.file}: ${entry.error.message}`).join('\n');
  songSelect.replaceChildren(...songs.map((song, index) => new Option(song.title, index)));
  showParts();
}

function showParts() {
  const song = songs[songSelect.value];
  partSelect.replaceChildren(...(song ? song.parts.map((part, index) => new Option(part.name, index)) : []));
}

// The audio context must be created and resumed during a user gesture.
function startAudio() {
  if (navigator.audioSession) {
    navigator.audioSession.type = 'playback';
  }
  audio ??= new AudioEngine();
  audio.resume();
  return audio;
}

// Alone, every other part is autoplayed and the count-in starts now. In a
// group (`together`), the parts nobody has taken are autoplayed, turned
// down for the number of devices, and the count-in starts when the host
// said.
function startGame({ song, partIndex, difficulty, autoplay, countInStart, devices = 1, together = false }) {
  const part = song.parts[partIndex];
  lastSettings = { song, partIndex, difficulty };
  group.songStarting();
  game = {
    song,
    part,
    difficulty,
    judge: createJudge(part.notes, difficulty),
    voice: null,
    held: null,
    shownPosition: null,
    frame: 0,
    paused: false,
    together,
    confirming: false,
  };
  otherVoices.clear();
  playSong.textContent = song.title;
  playPart.textContent = part.name;
  screens.play.dataset.difficulty = difficulty;
  for (const button of modifierButtons) {
    button.disabled = difficulty !== 'advanced';
  }
  show('play');
  roll.setPart(song, part, difficulty);
  input.enable(difficulty === 'advanced');
  audio.startSong(song, autoplay ?? song.parts.filter((other) => other !== part), countInStart, autoplayShare(devices));
  game.frame = requestAnimationFrame(frame);
}

function frame() {
  const time = audio.songTime();
  game.judge.update(time);
  roll.draw(time, game.judge.states);
  showPitchNames(time);
  if (time >= game.song.length + END_DELAY) {
    finishGame(time);
    return;
  }
  game.frame = requestAnimationFrame(frame);
}

function stopGame() {
  cancelAnimationFrame(game.frame);
  input.disable();
  game.voice?.release();
  audio.stopSong();
  game = null;
}

const QUIT_TEXT = {
  alone: { question: 'Quit this song?', confirm: 'Quit' },
  guest: { question: 'Leave this song? The others play on.', confirm: 'Leave the song' },
  host: { question: 'End this song for everyone?', confirm: 'End the song' },
};

function askToQuit(kind) {
  document.getElementById('quit-dialog-title').textContent = QUIT_TEXT[kind].question;
  document.getElementById('confirm-quit-button').textContent = QUIT_TEXT[kind].confirm;
  quitDialog.showModal();
}

// Quit pauses the song and asks for confirmation. Disabling input first
// releases any held note while the song time is still running, so its
// duration stops counting at the pause.
//
// With several devices nothing pauses: the question is asked with the
// music playing, and the song carries on behind it.
function pauseGame() {
  if (!game || game.paused || game.confirming) {
    return;
  }
  if (game.together) {
    game.confirming = true;
    input.disable();
    askToQuit(group.role === 'host' ? 'host' : 'guest');
    return;
  }
  game.paused = true;
  input.disable();
  cancelAnimationFrame(game.frame);
  audio.pause();
  askToQuit('alone');
}

// Carries on from exactly where the song paused, with no count-in.
// Called from the user gesture, which resuming audio needs.
async function resumeGame() {
  quitDialog.close();
  if (game?.confirming) {
    game.confirming = false;
    input.enable(game.difficulty === 'advanced');
    return;
  }
  if (!game?.paused) {
    return;
  }
  game.paused = false;
  const resumed = game;
  await audio.resume();
  if (game !== resumed || game.paused) {
    return;
  }
  input.enable(game.difficulty === 'advanced');
  game.frame = requestAnimationFrame(frame);
}

function startGroupSong({ file, partIndex, difficulty, takenParts, devices, countInStart }) {
  const song = songEntries.find((entry) => entry.file === file)?.song;
  if (!song) {
    return;
  }
  if (game) {
    stopGame();
  }
  startGame({
    song,
    partIndex,
    difficulty,
    autoplay: song.parts.filter((_, index) => !takenParts.includes(index)),
    countInStart,
    devices,
    together: true,
  });
}

// A guest's Quit takes only that player out of the song. The host's ends
// it for everyone.
function quitGame() {
  quitDialog.close();
  if (game) {
    const together = game.together;
    stopGame();
    if (together) {
      group.quitSong();
    } else {
      group.songEnded();
    }
  }
  show(group.active ? group.homeScreen : 'setup');
}

// Another player's note, sent from their device, while this device plays
// the song with them. Each player is monophonic, so a new note replaces
// their sounding one.
function playOtherNote(number, { action, midi, sound }) {
  if (!game?.together) {
    return;
  }
  const valid = Number.isInteger(midi) && midi >= 0 && midi <= 127;
  if (action === 'on' && valid && typeof sound === 'string') {
    otherVoices.get(number)?.release();
    otherVoices.set(number, audio.otherNoteOn(sound, midi));
  } else if (action === 'pitch' && valid) {
    otherVoices.get(number)?.setPitch(midi);
  } else if (action === 'off') {
    otherVoices.get(number)?.release();
    otherVoices.delete(number);
  }
}

// The host ended the song for everyone.
function stopGroupSong() {
  if (!game?.together) {
    return;
  }
  quitDialog.close();
  stopGame();
  group.songEnded();
  show(group.homeScreen);
}

function finishGame(time) {
  const { song, part } = game;
  quitDialog.close();
  input.disable();
  const { score } = game.judge.finish(time);
  stopGame();
  resultTitle.textContent = `${song.title} · ${part.name}`;
  scoreText.textContent = String(Math.round(score));
  // With several devices, Continue goes back to the lobby for the next
  // player's turn.
  const together = group.active;
  document.getElementById('again-button').hidden = together;
  document.getElementById('change-button').hidden = together;
  document.getElementById('continue-button').hidden = !together;
  group.songEnded();
  show('result');
}

function handlePress({ button, sharp, octave, time }) {
  if (!game) {
    return;
  }
  const songTime = audio.songTime(time);
  const pressed = { button, sharp, octave };
  const { note, correct } = game.judge.press(songTime, pressed);
  game.voice?.release();
  game.held = { button, note, time: songTime };
  const midi = pressPitch(game.part, game.difficulty, pressed, note, songTime);
  game.voice = audio.noteOn(game.part.sound, midi);
  if (game.together) {
    group.sendNote({ action: 'on', midi, sound: game.part.sound });
  }
  if (correct) {
    roll.addHit(note);
  }
}

// Modifiers changed just after a note press still count for it, in its
// sound and its score. Later changes do not affect the sounding note.
function handleModifiers({ sharp, octave, time }) {
  const songTime = audio.songTime(time);
  if (!game?.held || songTime - game.held.time > LATE_MODIFIER_WINDOW) {
    return;
  }
  const pressed = { button: game.held.button, sharp, octave };
  const { note, correct, changed } = game.judge.amend(songTime, pressed);
  if (changed) {
    if (correct) {
      roll.addHit(note);
    } else {
      roll.removeHit(note);
    }
  }
  const midi = pressPitch(game.part, game.difficulty, pressed, game.held.note, game.held.time);
  game.voice.setPitch(midi);
  if (game.together) {
    group.sendNote({ action: 'pitch', midi });
  }
}

function handleRelease({ time }) {
  if (!game) {
    return;
  }
  game.judge.release(audio.songTime(time));
  game.voice?.release();
  game.voice = null;
  game.held = null;
  if (game.together) {
    group.sendNote({ action: 'off' });
  }
}

function showLit({ buttons, sharp, octave }) {
  for (const element of noteButtons) {
    element.classList.toggle('down', buttons.has(Number(element.dataset.button)));
  }
  for (const element of modifierButtons) {
    element.classList.toggle('down', element.dataset.modifier === 'sharp' ? sharp : octave);
  }
  roll.setModifiers({ sharp, octave });
  bothLabel.classList.toggle('sharp-down', sharp);
  bothLabel.classList.toggle('octave-down', octave);
}

function showPitchNames(time) {
  const change = positionAt(game.part, time);
  if (change === game.shownPosition) {
    return;
  }
  game.shownPosition = change;
  for (const element of noteButtons) {
    element.querySelector('.name').textContent = buttonPitchName(change, Number(element.dataset.button));
  }
}

songSelect.addEventListener('change', showParts);

setupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const song = songs[songSelect.value];
  if (!song) {
    return;
  }
  startAudio();
  const difficulty = new FormData(setupForm).get('difficulty');
  startGame({ song, partIndex: Number(partSelect.value), difficulty });
});

// iOS Safari shows its magnifier on a double tap and hold, which the CSS on
// the play screen does not stop. Cancelling touchstart does. Quit is left
// out, since cancelling also stops the click it listens for.
screens.play.addEventListener('touchstart', (event) => {
  if (!event.target.closest('#quit-button')) {
    event.preventDefault();
  }
}, { passive: false });

document.getElementById('quit-button').addEventListener('click', pauseGame);
document.getElementById('keep-playing-button').addEventListener('click', resumeGame);
document.getElementById('confirm-quit-button').addEventListener('click', quitGame);
// Escape keeps playing, like the button that has focus.
quitDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  resumeGame();
});

document.getElementById('again-button').addEventListener('click', () => {
  audio.resume();
  startGame(lastSettings);
});

document.getElementById('change-button').addEventListener('click', () => show('setup'));
document.getElementById('continue-button').addEventListener('click', () => show(group.homeScreen));

loadSongs();
group.openJoinLink();
