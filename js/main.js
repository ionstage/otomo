// Wires the screens together: setup, play and result.

import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { createJudge, pressPitch } from './judge.js';
import { buttonPitchName } from './pitch.js';
import { Roll } from './roll.js';
import { doAt, resolveSong } from './song.js';

// Time after the last bar before the result screen, so the last notes can
// finish sounding.
const END_DELAY = 0.5;

const DIFFICULTY_NAMES = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

const screens = {
  setup: document.getElementById('setup'),
  play: document.getElementById('play'),
  result: document.getElementById('result'),
};
const setupForm = document.getElementById('setup-form');
const songSelect = document.getElementById('song-select');
const partSelect = document.getElementById('part-select');
const setupMessage = document.getElementById('setup-message');
const playTitle = document.getElementById('play-title');
const noteButtons = [...document.querySelectorAll('[data-button]')];
const modifierButtons = [...document.querySelectorAll('[data-modifier]')];
const scoreText = document.getElementById('score');
const resultTitle = document.getElementById('result-title');

const roll = new Roll(document.getElementById('roll'));
const input = new Input({
  buttons: [...noteButtons, ...modifierButtons],
  onPress: handlePress,
  onRelease: handleRelease,
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
    shownDo: null,
    frame: 0,
  };
  playTitle.textContent = `${song.title} · ${part.name} · ${DIFFICULTY_NAMES[difficulty]}`;
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
  game.voice = audio.noteOn(game.part.sound, pressPitch(game.part, game.difficulty, pressed, note, songTime));
  if (correct) {
    roll.addHit(songTime);
  }
}

function handleRelease({ time }) {
  if (!game) {
    return;
  }
  game.judge.release(audio.songTime(time));
  game.voice?.release();
  game.voice = null;
}

function showLit({ buttons, sharp, octave }) {
  for (const element of noteButtons) {
    element.classList.toggle('down', buttons.has(Number(element.dataset.button)));
  }
  for (const element of modifierButtons) {
    element.classList.toggle('down', element.dataset.modifier === 'sharp' ? sharp : octave);
  }
}

function showPitchNames(time) {
  const change = doAt(game.part, time);
  if (change === game.shownDo) {
    return;
  }
  game.shownDo = change;
  for (const element of noteButtons) {
    element.querySelector('.name').textContent = buttonPitchName(change.name, Number(element.dataset.button));
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

document.getElementById('quit-button').addEventListener('click', () => {
  stopGame();
  show('setup');
});

document.getElementById('again-button').addEventListener('click', () => {
  audio.resume();
  startGame(lastSettings);
});

document.getElementById('change-button').addEventListener('click', () => show('setup'));

loadSongs();
