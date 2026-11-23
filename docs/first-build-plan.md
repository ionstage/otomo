# First build plan

This is the handoff for implementing the first build described in section 8 of
[design.md](design.md). The design document says what to build. This document
suggests how, and lists what the design leaves undecided.

All seven steps below have been implemented, and the user has made the checks
for steps 2, 3, 4 and 6, including on a real phone, with no particular issues.
What remains is the tuning described in "After the first build".

## Suggested file layout

This is a suggestion. Change it if a better split appears.

```
index.html
css/style.css
js/main.js      wiring and screens (setup, play, result)
js/pitch.js     note names, MIDI numbers, scale positions, button pitch names
js/song.js      load and validate a song, resolve events to notes with
                absolute pitch and time in seconds
js/judge.js     match presses to notes and score them
js/audio.js     audio context, synth voices, autoplay scheduler, count-in
js/input.js     keyboard and pointer events as presses and releases stamped
                with audio-clock time
js/roll.js      piano-roll drawing and feedback
songs/ode-to-joy.json
songs/rondo-alla-turca.json
songs/minuet-in-g.json
tools/arrange.js        score and choose a part's scale position (pure)
tools/arrange-songs.js  re-arrange the song files with it
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
7. **Songs.** The full three-part "Ode to Joy". An
   early stub of the melody is enough for steps 2 to 6.

## Technical notes

- **Starting audio.** Browsers only start an `AudioContext` from a user gesture.
  Start or resume it from the button that begins the song. iOS Safari is the
  strictest.
- **Scheduling.** Schedule autoplay notes a short time ahead on the audio clock
  from a repeating timer. Do not rely on timer accuracy for when notes sound.
- **Input time.** Judge presses on the audio clock. `event.timeStamp` is on the
  `performance.now()` clock, and `audioContext.getOutputTimestamp()` gives a
  matching pair of times for converting between the two. Use an event's time
  stamp only when it is at most 50 ms old, and the time it is handled
  otherwise. Safari on iPad sometimes gives a touch the time stamp of an
  earlier event while another finger is on the screen, such as one holding a
  modifier, up to seconds old. Measured on an iPad, genuine touches arrived a
  median 12 ms after their time stamp, and 99% within 28 ms.
- **Keys.** Use `event.code` (`Digit1` to `Digit8`, `KeyC`, `KeyV`, `Digit9`, `Digit0`) so keyboard layout and held modifier keys do not change which key
  is seen. Ignore events where `event.repeat` is true.
- **Touch.** Use pointer events with `touch-action: none`. Several buttons are
  held at once, so track each pointer separately. Suppress text selection, the
  long-press menu and double-tap zoom on the play screen. iOS Safari still
  shows its magnifier on a double tap and hold unless `touchstart` is
  cancelled (with a non-passive listener).
- **Serving.** ES modules and `fetch` need HTTP. `python3 -m http.server` in the
  repository root is enough for development.

## Not yet decided

These were left open by the design, each with a suggested default. All have
now been implemented and recorded in the design as agreed, so this table only
points to where. For any new gap, implement a small default and report it to
the user, and ask before doing anything larger, because the project is being
developed by discussion.

| Topic | Suggested default |
|---|---|
| Visual style (fonts, the hit effect) | Decided: plain and minimal, in the system font. See the start of section 4 of the design, "Button colours" for the hit effect, and "Layout". Ask before investing in a different look. |
| Setup screen (choosing song, part and difficulty) | Decided: see "Setup screen" in section 4 of the design. |
| Result screen | Decided: see "End of a song" in section 4 of the design. |
| Pressing a second note button while one is held | Decided: the new note replaces the old one. See "Note buttons" in section 2 of the design. |
| Pause and restart during a song | Decided: Quit pauses the song and asks for confirmation. See "Quitting a song" in section 4 of the design. |
| Volume balance between the player and autoplay | Decided: the player's part slightly louder. See section 3 of the design. |
| How many beats of width a row uses | Decided: see "Layout" in section 4 of the design. |

## Arrangement notes

- "Ode to Joy" is public domain. The three-part arrangement (melody, harmony,
  bass) is to be written for this project, not copied from a modern edition.
- The original key is D major.
- The melody runs from the Sol below Do to the Sol above it, so button 1 is
  on that low Sol (A3). The melody then needs no shifts and no octave presses.
  The harmony and bass have Do on button 1.
- "Rondo alla Turca" (Mozart, K. 331) was added to check how sixteenth notes
  look. It is the first A-minor section (bars 1 to 24), with the repeat of
  the pickup and bars 1 to 8 written out, and bars 9 to 24 played once. The
  data starts with the pickup bar, so the pickup starts at beat 1 and bar 1 at
  beat 2. The notes follow the public-domain Mutopia Project edition (piece
  108, typeset from IMSLP). The melody is the right hand's top
  note, without the grace notes, and with the trill near the end played as a
  plain note. The harmony is the upper note of each left-hand chord, and the
  bass is the lowest left-hand note.
- It is in A minor, played on the C major scale, so G♯ and D♯ use "♯". There
  are no shifts. Button 1 is G4 in the melody, G3 in the harmony and A2 in the
  bass. The tempo is slowed to 80 so the sixteenths stay playable.
- "Minuet in G" (BWV Anh. 114, now attributed to Christian Petzold) replaced
  the semitone test piece, and is the first song in 3/4. It is the whole
  minuet with each half played once, without the repeats (bars 1 to 32). The
  notes follow the public-domain Mutopia Project edition (piece 75, typeset
  from the Bach-Gesellschaft edition). The melody is the right hand without
  the grace note and ornaments, and the bass is the lowest left-hand note.
  The original has only two voices, so the harmony is written for this
  project: a middle voice in quarter and half notes.
- It is in G major, so the C♯ in the second half uses "♯". There are no
  shifts. Button 1 is D4 in the melody and Do (G3 and G2) in the harmony and
  bass. The tempo is 112, a comfortable speed for the eighth notes.

## After the first build

The user plans to play it and then adjust scoring numbers, the touch layout and
other details. Expect a round of tuning before any work on multiple devices.
