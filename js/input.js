// Keyboard and pointer input, reported as presses and releases with event
// time stamps on the performance.now() clock.
//
// A part is monophonic, so a new note press replaces the held one, and
// releasing the replaced button does nothing. Modifiers are read when a note
// button goes down, and every later change to them is reported too, so a
// change just after the press can still count for the note.
//
// A finger held on a note button can slide onto another, which presses that
// button. Leaving the buttons keeps the note held until the finger lifts. A
// finger on the modifiers slides between semitone, octave and the zone at
// their shared edge that holds both, and leaving them keeps what it held.

const NOTE_KEYS = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8,
};
// Physical keys, so the layout does not matter. With fingers on 1 to 8, C and
// V sit under the thumbs. 9 and 0, next to 8 on the number row, do the same.
const MODIFIER_KEYS = {
  KeyC: { sharp: true, octave: false },
  KeyV: { sharp: false, octave: true },
  Digit9: { sharp: true, octave: false },
  Digit0: { sharp: false, octave: true },
};

// The width of the zone at the shared edge of the modifier buttons that holds
// both, as a share of the modifiers' width: one note button.
export const BOTH_ZONE = 1 / 8;

export function keyControl(code) {
  if (code in NOTE_KEYS) {
    return { type: 'note', button: NOTE_KEYS[code] };
  }
  if (code in MODIFIER_KEYS) {
    return { type: 'modifier', ...MODIFIER_KEYS[code] };
  }
  return null;
}

// The note button a finger holds after moving to `point`: the button under it,
// or the one it already holds, `held`, when it is off the buttons. `rects` are
// the on-screen rectangles of buttons 1 to 8.
export function slideTarget(held, point, rects) {
  const over = rects.findIndex((rect) =>
    point.x >= rect.left && point.x < rect.right &&
    point.y >= rect.top && point.y < rect.bottom);
  return over === -1 ? held : over + 1;
}

// The modifiers a finger holds at `point`: semitone on the left half of
// `rect`, octave on the right, both in the zone between them, or `held` when
// it is off the modifiers.
export function modifierTarget(held, point, rect) {
  if (point.x < rect.left || point.x >= rect.right || point.y < rect.top || point.y >= rect.bottom) {
    return held;
  }
  const offset = point.x - (rect.left + rect.right) / 2;
  if (Math.abs(offset) < ((rect.right - rect.left) * BOTH_ZONE) / 2) {
    return { sharp: true, octave: true };
  }
  return offset < 0 ? { sharp: true, octave: false } : { sharp: false, octave: true };
}

// How old an event time stamp may be, in milliseconds, and still be used. An
// event normally arrives well within this, so its time stamp is used, which is
// more accurate than the time it is handled.
//
// Safari on iPad sometimes gives a touch the time stamp of an earlier event
// while another finger is on the screen, up to seconds old. Such a stamp is
// past this age, so the handling time is used instead. One that slips under it
// is at most this far out, the width of the perfect window, so the press still
// matches its note.
export const MAX_EVENT_AGE = 50;

// The time of an event with time stamp `timeStamp` handled at `now`, both on
// the performance.now() clock: the time stamp if it is recent, otherwise the
// handling time.
export function eventTime(timeStamp, now) {
  const age = now - timeStamp;
  return age >= 0 && age <= MAX_EVENT_AGE ? timeStamp : now;
}

function timeOf(event) {
  return eventTime(event.timeStamp, performance.now());
}

export class Input {
  // `noteButtons` are elements with data-button (1 to 8). `modifierArea`
  // holds the two modifier buttons. `onModifiers` receives every change to
  // the held modifiers and `onChange` what is lit.
  constructor({ noteButtons, modifierArea, onPress, onRelease, onModifiers, onChange }) {
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.onModifiers = onModifiers;
    this.onChange = onChange;
    this.enabled = false;
    this.modifiersAllowed = false;
    this.sources = new Map();
    this.activeSource = null;
    this.modifiers = { sharp: false, octave: false };
    this.noteElements = noteButtons;
    this.modifierArea = modifierArea;

    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    window.addEventListener('keyup', (event) => this.handleKeyUp(event));
    window.addEventListener('blur', () => this.releaseAll(performance.now()));
    for (const element of noteButtons) {
      this.attachPointer(element, () => ({ type: 'note', button: Number(element.dataset.button) }));
    }
    this.attachPointer(modifierArea, (event) => this.modifiersAt(event.clientX));
    // A touch in a note button's rounded corner reaches the row of note
    // buttons itself, and counts as a touch on that button. The modifiers'
    // corners are covered above, since the whole modifier row is read from
    // position.
    const noteArea = noteButtons[0].parentElement;
    this.attachPointer(noteArea, (event) => this.noteAt(event.clientX, event.clientY),
      (event) => event.target === noteArea);
  }

