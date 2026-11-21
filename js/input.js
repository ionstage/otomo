// Keyboard and pointer input, reported as presses and releases with event
// time stamps on the performance.now() clock.
//
// Modifiers are read when a note button goes down. A part is monophonic, so a
// new note press replaces the held one, and releasing the replaced button
// does nothing.
//
// A finger held on a note button can slide onto another, which presses that
// button. Leaving the buttons keeps the note held until the finger lifts.

const NOTE_KEYS = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8,
};
const MODIFIER_KEYS = { KeyZ: 'sharp', Comma: 'sharp', KeyX: 'octave', Period: 'octave' };

function keyControl(code) {
  if (code in NOTE_KEYS) {
    return { type: 'note', button: NOTE_KEYS[code] };
  }
  if (code in MODIFIER_KEYS) {
    return { type: 'modifier', modifier: MODIFIER_KEYS[code] };
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

// Event time stamps share the performance.now() clock in current browsers.
// Fall back to the handling time if one does not look like it.
function eventTime(event) {
  const now = performance.now();
  return Math.abs(event.timeStamp - now) < 1000 ? event.timeStamp : now;
}

export class Input {
  // `buttons` are elements with data-button (1 to 8) or data-modifier
  // ("sharp" or "octave"). `onChange` receives what is lit.
  constructor({ buttons, onPress, onRelease, onChange }) {
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.onChange = onChange;
    this.enabled = false;
    this.modifiersAllowed = false;
    this.sources = new Map();
    this.activeSource = null;
    this.noteElements = buttons.filter((element) => !element.dataset.modifier);

    window.addEventListener('keydown', (event) => this.handleKeyDown(event));
    window.addEventListener('keyup', (event) => this.handleKeyUp(event));
    window.addEventListener('blur', () => this.releaseAll(performance.now()));
    for (const element of buttons) {
      this.attachButton(element);
    }
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
      this.down(`key:${event.code}`, control, eventTime(event));
    }
  }

  handleKeyUp(event) {
    if (keyControl(event.code)) {
      this.up(`key:${event.code}`, eventTime(event));
    }
  }

  attachButton(element) {
    const control = element.dataset.modifier
      ? { type: 'modifier', modifier: element.dataset.modifier }
      : { type: 'note', button: Number(element.dataset.button) };
    element.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.button !== 0) {
        return;
      }
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      this.down(`pointer:${event.pointerId}`, control, eventTime(event));
    });
    if (control.type === 'note') {
      element.addEventListener('pointermove', (event) => this.slide(event));
    }
    const end = (event) => this.up(`pointer:${event.pointerId}`, eventTime(event));
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener('lostpointercapture', end);
    element.addEventListener('contextmenu', (event) => event.preventDefault());
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
    this.changed();
  }

  slide(event) {
    const id = `pointer:${event.pointerId}`;
    const control = this.sources.get(id);
    if (!this.enabled || control?.type !== 'note') {
      return;
    }
    const rects = this.noteElements.map((element) => element.getBoundingClientRect());
    const button = slideTarget(control.button, { x: event.clientX, y: event.clientY }, rects);
    if (button === control.button) {
      return;
    }
    this.sources.delete(id);
    this.down(id, { type: 'note', button }, eventTime(event));
  }

  up(id, time) {
    if (!this.sources.delete(id)) {
      return;
    }
    if (id === this.activeSource) {
      this.activeSource = null;
      this.onRelease({ time });
    }
    this.changed();
  }

  releaseAll(time) {
    for (const id of [...this.sources.keys()]) {
      this.up(id, time);
    }
  }

  isHeld(modifier) {
    for (const control of this.sources.values()) {
      if (control.type === 'modifier' && control.modifier === modifier) {
        return true;
      }
    }
    return false;
  }

  changed() {
    const buttons = new Set();
    for (const control of this.sources.values()) {
      if (control.type === 'note') {
        buttons.add(control.button);
      }
    }
    this.onChange({ buttons, sharp: this.isHeld('sharp'), octave: this.isHeld('octave') });
  }
}
