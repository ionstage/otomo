// The piano roll: one part laid out in rows like sheet music, with a moving
// current-position line. See section 4 of docs/design.md.

import { heldToEnd } from './judge.js';
import { SIXTEENTH } from './song.js';

// Sizes are at full scale. The whole roll shrinks when a bar does not fit.
const TOP_MARGIN = 12;
const SIDE_MARGIN = 16;
// A note is a square head, which holds the number badge, and a thinner tail.
// The head fills a sixteenth note but for a short tail, so it grows with the
// row. HEAD_SIZE is its smallest size, and the row keeps a fixed space above
// and below it.
const HEAD_TOP = 28;
const HEAD_SIZE = 34;
const ROW_BOTTOM = 22;
// The tail's height as a share of the head's.
const TAIL_RATIO = 26 / 34;
// The length of a sixteenth note's tail as a share of the head's width.
const SIXTEENTH_TAIL = 0.25;
const BAR_GAP = 2;
const BAR_RADIUS = 6;
// How far along the tail the curve from the head reaches.
const JOIN_LENGTH = 4;
const BADGE_INSET = 3;
const BADGE_RADIUS = 4;
// The number at the smallest head size, and the modifier symbols above a bar.
const FONT_SIZE = 20;
const SYMBOL_SIZE = 18;
// Below this the numbers get too small to read, so short notes squeeze instead.
const MIN_SCALE = 0.75;
const FADED_ALPHA = 0.3;
const HIT_DURATION = 400;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// How far the view has scrolled, in rows. It moves at a steady pace of one
// row per row of music, a row behind the line, so the current row slides from
// the second slot up to the top slot as it is played. The first row stays at
// the top until the line reaches the second.
export function scrollRows(beat, beatsPerRow) {
  return Math.max(0, beat / beatsPerRow - 1);
}