  // The note button whose rectangle holds the point, or null.
  noteAt(x, y) {
    const rects = this.noteElements.map((element) => element.getBoundingClientRect());
    const button = slideTarget(null, { x, y }, rects);
    return button === null ? null : { type: 'note', button };
  }

  // The modifiers under a finger at `x` across the modifier buttons.
  modifiersAt(x) {
    const rect = this.modifierArea.getBoundingClientRect();
    return { type: 'modifier', ...modifierTarget({ sharp: false, octave: false }, { x, y: rect.top }, rect) };
  }

  enable(modifiersAllowed) {
    this.enabled = true;
    this.modifiersAllowed = modifiersAllowed;
  }

  disable() {
    this.releaseAll(performance.now());
    this.enabled = false;
  }

  handleKeyDown(event) {
    const control = keyControl(event.code);
    if (!this.enabled || !control || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    event.preventDefault();
    if (!event.repeat) {
      this.down(`key:${event.code}`, control, timeOf(event));
    }
  }

  handleKeyUp(event) {
    if (keyControl(event.code)) {
      this.up(`key:${event.code}`, timeOf(event));
    }
  }

  // `controlAt` gives the control under a pointer going down on `element`.
  // Only events that `accepts` are handled.
  attachPointer(element, controlAt, accepts = () => true) {
    const listen = (type, handler) => element.addEventListener(type, (event) => {
      if (accepts(event)) {
        handler(event);
      }
    });
    listen('pointerdown', (event) => {
      const control = this.enabled && event.button === 0 ? controlAt(event) : null;
      if (!control) {
        return;
      }
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      this.down(`pointer:${event.pointerId}`, control, timeOf(event));
    });
    listen('pointermove', (event) => this.slide(event));
    const end = (event) => this.up(`pointer:${event.pointerId}`, timeOf(event));
    listen('pointerup', end);
    listen('pointercancel', end);
    listen('lostpointercapture', end);
    listen('contextmenu', (event) => event.preventDefault());
  }

  down(id, control, time) {
    if (this.sources.has(id) || (control.type === 'modifier' && !this.modifiersAllowed)) {
      return;
    }
    this.sources.set(id, control);
    if (control.type === 'note') {
      this.activeSource = id;
      this.onPress({
        button: control.button,
        sharp: this.isHeld('sharp'),
        octave: this.isHeld('octave'),
        time,
      });
    }
    this.changed(time);
  }

  slide(event) {
    const id = `pointer:${event.pointerId}`;
    const control = this.sources.get(id);
    if (!this.enabled || !control) {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (control.type === 'modifier') {
      const held = modifierTarget(control, point, this.modifierArea.getBoundingClientRect());
      if (held.sharp !== control.sharp || held.octave !== control.octave) {
        this.sources.set(id, { type: 'modifier', sharp: held.sharp, octave: held.octave });
        this.changed(timeOf(event));
      }
      return;
    }
    const rects = this.noteElements.map((element) => element.getBoundingClientRect());
    const button = slideTarget(control.button, point, rects);
    if (button === control.button) {
      return;
    }
    this.sources.delete(id);
    this.down(id, { type: 'note', button }, timeOf(event));
  }

  up(id, time) {
    if (!this.sources.delete(id)) {
      return;
    }
    if (id === this.activeSource) {
      this.activeSource = null;
      this.onRelease({ time });
    }
    this.changed(time);
  }

  releaseAll(time) {
    for (const id of [...this.sources.keys()]) {
      this.up(id, time);
    }
  }

  isHeld(modifier) {
    for (const control of this.sources.values()) {
      if (control.type === 'modifier' && control[modifier]) {
        return true;
      }
    }
    return false;
  }

  changed(time) {
    const buttons = new Set();
    for (const control of this.sources.values()) {
      if (control.type === 'note') {
        buttons.add(control.button);
      }
    }
    const sharp = this.isHeld('sharp');
    const octave = this.isHeld('octave');
    if (sharp !== this.modifiers.sharp || octave !== this.modifiers.octave) {
      this.modifiers = { sharp, octave };
      this.onModifiers({ sharp, octave, time });
    }
    this.onChange({ buttons, sharp, octave });
  }
}
