// The piano roll: one part laid out in rows like sheet music, with a moving
// current-position line. See section 4 of docs/design.md.

import { heldToEnd } from './judge.js';
import { SIXTEENTH } from './song.js';

const ROW_HEIGHT = 84;
const TOP_MARGIN = 12;
const SIDE_MARGIN = 16;
const BAR_TOP = 30;
const BAR_HEIGHT = 30;
const BAR_GAP = 2;
const BAR_RADIUS = 6;
// The narrowest note must hold the square badge behind its number.
const LABEL_WIDTH = 30;
const BADGE_INSET = 3;
const BADGE_RADIUS = 4;
const MIN_BEAT_WIDTH = 36;
const FADED_ALPHA = 0.3;
const SCROLL_TIME = 0.12;
const HIT_DURATION = 400;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class Roll {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.song = null;
    this.effects = [];
    this.readColors();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readColors());
  }

  readColors() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    this.colors = {
      background: read('--roll-bg'),
      note: read('--note'),
      badge: read('--badge'),
      badgeText: read('--badge-text'),
      notes: [1, 2, 3, 4, 5, 6, 7, 8].map((button) => read(`--note-${button}`)),
      symbol: read('--fg'),
      grid: read('--grid'),
      gridStrong: read('--grid-strong'),
      line: read('--line'),
      hit: read('--hit'),
    };
  }

  setPart(song, part, difficulty) {
    this.song = song;
    this.part = part;
    this.difficulty = difficulty;
    this.effects = [];
    this.scroll = 0;
    this.lastFrame = performance.now();
    this.resize();
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.ratio = ratio;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    if (this.song) {
      this.layout();
    }
  }

  // Each row holds as many whole bars as fit, keeping the shortest note wide
  // enough for its number.
  layout() {
    const shortest = Math.min(...this.part.notes.map((note) => note.lengthBeats));
    const minBeatWidth = Math.max(MIN_BEAT_WIDTH, LABEL_WIDTH / shortest);
    const usable = Math.max(1, this.width - 2 * SIDE_MARGIN);
    const bars = Math.max(1, Math.floor(usable / (minBeatWidth * this.song.beatsPerBar)));
    this.beatsPerRow = bars * this.song.beatsPerBar;
    this.beatWidth = usable / this.beatsPerRow;
    this.rows = Math.ceil(this.song.lengthBeats / this.beatsPerRow);
  }

  x(beat, row) {
    return SIDE_MARGIN + (beat - row * this.beatsPerRow) * this.beatWidth;
  }

  position(time) {
    const beat = clamp(time / this.song.secondsPerBeat, 0, this.song.lengthBeats);
    const row = Math.min(Math.floor(beat / this.beatsPerRow), this.rows - 1);
    return { beat, row };
  }

  // Bars take the colour of their button, except in beginner mode where any
  // button plays and every bar is the same.
  noteColor(note) {
    return this.difficulty === 'beginner' ? this.colors.note : this.colors.notes[note.button - 1];
  }

  addHit(time, note) {
    const { beat, row } = this.position(time);
    const color = this.difficulty === 'beginner' ? this.colors.hit : this.noteColor(note);
    this.effects.push({ x: this.x(beat, row), y: row * ROW_HEIGHT + BAR_TOP + BAR_HEIGHT / 2, color, born: performance.now() });
  }

  draw(time, states) {
    if (!this.song || !this.width || !this.height) {
      return;
    }
    const context = this.context;
    const now = performance.now();
    const elapsed = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const { beat, row } = this.position(time);
    this.scroll += (row * ROW_HEIGHT - this.scroll) * (1 - Math.exp(-elapsed / SCROLL_TIME));

    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = this.colors.background;
    context.fillRect(0, 0, this.width, this.height);
    context.translate(0, TOP_MARGIN - this.scroll);

    const firstRow = Math.max(0, Math.floor((this.scroll - TOP_MARGIN) / ROW_HEIGHT));
    const lastRow = Math.min(this.rows - 1, Math.floor((this.scroll - TOP_MARGIN + this.height) / ROW_HEIGHT));
    for (let r = firstRow; r <= lastRow; r++) {
      this.drawGrid(r);
    }
    this.part.notes.forEach((note, index) => this.drawNote(note, states[index], beat, firstRow, lastRow));
    this.drawLine(beat, row);
    this.drawEffects(now);
  }

  drawGrid(row) {
    const context = this.context;
    const top = row * ROW_HEIGHT + BAR_TOP - 8;
    const bottom = row * ROW_HEIGHT + BAR_TOP + BAR_HEIGHT + 8;
    context.lineWidth = 1;
    for (let i = 0; i <= this.beatsPerRow; i++) {
      const beat = row * this.beatsPerRow + i;
      if (beat > this.song.lengthBeats) {
        break;
      }
      const x = Math.round(this.x(beat, row)) + 0.5;
      context.strokeStyle = beat % this.song.beatsPerBar === 0 ? this.colors.gridStrong : this.colors.grid;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
  }

  // A pressed note is erased (correct) or faded (wrong) from its start up to
  // the line, or up to where it was released. The rest stays fully visible.
  drawNote(note, state, beat, firstRow, lastRow) {
    const context = this.context;
    const start = note.startBeat;
    const end = start + note.lengthBeats;
    const pressed = state.result === 'correct' || state.result === 'wrong';
    let treatedEnd = start;
    if (pressed) {
      // A release the scoring treats as held to the end shows that way too.
      // An early release leaves the remaining time rounded to the nearest
      // sixteenth note.
      const held = state.releaseTime === null || heldToEnd(note, state.releaseTime);
      const remainingBeats = (note.end - state.releaseTime) / this.song.secondsPerBeat;
      const releaseBeat = held ? Infinity : end - Math.round(remainingBeats / SIXTEENTH) * SIXTEENTH;
      treatedEnd = clamp(Math.min(beat, releaseBeat), start, end);
    }
    const startRow = Math.floor(start / this.beatsPerRow);

    for (let r = Math.max(startRow, firstRow); r <= lastRow && r * this.beatsPerRow < end; r++) {
      const segmentStart = Math.max(start, r * this.beatsPerRow);
      const segmentEnd = Math.min(end, (r + 1) * this.beatsPerRow);
      const x0 = this.x(segmentStart, r);
      const x1 = this.x(segmentEnd, r) - BAR_GAP;
      if (x1 <= x0) {
        continue;
      }
      const y = r * ROW_HEIGHT + BAR_TOP;
      const split = clamp(this.x(clamp(treatedEnd, segmentStart, segmentEnd), r), x0, x1);
      context.save();
      context.beginPath();
      if (context.roundRect) {
        context.roundRect(x0, y, x1 - x0, BAR_HEIGHT, BAR_RADIUS);
      } else {
        context.rect(x0, y, x1 - x0, BAR_HEIGHT);
      }
      context.clip();
      context.fillStyle = this.noteColor(note);
      if (state.result === 'wrong') {
        context.globalAlpha = FADED_ALPHA;
        context.fillRect(x0, y, split - x0, BAR_HEIGHT);
        context.globalAlpha = 1;
      }
      context.fillRect(split, y, x1 - split, BAR_HEIGHT);
      context.restore();
    }

    if (this.difficulty === 'beginner' || startRow < firstRow || startRow > lastRow) {
      return;
    }
    const started = pressed && treatedEnd > start;
    if (started && state.result === 'correct') {
      return;
    }
    const x = this.x(start, startRow);
    const y = startRow * ROW_HEIGHT + BAR_TOP;
    context.globalAlpha = started ? FADED_ALPHA : 1;
    // The number sits on a square badge so it reads the same on every colour.
    const size = BAR_HEIGHT - 2 * BADGE_INSET;
    context.fillStyle = this.colors.badge;
    context.beginPath();
    if (context.roundRect) {
      context.roundRect(x + BADGE_INSET, y + BADGE_INSET, size, size, BADGE_RADIUS);
    } else {
      context.rect(x + BADGE_INSET, y + BADGE_INSET, size, size);
    }
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 15px system-ui, sans-serif';
    context.fillStyle = this.colors.badgeText;
    context.fillText(String(note.button), x + BADGE_INSET + size / 2, y + BAR_HEIGHT / 2 + 1);
    context.textAlign = 'left';
    if (this.difficulty === 'advanced' && (note.sharp || note.octave)) {
      context.font = '700 15px system-ui, sans-serif';
      context.fillStyle = this.colors.symbol;
      context.fillText((note.sharp ? '♯' : '') + (note.octave ? '↑' : ''), x + 4, y - 9);
    }
    context.globalAlpha = 1;
  }

  drawLine(beat, row) {
    const context = this.context;
    const x = this.x(beat, row);
    context.strokeStyle = this.colors.line;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x, row * ROW_HEIGHT + BAR_TOP - 16);
    context.lineTo(x, row * ROW_HEIGHT + BAR_TOP + BAR_HEIGHT + 14);
    context.stroke();
  }

  drawEffects(now) {
    const context = this.context;
    this.effects = this.effects.filter((effect) => now - effect.born < HIT_DURATION);
    context.lineWidth = 3;
    for (const effect of this.effects) {
      context.strokeStyle = effect.color;
      const progress = (now - effect.born) / HIT_DURATION;
      context.globalAlpha = 1 - progress;
      context.beginPath();
      context.arc(effect.x, effect.y, 8 + 28 * progress, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}
