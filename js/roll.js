// The piano roll: one part laid out in rows like sheet music, with a moving
// current-position line. See section 4 of docs/design.md.

import { heldToEnd } from './judge.js';
import { COUNT_IN_BEATS, SIXTEENTH } from './song.js';

// Sizes are at full scale. The whole roll shrinks when a bar group does not
// fit. A group is one bar, or two bars of 2/4 (see song.js).
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
// How much wider than its narrowest a bar group may grow, so that bars on
// wide screens do not ask for too much eye movement.
const MAX_STRETCH = 1.25;
const FADED_ALPHA = 0.3;
const HIT_DURATION = 400;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// How far the view has scrolled, in rows. It moves at a steady pace of one
// row per row of music, a row behind the line, so the current row slides from
// the second slot up to the top slot as it is played. The first row stays at
// the top until the line reaches the second. `beat` counts from the start of
// the roll, which is the start of the count-in.
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
    // Called with the width of a row, in CSS pixels, whenever it changes.
    this.onLayout = null;
    this.readColors();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readColors());
  }

  readColors() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    this.colors = {
      background: read('--roll-bg'),
      // Beginner bars share the colour of a held button, since any button plays.
      beginner: read('--accent'),
      badge: read('--badge'),
      badgeText: read('--badge-text'),
      notes: [1, 2, 3, 4, 5, 6, 7, 8].map((button) => read(`--note-${button}`)),
      symbol: read('--fg'),
      grid: read('--grid'),
      gridStrong: read('--grid-strong'),
      line: read('--line'),
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

  // Each row holds as many whole bar groups as fit, keeping a sixteenth note
  // wide enough for a head and its tail. If not even one group fits,
  // everything is scaled down. Groups share out the spare width up to a
  // maximum, and the rows are centred in what is left.
  layout() {
    const usable = Math.max(1, this.width - 2 * SIDE_MARGIN);
    const minSixteenth = HEAD_SIZE * (1 + SIXTEENTH_TAIL) + BAR_GAP;
    const minGroupWidth = (minSixteenth / SIXTEENTH) * this.song.beatsPerGroup;
    this.scale = clamp(usable / minGroupWidth, MIN_SCALE, 1);
    const groups = Math.max(1, Math.floor(usable / (minGroupWidth * this.scale)));
    this.beatsPerRow = groups * this.song.beatsPerGroup;
    const maxBeatWidth = (minGroupWidth * this.scale * MAX_STRETCH) / this.song.beatsPerGroup;
    this.beatWidth = Math.min(usable / this.beatsPerRow, maxBeatWidth);
    this.left = (this.width - this.beatWidth * this.beatsPerRow) / 2;
    this.onLayout?.(this.beatWidth * this.beatsPerRow);
    // The empty count-in bars come first, in the same rows as the song.
    this.rows = Math.ceil((COUNT_IN_BEATS + this.song.lengthBeats) / this.beatsPerRow);
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

  // Beats are song beats, so the count-in has negative beats and the first
  // row starts before the song does.
  rowStart(row) {
    return row * this.beatsPerRow - COUNT_IN_BEATS;
  }

  rowOf(beat) {
    return Math.floor((beat + COUNT_IN_BEATS) / this.beatsPerRow);
  }

  x(beat, row) {
    return this.left + (beat - this.rowStart(row)) * this.beatWidth;
  }

  position(time) {
    const beat = clamp(time / this.song.secondsPerBeat, -COUNT_IN_BEATS, this.song.lengthBeats);
    const row = Math.min(this.rowOf(beat), this.rows - 1);
    return { beat, row };
  }

  // Bars take the colour of their button, except in beginner mode where any
  // button plays and every bar has the colour of a held button.
  noteColor(note) {
    return this.difficulty === 'beginner' ? this.colors.beginner : this.colors.notes[note.button - 1];
  }

  // The effect spreads from the centre of the note's head, so it shows which
  // note was hit, whenever within the timing window the press came.
  addHit(note) {
    this.effects.push({ beat: note.startBeat, color: this.noteColor(note), born: performance.now() });
  }

  // Takes back the effect of a hit that turned out wrong.
  removeHit(note) {
    this.effects = this.effects.filter((effect) => effect.beat !== note.startBeat);
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
    const scrolled = scrollRows(beat + COUNT_IN_BEATS, this.beatsPerRow) * this.rowHeight - this.size(TOP_MARGIN);
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
      const beat = this.rowStart(row) + i;
      if (beat > this.song.lengthBeats) {
        break;
      }
      const x = Math.round(this.x(beat, row)) + 0.5;
      // Bar lines, including the count-in's, and the end of the song are
      // strong. The count-in is a whole number of bars, so its bar lines
      // follow the song's time signature.
      const strong = beat % this.song.beatsPerBar === 0 || beat === this.song.lengthBeats;
      context.strokeStyle = strong ? this.colors.gridStrong : this.colors.grid;
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
    const startRow = this.rowOf(start);
    const started = pressed && treatedEnd > start;
    // On a correct press, even an early one, the number goes and the head drops
    // to the height of the tail, together with the hit effect.
    const playing = state.result === 'correct';

    for (let r = Math.max(startRow, firstRow); r <= lastRow && this.rowStart(r) < end; r++) {
      const segmentStart = Math.max(start, this.rowStart(r));
      const segmentEnd = Math.min(end, this.rowStart(r + 1));
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

    if (startRow < firstRow || startRow > lastRow) {
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
    // Beginner mode keeps the badge but shows no number, since any button plays.
    const headScale = this.headSize / HEAD_SIZE;
    const inset = BADGE_INSET * headScale;
    const badge = this.headSize - 2 * inset;
    context.fillStyle = this.colors.badge;
    context.beginPath();
    roundedRect(context, x + inset, y + inset, badge, badge, BADGE_RADIUS * headScale);
    context.fill();
    if (this.difficulty !== 'beginner') {
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `600 ${FONT_SIZE * headScale}px system-ui, sans-serif`;
      context.fillStyle = this.colors.badgeText;
      context.fillText(String(note.button), x + this.headSize / 2, y + (HEAD_SIZE / 2 + 1) * headScale);
      context.textAlign = 'left';
    }
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
      const row = this.rowOf(effect.beat);
      const x = this.x(effect.beat, row) + this.headSize / 2;
      const y = this.headTop(row) + this.headSize / 2;
      // The effect grows with the head.
      context.arc(x, y, ((8 + 28 * progress) * this.headSize) / HEAD_SIZE, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}
