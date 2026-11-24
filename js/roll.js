// The piano roll: one part laid out in rows like sheet music, with a moving
// current-position line. See section 4 of docs/design.md.

import { heldToEnd } from './judge.js';
import { SIXTEENTH } from './song.js';

// Sizes are at full scale. The whole roll shrinks when a bar group does not
// fit. A group is one bar, or two bars of 2/4 (see song.js).
// Space above the first row. The line's top triangle reaches 24 px above the
// row at the top of its bounce, so this leaves some clear space above it. The
// view keeps this space as it scrolls, so short screens, where every pixel
// counts, keep only what the triangle needs.
const TOP_MARGIN = 40;
const SHORT_TOP_MARGIN = 24;
const SIDE_MARGIN = 16;
// A note is a square head, which holds the number badge, and a thinner tail.
// The head fills a sixteenth note but for a short tail, so it grows with the
// row. HEAD_SIZE is its smallest size. The notes sit in the middle of their
// row (see rowSpace).
const HEAD_SIZE = 34;
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
const FONT_SIZE = 24;
const SYMBOL_SIZE = 18;
// The modifiers' mark above a head: as wide as the head, in the space above
// it with a small gap. Its top corner is rounded on the left for semitone, on
// the right for octave and on both sides for both, like the modifier buttons.
// While a modifier is held, its marks move down onto their heads. While both
// are held, only the marks for both move.
// The gap is wide enough that closing it shows clearly, and the mark is a
// little shorter so that both still fit in the space above the head.
const MARK_HEIGHT = 20;
const MARK_SYMBOLS = { sharp: '♯', octave: '↑' };
const MARK_GAP = 6;
// Below this the numbers get too small to read, so short notes squeeze instead.
const MIN_SCALE = 0.75;
// How much wider than its narrowest a bar group may grow, so that bars on
// wide screens do not ask for too much eye movement. On short screens, such as
// phones in landscape, it does not grow at all, which keeps the heads and so
// the rows small enough for the next row to come into view in time.
const MAX_STRETCH = 1.25;
export const SHORT_SCREEN = '(max-height: 420px)';
const FADED_ALPHA = 0.3;
const HIT_DURATION = 400;
// How far each row's display area reaches above and below its notes: the
// current-position line, the current-beat band and the grid lines. It is the
// same in every mode, so that the roll does not change with the difficulty,
// and reaches past the modifier marks, so that the line's triangles clear
// them. Short screens use a smaller one.
const REACH = 40;
const SHORT_REACH = 30;
// The current position is marked by a triangle above and below the row's
// display area, pointing at each other, with no line between them. Each
// bounces once per beat: closest to the display area, TRIANGLE_GAP away,
// exactly on each beat, and TRIANGLE_GAP + BOUNCE away halfway between beats.
// "The line" elsewhere in this file means that current position.
// The triangles are brown, a colour no note uses, with rounded corners and an
// outline in the roll's background colour, which keeps them clear where they
// reach into a neighbouring row. Like a ball, they squash as they land: up to
// SQUASH flatter, and wider by SQUASH_WIDEN of that, over the last and first
// SQUASH_TIME of their bounce.
const TRIANGLE_WIDTH = 22;
const TRIANGLE_HEIGHT = 16;
const TRIANGLE_GAP = 2;
const TRIANGLE_RADIUS = 3;
const TRIANGLE_OUTLINE = 2;
const BOUNCE = 12;
const SQUASH = 0.35;
const SQUASH_WIDEN = 0.6;
const SQUASH_TIME = 0.25;
// The space between two rows' display areas. The triangles are drawn large and
// bounce high so the beat reads easily, and may reach past this gap into the
// neighbouring row's display area. They only ever mark the current beat, so
// the overlap does not distract.
const ROW_GAP = 16;

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

// The bounce of the line's triangles at `beat`, from 0 on a beat to 1
// halfway between beats. It follows a ball's path, so it touches sharply on
// the beat and turns smoothly at the top.
export function bounce(beat) {
  const phase = beat - Math.floor(beat);
  return 4 * phase * (1 - phase);
}

// How far a row's display area reaches above and below its notes, the space
// between rows' display areas, and the space above the first row, at full
// scale. The notes sit in the middle of the row.
export function rowSpace(short) {
  return { reach: short ? SHORT_REACH : REACH, gap: ROW_GAP, top: short ? SHORT_TOP_MARGIN : TOP_MARGIN };
}

// How squashed the triangles are at `beat`: 1 as they touch on the beat,
// easing to 0 as they rise, and 0 for the rest of the bounce.
export function squash(beat) {
  return Math.max(0, 1 - bounce(beat) / SQUASH_TIME);
}

