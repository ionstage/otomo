# Otomo design

Otomo is an open-source cooperative music game. Players perform an existing
song together, each taking one part. Anyone should be able to enjoy it without
musical knowledge, and the goal is to enjoy playing together, not to compete.

This document records the direction agreed in discussion. Everything in it is
agreed, but the numbers and layouts are expected to need minor adjustment once
the first build can be played. Remaining open questions are collected at the
end.

## 1. Overview

- Players perform a song. Each player is responsible for one part.
- Parts nobody has taken are played automatically.
- Each player uses their own device, sees only their own part, and hears their
  own part from their own device. Players are in the same room and hear each
  other through the air.
- It runs in a web browser on desktop and mobile.
- Players are scored on accuracy, but never ranked against each other. The
  group sees a shared score such as the group average.

## 2. Controls

### Note buttons

Eight buttons, numbered 1 to 8, correspond to Do, Re, Mi, Fa, Sol, La, Ti, Do.

- Keyboard: number keys `1` to `8`.
- Touch and mouse: eight on-screen buttons.

The scale is **movable Do**: button 1 is whatever pitch the part currently
defines as Do. See [Do position](#do-position).

### Modifier buttons

Two modifiers can be held together with a note button, separately or both at
once.

| Modifier | Effect | Symbol | Keys |
|---|---|---|---|
| Semitone | Raises the note by a semitone | ♯ | `Z` or `,` |
| Octave | Raises the note by an octave | ↑ | `X` or `.` |

Both key pairs are always active, so either hand can take the modifiers while
the other plays the number keys. Ctrl, Alt and Cmd are not used because
browsers combine them with number keys to switch tabs.

### Do position

A part can change the pitch of Do at any point in the song. This one mechanism
covers both key changes and moving the playable range up or down. Each part has
its own Do position, since parts sit in different ranges.

Shifts should be rare, and placed where they feel natural for the phrase. They
are not announced on screen. Instead, each on-screen button shows its current
pitch name in small text beside the number (for example "1" with a small "D"),
and that text updates when Do moves.

### Difficulty

Each player chooses their own difficulty. Every song is playable at every
level.

| Level | The player controls | The game supplies |
|---|---|---|
| Beginner | Timing and duration. Any note button counts. | The whole pitch |
| Intermediate | Timing, duration and the note button (1 to 8) | Semitone and octave |
| Advanced | Timing, duration, note button and modifiers | Nothing |

The modifier buttons are unavailable in beginner and intermediate modes.

## 3. Sound

- The player hears the pitch they actually pressed, even when it is wrong.
- A note that is not pressed is silent. Autoplay never covers for a player.
- A note sounds for as long as its button is held.
- Sounds are synthesised with the Web Audio API. There are no audio files.

What "the pitch they pressed" means in each mode:

- **Beginner:** any button sounds the pitch of the written note nearest in
  time, so the player is always in tune.
- **Intermediate:** the pressed button sounds in the octave of the nearest
  written note. The semitone is applied only when the button matches that note.
- **Advanced:** exactly the button and modifiers pressed.

## 4. Screen

### Layout

The screen shows the player's own part as a piano roll laid out like sheet
music.

- The part is split into rows. Each row holds a whole number of bars, as many
  as fit the screen width. If not even one bar fits, the whole roll is drawn
  smaller, down to three quarters of full size. Below that, short notes are
  squeezed.
- The bars in a row share out the spare width, but a bar grows to at most
  1.25 times its narrowest width, so that wide screens do not ask for too
  much eye movement. The rows are then centred, and the margins on either
  side are plain background with no frame. This was chosen by comparing
  caps of 1, 1.1, 1.25 and 1.5 times and no cap.
- Bar lines follow the song's own time signature, so a song in 2/4 has a
  bar line every two beats. Rows of a 2/4 song are laid out the same way as
  those of a 4/4 song: they hold whole pairs of bars, counted from the start
  of the song, so a pair takes the width of one bar of 4/4.
- Notes are horizontal bars. Their length shows duration. They do not move.
- Each bar is a square head at its left end that curves into a slightly
  thinner tail, drawn as one shape. The head always takes up the same share of
  a sixteenth note, however wide the bars are drawn, so it grows taller with
  the row on wider screens, up to the cap on bar width. A sixteenth note is
  the head and a short tail, a quarter of the head's width, so every note
  shows a tail. When a note carries
  on to the next row, that part is tail only. Both sides of the break are
  square edges, to show the bar continues, and the bar runs right to the end
  of the row with no gap.
- On a correct press, even an early one, the number goes and the whole bar,
  head included, drops to the height of the tail, at the same moment as the
  hit effect appears.
- All bars are the same height in every difficulty. Height does not show pitch.
- Each bar has its button number (1 to 8) at its left end. In advanced mode, the
  modifier symbols "♯" and "↑" appear above the left end when needed.
- Numbers and symbols are drawn large so they read at a glance, in the system
  font (no font file). On a bar, the number is semibold (600) and 20/34 of the
  head's size, and the symbols are bold (700) at 18 px at full scale. On the
  on-screen buttons, the numbers are bold (700) at 1.75rem (1.5rem on short
  screens, where the buttons are lower) and the modifier symbols bold at
  1.6rem. Only the sizes were raised, not the weights. This was chosen by
  comparing sizes, weights and fonts side by side.
- In beginner mode, where any button plays, the bars show no numbers but
  keep their badge, empty. The buttons keep their numbers.
- In intermediate and advanced modes each bar has the colour of its button
  (see [Button colours](#button-colours)). In beginner mode, where any button
  plays, all bars share the colour a button fills with while held.
- Faint bar lines and beat marks in each row make the rhythm readable. The
  bar lines are stronger than the beat marks, and the end of the song is
  marked like a bar line.
- A current-position line moves from left to right along the row. At the end of
  the row it wraps to the start of the next.
- The current row stays near the top of the screen with the upcoming rows
  visible below. The view scrolls continuously at a slow, steady pace of one
  row per row of music, a row behind the line: the current row slides from
  the second slot up to the top slot as it is played, so the row just
  finished stays visible above it until the next row reaches the top. The
  first row stays at the top until the line reaches the second row. The line
  itself still jumps from the end of one row to the start of the next.

### Feedback while playing

| What the player does | What the bar does |
|---|---|
| Presses the correct note in time | An effect appears, and the part of the bar behind the line disappears as the line moves |
| Presses a wrong note | The part behind the line stays, faded |
| Presses nothing, or releases early | The unplayed part stays fully visible |

After a passage, the three outcomes look different: gone, faded, or untouched.

When a note is released too early (see
[Score for one note](#score-for-one-note-0-to-100)), the part left visible is the time remaining, rounded to the
note's own grid: the nearest sixteenth note, or the nearest third of a beat for
a triplet note. A press always takes some time, so even a very quick press and
release removes at least one step of that grid from the start of the bar. This
affects only the display. The score uses the exact release time.

### Buttons

The eight note buttons and two modifier buttons are always on screen, on
desktop as well. They light up when pressed, including when the press comes
from the keyboard.

Touch layout (needs testing on real phones): landscape
orientation, the eight note buttons in a row near the bottom, and the two
modifier buttons in a row below them. Each modifier button is as wide as four
note buttons: semitone below buttons 1 to 4, octave below buttons 5 to 8.

### Button colours

Each note button has its own colour, a rainbow by scale step, so a bar and the
button that plays it can be matched at a glance:

| Button | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Colour | Red | Orange | Yellow | Green | Teal | Blue | Purple | Magenta |

- The colour belongs to the button number, not to a pitch, so it stays the same
  when Do moves. Button 8 has its own colour rather than repeating button 1's.
- Modifiers do not change the colour. The "♯" and "↑" symbols show them.
- A bar's number sits on a small square badge in the centre of the bar's head,
  white with a dark number (dark with a light number in dark mode), so every
  number has the same colour and reads clearly on any bar. The badge and its
  number grow and shrink with the head, so their proportions to it never
  change. A row is always wide enough for a sixteenth note to hold a head of
  full size and its tail, whatever the part's shortest note is. On a wrong
  press, the badge fades with the bar.
- At rest, a button shows its colour as a thick bottom edge. While held, it
  fills with its colour and its number and pitch name sit on the same kind of
  badge. This style may change after play.
- A correct hit's effect is drawn in the bar's colour and spreads from the
  centre of the bar's head, showing which note was hit. The current-position
  line is neutral so that it does not clash with any bar.
- In beginner mode every button shares one colour: the thick bottom edge at
  rest and the fill while held. Every bar has that same colour, and so does
  a correct hit's effect. The buttons show their number but no pitch name.
- Colour always accompanies the number and never replaces it.

### Start of a song

A count-in of twelve beats comes before the song, to show when it begins and
set its timing. It is not part of the song data. Its timing is always three
bars of 4/4, also before a 2/4 song.

- The first 4/4 bar is silent, the second counts twice at half-note
  intervals, and the third counts four times at quarter-note intervals. The
  counts are heard as clicks only, all with the same sound and no accent on
  the first beat. Nothing is shown for them.
- On the roll the count-in is empty bars before bar 1, in the same rows as
  the song, with bar lines in the song's own time signature and beat marks:
  three bars before a 4/4 song, six before a 2/4 song. The current-position
  line moves through them in time, and the view scrolls as it does during
  the song.
- The count-in ends at beat 0 of the song data, so a song whose data starts
  with empty beats before a pickup keeps them after the count-in.

## 5. Scoring

Scoring rewards matching the written notes in pitch, timing and duration. The
numbers below will need tuning by playing.

### Matching presses to notes

- A press is matched to the nearest unjudged note whose start is within
  200 ms of the press.
- The first press matched to a note judges it. A wrong button cannot be
  corrected for that note.
- A press with no note in range sounds but does not affect the score.

### Score for one note (0 to 100)

A note scores 0 if it was missed or the wrong note was pressed. "Wrong" depends
on difficulty: any button is right in beginner, the button number must match in
intermediate, and the button and both modifiers must match in advanced.

Otherwise the score is the average of two parts:

- **Timing (0 to 100):** 100 if the press is within 50 ms of the note's start,
  falling in a straight line to 0 at 200 ms.
- **Duration (0 to 100):** the time the button was held as a percentage of the
  note's length, capped at 100. Holding too long is not penalised. A release
  shortly before the end counts as holding to the end, because the player
  needs a moment to release before pressing again, releasing slightly early can
  sound natural depending on the song, and some sounds ring on after the
  button is released. A beat is a quarter note.
  - Notes shorter than a beat: any press scores 100. There is no duration
    check.
  - Notes of a beat or longer: the release counts as holding to the end unless
    the time remaining is more than half the note's length or more than one
    beat. A quarter note therefore needs to be held for half its length.

### Song and group scores

- A player's song score is the average of their note scores.
- The group score is the average of the players' song scores. Individual scores
  are shown only on the player's own device.

## 6. Song data format

Songs are JSON files in our own format. JSON needs no
parser of our own and no build step. It is verbose to write by hand, which the
later composition tool and MIDI converter will address.

```json
{
  "format": 1,
  "title": "Ode to Joy",
  "composer": "Ludwig van Beethoven",
  "tempo": 120,
  "beatsPerBar": 4,
  "parts": [
    {
      "name": "Melody",
      "buttons": "scale",
      "sound": "lead",
      "events": [
        { "at": 0, "do": "D4" },
        { "at": 0, "length": 1, "button": 3 },
        { "at": 1, "length": 1, "button": 3 },
        { "at": 2, "length": 1, "button": 4 },
        { "at": 3, "length": 1, "button": 5, "octave": true },
        { "at": 4, "length": 0.5, "button": 4, "sharp": true }
      ]
    }
  ]
}
```

- `at` and `length` are in beats from the start of the song. A beat is always
  a quarter note.
- The shortest note is a sixteenth note (a `length` of 0.25). Faster phrases
  would be hard to play, and shorter bars leave no room for the button number.
- Each note starts and ends on the sixteenth-note grid (multiples of 0.25), or
  starts and ends on the triplet grid (multiples of ⅓). A note cannot start on
  one grid and end on the other. Whole beats are on both grids. A triplet
  therefore spans at least one beat, so eighth-note triplets are the shortest.
- JSON cannot hold ⅓ exactly, so a position within 0.001 of a grid position
  (written to at least three decimals, such as `0.333` or `1.6667`) is read as
  that grid position. Composition and conversion tools are expected to write
  positions this precisely.
- A `do` event sets the pitch of button 1 from that point on. The note name
  (such as `"D4"` or `"Bb3"`) also tells the game how to spell the pitch names
  shown on the buttons.
- A note event has a `button` (1 to 8) and optional `sharp` and `octave` flags.
- Notes in a part must not overlap. Each part is monophonic.
- `buttons` says what the eight buttons mean. Only `"scale"` exists now. The
  field leaves room for parts whose buttons are chords or percussion sounds.
- `sound` names one of the built-in synthesised sounds.
- The tempo and time signature are fixed for the whole song in format 1.

## 7. Technical approach

- Plain JavaScript using ES modules, with no framework and no build step.
- The game is a set of static files. Playing alone, with every other part on
  autoplay, runs entirely on one device.
- Because ES modules and `fetch` do not work from `file://`, the files must be
  served over HTTP, by any static file server or a static host.
- The game is published with GitHub Pages at https://www.ionstage.org/otomo/.
  A workflow deploys each push to `main`, copying only the files the game
  needs to run (`index.html`, `css/`, `js/`, `songs/`). Documentation and
  tests are left out.
- The Web Audio clock is the single time reference. Autoplay
  notes are scheduled slightly ahead on that clock, and key and touch events
  are converted to the same clock for judging.
- Scoring and pitch calculation are kept as pure functions, separate from
  audio and display, so they can be unit tested with Node's built-in test
  runner without adding dependencies.
- The project has no third-party dependencies. Adding one needs agreement
  first, partly because its licence could affect the project's licence.

## 8. First build

One device, one player, one song. Its purpose is to find out whether the
control scheme feels good and whether browser audio timing is tight enough,
especially on mobile.

Included:

- The piano-roll screen described above.
- Keyboard and touch input, with both modifiers.
- All three difficulty levels.
- Scoring and an end-of-song score.
- Autoplay for the other parts.
- "Ode to Joy" in a three-part arrangement written for this project: melody,
  harmony and bass. The song has no accidentals, so a short separate test
  piece exercises the semitone button.

Not included:

- More than one device.
- Percussion and chord parts.
- Any song editing.

## 9. Later

- **Multiple devices.** Further players connect to the first player's device.
  A browser page cannot accept incoming connections, so this needs either a
  small server program on the first player's computer (WebSocket, works without
  internet, host must be a computer) or WebRTC (any device can host, needs a
  small helper server on the internet to introduce the devices). The network
  only carries clock sync, the start signal and scores. Undecided.
- **Percussion parts**, where each of the eight buttons is a different
  percussive sound.
- **Chord parts**, where each of the eight buttons is one of the chords used in
  the song.
- **Composition tool** for writing songs in the format.
- **MIDI conversion** into the format.
- **Sampled instrument sounds.**
- **Online play.** Deferred because of network latency.

## 10. Open questions

1. **Tuning after play.** The scoring windows and weights in section 5 and the
   touch layout in section 4 are agreed as starting points. They may change
   once the first build has been played, including on a real phone.
2. **Latency calibration.** Some devices, and all Bluetooth speakers and
   headphones, delay sound noticeably. A per-device offset setting may be
   needed. Whether it is will be clearer after the first build runs on phones.
3. **Licence.** The MIT License is intended. It may change if the licence of a
   library the project comes to depend on requires it. No `LICENSE` file has
   been added yet.
4. **Multi-device connection method.** See section 9.
