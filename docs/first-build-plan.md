# First build plan

This is the handoff for implementing the first build described in section 8 of
[design.md](design.md). The design document says what to build. This document
suggests how, and lists what the design leaves undecided.

Nothing has been implemented yet. The repository contains only documents.

## Suggested file layout

This is a suggestion. Change it if a better split appears.

```
index.html
css/style.css
js/main.js      wiring and screens (setup, play, result)
js/pitch.js     note names, MIDI numbers, scale offsets, button pitch names
js/song.js      load and validate a song, resolve events to notes with
                absolute pitch and time in seconds
js/judge.js     match presses to notes and score them
js/audio.js     audio context, synth voices, autoplay scheduler, count-in
js/input.js     keyboard and pointer events as presses and releases stamped
                with audio-clock time
js/roll.js      piano-roll drawing and feedback
songs/ode-to-joy.json
songs/semitone-test.json
test/*.test.js
```

`pitch.js`, `song.js` and `judge.js` should be pure, with no DOM or audio
access, so they can be tested with `node --test`. Node needs a minimal
`package.json` containing `"type": "module"` to load the same ES modules the
browser loads. That file is not a build step and must not gain dependencies.

## Suggested order

Each step ends with something that can be checked.

1. **Pure logic and tests.** Pitch calculation, song loading, and judging,
   covering every rule in sections 3 and 5 of the design. Check: tests pass.
2. **Autoplay.** Play all parts of a song from start to end with a count-in.
   Check: the song sounds right by ear.
3. **Static roll.** Draw one part in rows with the moving line in time with the
   audio. Check: the line crosses each bar's left end as the note sounds.
4. **Playing.** Keyboard input, the player's own sound, judging, and bar
   feedback, with the player's part removed from autoplay. Check: advanced mode
   is playable on a desktop keyboard.
5. **Difficulty, setup and result.** The three levels, choosing a part, and the
   end-of-song score.
6. **Touch.** On-screen buttons and the phone layout. Check: playable on a real
   phone, which the user will need to try.
7. **Songs.** The full three-part "Ode to Joy" and the semitone test piece. An
   early stub of the melody is enough for steps 2 to 6.

## Technical notes

- **Starting audio.** Browsers only start an `AudioContext` from a user gesture.
  Start or resume it from the button that begins the song. iOS Safari is the
  strictest.
- **Scheduling.** Schedule autoplay notes a short time ahead on the audio clock
  from a repeating timer. Do not rely on timer accuracy for when notes sound.
- **Input time.** Judge presses on the audio clock. `event.timeStamp` is on the
  `performance.now()` clock, and `audioContext.getOutputTimestamp()` gives a
  matching pair of times for converting between the two.
- **Keys.** Use `event.code` (`Digit1` to `Digit8`, `KeyZ`, `KeyX`, `Comma`,
  `Period`) so keyboard layout and held modifier keys do not change which key
  is seen. Ignore events where `event.repeat` is true.
- **Touch.** Use pointer events with `touch-action: none`. Several buttons are
  held at once, so track each pointer separately. Suppress text selection, the
  long-press menu and double-tap zoom on the play screen. iOS Safari still
  shows its magnifier on a double tap and hold unless `touchstart` is
  cancelled (with a non-passive listener).
- **Serving.** ES modules and `fetch` need HTTP. `python3 -m http.server` in the
  repository root is enough for development.

## Not yet decided

The design does not cover these. Each has a suggested default. Small ones can
be implemented with the default and reported to the user. Ask the user before
doing anything larger, because the project is being developed by discussion.

| Topic | Suggested default |
|---|---|
| Visual style (fonts, the hit effect) | Plain and minimal. Ask before investing in a look. Note button colours are decided: see "Button colours" in section 4 of the design. |
| Setup screen (choosing song, part and difficulty) | One simple screen with three choices and a start button. |
| Result screen | The song score out of 100 and a way to play again. |
| Changing a modifier while a note is held | Modifiers are read when the note button goes down. Later changes do not affect the sounding note. |
| Pressing a second note button while one is held | The new note replaces the old one, because a part is monophonic. The old note's duration stops counting. |
| Pause and restart during a song | A way to quit to the setup screen. No pause. |
| Volume balance between the player and autoplay | The player's part slightly louder. |
| How many beats of width a row uses | Wide enough that the shortest note in the part fits its number label. Since the shortest note is a sixteenth, a beat never needs more than four label widths. |

## Arrangement notes

- "Ode to Joy" is public domain. The three-part arrangement (melody, harmony,
  bass) is to be written for this project, not copied from a modern edition.
- The original key is D major.
- The melody dips once to the Sol below Do. In advanced mode this needs the Do
  position to sit an octave lower for that phrase, with the other notes played
  using the octave button. Place the shift at a phrase boundary, never around
  the single note. The user accepts shifts only where they feel natural for the
  phrase.
- The semitone test piece only needs to be a few bars that use "♯" alone and
  together with "↑".

## After the first build

The user plans to play it and then adjust scoring numbers, the touch layout and
other details. Expect a round of tuning before any work on multiple devices.