// One row holds one bar group of `beatsPerGroup` beats, keeping a sixteenth
// note wide enough for a head and its tail. If the group does not fit,
// everything is scaled down. The group takes the spare width up to a maximum,
// except on short screens, and the row is centred in what is left. `width` is
// the canvas width.
export function rowLayout(width, beatsPerGroup, short = false) {
  const usable = Math.max(1, width - 2 * SIDE_MARGIN);
  const minSixteenth = HEAD_SIZE * (1 + SIXTEENTH_TAIL) + BAR_GAP;
  const minWidth = (minSixteenth / SIXTEENTH) * beatsPerGroup;
  const scale = clamp(usable / minWidth, MIN_SCALE, 1);
  const rowWidth = Math.min(usable, minWidth * scale * (short ? 1 : MAX_STRETCH));
  return { scale, beatWidth: rowWidth / beatsPerGroup, width: rowWidth };
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

// A rectangle with only its top corners rounded, each by its own radius.
function topRoundedRect(context, x, y, width, height, leftRadius, rightRadius) {
  const left = Math.min(leftRadius, width / 2, height);
  const right = Math.min(rightRadius, width / 2, height);
  context.moveTo(x + left, y);
  context.arcTo(x + width, y, x + width, y + height, right);
  context.lineTo(x + width, y + height);
  context.lineTo(x, y + height);
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
      sharp: read('--sharp'),
      octave: read('--octave'),
      grid: read('--grid'),
      gridStrong: read('--grid-strong'),
      gridFaint: read('--grid-faint'),
      currentBeat: read('--current-beat'),
      position: read('--position'),
    };
  }

  setPart(song, part, difficulty) {
    this.song = song;
    this.part = part;
    this.difficulty = difficulty;
    this.effects = [];
    this.modifiers = { sharp: false, octave: false };
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

  // Each row holds one bar group. See rowLayout.
  layout() {
    const short = matchMedia(SHORT_SCREEN).matches;
    const row = rowLayout(this.width, this.song.beatsPerGroup, short);
    this.scale = row.scale;
    this.beatsPerRow = this.song.beatsPerGroup;
    this.beatWidth = row.beatWidth;
    this.left = (this.width - row.width) / 2;
    // The buttons keep the width of a row of 4/4 in every song, so they do
    // not change size from song to song.
    this.onLayout?.(rowLayout(this.width, 4, short).width);
    // The empty count-in bars come first, in the same rows as the song.
    this.rows = Math.ceil((this.song.countIn.beats + this.song.lengthBeats) / this.beatsPerRow);
    // A sixteenth note is a head and a short tail, then the gap before the
    // next note.
    this.headSize = (this.beatWidth * SIXTEENTH - this.size(BAR_GAP)) / (1 + SIXTEENTH_TAIL);
    this.tailHeight = this.headSize * TAIL_RATIO;
    this.space = rowSpace(short);
    this.reach = this.size(this.space.reach);
    this.rowHeight = this.headSize + 2 * this.reach + this.size(this.space.gap);
    // The notes sit in the middle of the row.
    this.headOffset = (this.rowHeight - this.headSize) / 2;
  }

  // A length at full scale, in pixels at the current scale.
  size(length) {
    return length * this.scale;
  }

  headTop(row) {
    return row * this.rowHeight + this.headOffset;
  }

  // Beats are song beats, so the count-in has negative beats and the first
  // row starts before the song does.
  rowStart(row) {
    return row * this.beatsPerRow - this.song.countIn.beats;
  }

  rowOf(beat) {
    return Math.floor((beat + this.song.countIn.beats) / this.beatsPerRow);
  }

  x(beat, row) {
    return this.left + (beat - this.rowStart(row)) * this.beatWidth;
  }

  position(time) {
    const beat = clamp(time / this.song.secondsPerBeat, -this.song.countIn.beats, this.song.lengthBeats);
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
    const scrolled = scrollRows(beat + this.song.countIn.beats, this.beatsPerRow) * this.rowHeight - this.size(this.space.top);
    const top = Math.round(scrolled * this.ratio) / this.ratio;
    context.translate(0, -top);

    const firstRow = Math.max(0, Math.floor(top / this.rowHeight));
    const lastRow = Math.min(this.rows - 1, Math.floor((top + this.height) / this.rowHeight));
    this.drawCurrentBeat(beat, row);
    for (let r = firstRow; r <= lastRow; r++) {
      this.drawGrid(r);
    }
    this.part.notes.forEach((note, index) => this.drawNote(note, states[index], beat, firstRow, lastRow));
    this.drawLine(beat, row);
    this.drawEffects(now);
  }

  // A faint band behind the beat the line is in, in the current row, as tall
  // as the row's display area. It moves on at each beat.
  drawCurrentBeat(beat, row) {
    const start = Math.floor(beat);
    if (start >= this.song.lengthBeats) {
      return;
    }
    const context = this.context;
    const top = this.headTop(row) - this.reach;
    const bottom = this.headTop(row) + this.headSize + this.reach;
    const x0 = Math.round(this.x(start, row)) + 0.5;
    const x1 = Math.round(this.x(start + 1, row)) + 0.5;
    context.fillStyle = this.colors.currentBeat;
    context.fillRect(x0, top, x1 - x0, bottom - top);
  }

  // Three levels of line across the row's display area: bar lines, beat
  // marks, and fainter sixteenth-note lines between them.
  drawGrid(row) {
    const context = this.context;
    const top = this.headTop(row) - this.reach;
    const bottom = this.headTop(row) + this.headSize + this.reach;
    const steps = Math.round(1 / SIXTEENTH);
    context.lineWidth = 1;
    for (let i = 0; i <= this.beatsPerRow * steps; i++) {
      const beat = this.rowStart(row) + i / steps;
      if (beat > this.song.lengthBeats) {
        break;
      }
      const x = Math.round(this.x(beat, row)) + 0.5;
      // Bar lines, including the count-in's, and the end of the song are
      // strong. The count-in is a whole number of bars, so its bar lines
      // follow the song's time signature.
      const strong = beat % this.song.beatsPerBar === 0 || beat === this.song.lengthBeats;
      const onBeat = i % steps === 0;
      context.strokeStyle = strong ? this.colors.gridStrong : onBeat ? this.colors.grid : this.colors.gridFaint;
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
      this.drawMark(note, x, y);
    }
    context.globalAlpha = 1;
  }

  // The modifiers held now, which move their marks onto the heads.
  setModifiers({ sharp, octave }) {
    this.modifiers = { sharp, octave };
  }

  // The modifiers' mark above the head at (x, y). With both, the semitone
  // half is on the left and the octave half on the right.
  drawMark(note, x, y) {
    const context = this.context;
    const height = this.size(MARK_HEIGHT);
    const top = y - this.size(MARK_GAP) - height;
    const round = height / 2;
    const pieces = [];
    if (note.sharp && note.octave) {
      const half = this.headSize / 2;
      pieces.push({ x, width: half, left: round, right: 0, modifier: 'sharp' });
      pieces.push({ x: x + half, width: half, left: 0, right: round, modifier: 'octave' });
    } else if (note.sharp) {
      pieces.push({ x, width: this.headSize, left: round, right: 0, modifier: 'sharp' });
    } else {
      pieces.push({ x, width: this.headSize, left: 0, right: round, modifier: 'octave' });
    }
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${this.size(SYMBOL_SIZE)}px system-ui, sans-serif`;
    const both = this.modifiers.sharp && this.modifiers.octave;
    for (const piece of pieces) {
      const moved = both ? note.sharp && note.octave : this.modifiers[piece.modifier];
      const pieceTop = moved ? top + this.size(MARK_GAP) : top;
      context.fillStyle = this.colors[piece.modifier];
      context.beginPath();
      topRoundedRect(context, piece.x, pieceTop, piece.width, height, piece.left, piece.right);
      context.fill();
      context.fillStyle = this.colors.symbol;
      context.fillText(MARK_SYMBOLS[piece.modifier], piece.x + piece.width / 2, pieceTop + height / 2 + this.size(1));
    }
    context.textAlign = 'left';
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

  // The current position is shown by two triangles, with no line between
  // them: one above the row's display area pointing down, and one below it
  // pointing up. They bounce once per beat, closest to the display area on the
  // beat, including through the count-in.
  drawLine(beat, row) {
    const context = this.context;
    const x = this.x(beat, row);
    const top = this.headTop(row) - this.reach;
    const bottom = this.headTop(row) + this.headSize + this.reach;
    const landing = squash(beat);
    const distance = this.size(TRIANGLE_GAP + BOUNCE * bounce(beat));
    const height = this.size(TRIANGLE_HEIGHT) * (1 - SQUASH * landing);
    const halfWidth = (this.size(TRIANGLE_WIDTH) / 2) * (1 + SQUASH * SQUASH_WIDEN * landing);
    context.lineJoin = 'round';
    context.lineWidth = 2 * this.size(TRIANGLE_OUTLINE);
    context.strokeStyle = this.colors.background;
    context.fillStyle = this.colors.position;
    for (const [tip, direction] of [[top - distance, 1], [bottom + distance, -1]]) {
      this.traceTriangle(x, tip, halfWidth, height, direction);
      context.stroke();
      context.fill();
    }
  }

  // A triangle with rounded corners, its tip at (x, tip), pointing down for
  // `direction` 1 and up for -1.
  traceTriangle(x, tip, halfWidth, height, direction) {
    const context = this.context;
    const base = tip - direction * height;
    const corners = [[x, tip], [x + halfWidth, base], [x - halfWidth, base]];
    const radius = this.size(TRIANGLE_RADIUS);
    context.beginPath();
    context.moveTo((corners[2][0] + x) / 2, (corners[2][1] + tip) / 2);
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % 3];
      context.arcTo(corner[0], corner[1], next[0], next[1], radius);
    });
    context.closePath();
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
