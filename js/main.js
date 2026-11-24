// Wires the screens together: setup, play and result.

import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { LATE_MODIFIER_WINDOW, createJudge, pressPitch } from './judge.js';
import { buttonPitchName } from './pitch.js';
import { Roll } from './roll.js';
import { positionAt, resolveSong } from './song.js';

// Time after the last bar before the result screen, so the last notes can
// finish sounding.
const END_DELAY = 0.5;

const screens = {
  setup: document.getElementById('setup'),
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
let audio = null;
let game = null;
let lastSettings = null;

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
  songs = loaded.filter((entry) => entry.song).map((entry) => entry.song);
  const errors = loaded.filter((entry) => entry.error);
  setupMessage.textContent = errors.map((entry) => `${entry.file}: ${entry.error.message}`).join('\n');
  songSelect.replaceChildren(...songs.map((song, index) => new Option(song.title, index)));
  showParts();
}

function showParts() {
  const song = songs[songSelect.value];
  partSelect.replaceChildren(...(song ? song.parts.map((part, index) => new Option(part.name, index)) : []));
}

function startGame({ song, partIndex, difficulty }) {
  const part = song.parts[partIndex];
  lastSettings = { song, partIndex, difficulty };
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
  };
  playSong.textContent = song.title;
  playPart.textContent = part.name;
  screens.play.dataset.difficulty = difficulty;
  for (const button of modifierButtons) {
    button.disabled = difficulty !== 'advanced';
  }
  show('play');
  roll.setPart(song, part, difficulty);
  input.enable(difficulty === 'advanced');
  audio.startSong(song, song.parts.filter((other) => other !== part));
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

// Quit pauses the song and asks for confirmation. Disabling input first
// releases any held note while the song time is still running, so its
// duration stops counting at the pause.
function pauseGame() {
  if (!game || game.paused) {
    return;
  }
  game.paused = true;
  input.disable();
  cancelAnimationFrame(game.frame);
  audio.pause();
  quitDialog.showModal();
}

// Carries on from exactly where the song paused, with no count-in.
// Called from the user gesture, which resuming audio needs.
async function resumeGame() {
  quitDialog.close();
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

function quitGame() {
  quitDialog.close();
  if (game) {
    stopGame();
  }
  show('setup');
}

function finishGame(time) {
  const { song, part } = game;
  input.disable();
  const { score } = game.judge.finish(time);
  stopGame();
  resultTitle.textContent = `${song.title} · ${part.name}`;
  scoreText.textContent = String(Math.round(score));
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
  game.voice = audio.noteOn(game.part.sound, pressPitch(game.part, game.difficulty, pressed, note, songTime));
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
  game.voice.setPitch(pressPitch(game.part, game.difficulty, pressed, game.held.note, game.held.time));
}

function handleRelease({ time }) {
  if (!game) {
    return;
  }
  game.judge.release(audio.songTime(time));
  game.voice?.release();
  game.voice = null;
  game.held = null;
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
  // The audio context must be created and resumed during the user gesture.
  if (navigator.audioSession) {
    navigator.audioSession.type = 'playback';
  }
  audio ??= new AudioEngine();
  audio.resume();
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

loadSongs();