// The two ends can have their own radius, so a bar can start or end square.
function roundedRect(context, x, y, width, height, leftRadius, rightRadius = leftRadius) {
  const left = Math.min(leftRadius, width / 2, height / 2);
  const right = Math.min(rightRadius, width / 2, height / 2);
  context.moveTo(x + left, y);
  context.arcTo(x + width, y, x + width, y + height, right);
  context.arcTo(x + width, y + height, x, y + height, right);
  context.arcTo(x, y + height, x, y, left);
  context.arcTo(x, y, x + width, y, left);
  context.closePath();
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

  // Each row holds as many whole bars as fit, keeping a sixteenth note wide
  // enough for a head and its tail. If not even one bar fits, everything is
  // scaled down.
  layout() {
    const usable = Math.max(1, this.width - 2 * SIDE_MARGIN);
    const minSixteenth = HEAD_SIZE * (1 + SIXTEENTH_TAIL) + BAR_GAP;
    const minBarWidth = (minSixteenth / SIXTEENTH) * this.song.beatsPerBar;
    this.scale = clamp(usable / minBarWidth, MIN_SCALE, 1);
    const bars = Math.max(1, Math.floor(usable / (minBarWidth * this.scale)));
    this.beatsPerRow = bars * this.song.beatsPerBar;
    this.beatWidth = usable / this.beatsPerRow;
    this.rows = Math.ceil(this.song.lengthBeats / this.beatsPerRow);
    // A sixteenth note is a head and a short tail, then the gap before the
    // next note.
    this.headSize = (this.beatWidth * SIXTEENTH - this.size(BAR_GAP)) / (1 + SIXTEENTH_TAIL);
    this.tailHeight = this.headSize * TAIL_RATIO;
    this.rowHeight = this.size(HEAD_TOP + ROW_BOTTOM) + this.headSize;
  }

  // A length at full scale, in pixels at the current scale.
  size(length) {
    return length * this.scale;
  }

  headTop(row) {
    return row * this.rowHeight + this.size(HEAD_TOP);
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

  // The effect spreads from the centre of the note's head, so it shows which
  // note was hit, whenever within the timing window the press came.
  addHit(note) {
    const color = this.difficulty === 'beginner' ? this.colors.hit : this.noteColor(note);
    this.effects.push({ beat: note.startBeat, color, born: performance.now() });
  }

  draw(time, states) {
    if (!this.song || !this.width || !this.height) {
      return;
    }
    const context = this.context;
    const now = performance.now();
    const { beat, row } = this.position(time);

    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.fillStyle = this.colors.background;
    context.fillRect(0, 0, this.width, this.height);
    // Whole device pixels, so text and grid lines do not shimmer as the view
    // moves.
    const scrolled = scrollRows(beat, this.beatsPerRow) * this.rowHeight - this.size(TOP_MARGIN);
    const top = Math.round(scrolled * this.ratio) / this.ratio;
    context.translate(0, -top);

    const firstRow = Math.max(0, Math.floor(top / this.rowHeight));
    const lastRow = Math.min(this.rows - 1, Math.floor((top + this.height) / this.rowHeight));
    for (let r = firstRow; r <= lastRow; r++) {
      this.drawGrid(r);
    }
    this.part.notes.forEach((note, index) => this.drawNote(note, states[index], beat, firstRow, lastRow));
    this.drawLine(beat, row);
    this.drawEffects(now);
  }

  drawGrid(row) {
    const context = this.context;
    const top = this.headTop(row) - this.size(6);
    const bottom = this.headTop(row) + this.headSize + this.size(6);
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
      // An early release leaves the remaining time rounded to the note's grid:
      // sixteenth notes, or thirds of a beat for a triplet. A press always
      // takes some time, so at least one grid step goes, however quick it was.
      const held = state.releaseTime === null || heldToEnd(note, state.releaseTime);
      const remainingBeats = (note.end - state.releaseTime) / this.song.secondsPerBeat;
      const roundedBeat = end - Math.round(remainingBeats / note.gridBeats) * note.gridBeats;
      const releaseBeat = held ? Infinity : Math.max(roundedBeat, start + note.gridBeats);
      treatedEnd = clamp(Math.min(beat, releaseBeat), start, end);
    }
    const startRow = Math.floor(start / this.beatsPerRow);
    const started = pressed && treatedEnd > start;
    // On a correct press, even an early one, the number goes and the head drops
    // to the height of the tail, together with the hit effect.
    const playing = state.result === 'correct';

    for (let r = Math.max(startRow, firstRow); r <= lastRow && r * this.beatsPerRow < end; r++) {
      const segmentStart = Math.max(start, r * this.beatsPerRow);
      const segmentEnd = Math.min(end, (r + 1) * this.beatsPerRow);
      const x0 = this.x(segmentStart, r);
      // A bar that carries on to the next row runs to the row's end with no gap.
      const x1 = this.x(segmentEnd, r) - (segmentEnd < end ? 0 : this.size(BAR_GAP));
      if (x1 <= x0) {
        continue;
      }
      const y = this.headTop(r);
      const height = this.headSize;
      const split = clamp(this.x(clamp(treatedEnd, segmentStart, segmentEnd), r), x0, x1);
      context.save();
      this.traceNote(x0, x1, y, r === startRow && !playing, r > startRow, segmentEnd < end);
      context.clip();
      context.fillStyle = this.noteColor(note);
      if (state.result === 'wrong') {
        context.globalAlpha = FADED_ALPHA;
        context.fillRect(x0, y, split - x0, height);
        context.globalAlpha = 1;
      }
      context.fillRect(split, y, x1 - split, height);
      context.restore();
    }

    if (this.difficulty === 'beginner' || startRow < firstRow || startRow > lastRow) {
      return;
    }
    if (playing) {
      return;
    }
    const x = this.x(start, startRow);
    const y = this.headTop(startRow);
    context.globalAlpha = started ? FADED_ALPHA : 1;
    // The number sits on a square badge so it reads the same on every colour.
    // The badge and its number grow with the head, keeping their proportions.
    const headScale = this.headSize / HEAD_SIZE;
    const inset = BADGE_INSET * headScale;
    const badge = this.headSize - 2 * inset;
    context.fillStyle = this.colors.badge;
    context.beginPath();
    roundedRect(context, x + inset, y + inset, badge, badge, BADGE_RADIUS * headScale);
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${FONT_SIZE * headScale}px system-ui, sans-serif`;
    context.fillStyle = this.colors.badgeText;
    context.fillText(String(note.button), x + this.headSize / 2, y + (HEAD_SIZE / 2 + 1) * headScale);
    context.textAlign = 'left';
    if (this.difficulty === 'advanced' && (note.sharp || note.octave)) {
      context.font = `700 ${this.size(SYMBOL_SIZE)}px system-ui, sans-serif`;
      context.fillStyle = this.colors.symbol;
      context.fillText((note.sharp ? '♯' : '') + (note.octave ? '↑' : ''), x + this.size(4), y - this.size(7));
    }
    context.globalAlpha = 1;
  }

  // One row's piece of a note, from x0 to x1: a square head that curves into
  // a thinner tail, drawn as one shape. A note carried over from the row above
  // is tail only, and a note no longer than its head is head only. Where a note
  // breaks between rows, both sides of the break are square.
  traceNote(x0, x1, top, withHead, fromRowAbove, toRowBelow) {
    const context = this.context;
    const radius = this.size(BAR_RADIUS);
    const startRadius = fromRowAbove ? 0 : radius;
    const endRadius = toRowBelow ? 0 : radius;
    const tailTop = top + (this.headSize - this.tailHeight) / 2;
    const tailBottom = tailTop + this.tailHeight;
    const bottom = top + this.headSize;
    const headEnd = x0 + this.headSize;
    context.beginPath();
    if (!withHead) {
      roundedRect(context, x0, tailTop, x1 - x0, tailBottom - tailTop, startRadius, endRadius);
      return;
    }
    if (x1 - headEnd < 1) {
      roundedRect(context, x0, top, x1 - x0, bottom - top, radius, endRadius);
      return;
    }
    const join = Math.min(this.size(JOIN_LENGTH), (x1 - headEnd) / 2);
    const tailEndRadius = Math.min(endRadius, x1 - headEnd - join);
    context.moveTo(x0 + radius, top);
    context.lineTo(headEnd - radius, top);
    context.bezierCurveTo(headEnd, top, headEnd, tailTop, headEnd + join, tailTop);
    context.arcTo(x1, tailTop, x1, tailBottom, tailEndRadius);
    context.arcTo(x1, tailBottom, headEnd, tailBottom, tailEndRadius);
    context.lineTo(headEnd + join, tailBottom);
    context.bezierCurveTo(headEnd, tailBottom, headEnd, bottom, headEnd - radius, bottom);
    context.arcTo(x0, bottom, x0, top, radius);
    context.arcTo(x0, top, headEnd, top, radius);
    context.closePath();
  }

  drawLine(beat, row) {
    const context = this.context;
    const x = this.x(beat, row);
    context.strokeStyle = this.colors.line;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(x, this.headTop(row) - this.size(14));
    context.lineTo(x, this.headTop(row) + this.headSize + this.size(12));
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
      const row = Math.floor(effect.beat / this.beatsPerRow);
      const x = this.x(effect.beat, row) + this.headSize / 2;
      const y = this.headTop(row) + this.headSize / 2;
      // The effect grows with the head.
      context.arc(x, y, ((8 + 28 * progress) * this.headSize) / HEAD_SIZE, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}
