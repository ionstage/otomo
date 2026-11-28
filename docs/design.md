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
  own part loudest from their own device. Players are in the same room. Each
  player's notes, as they play them, also sound more quietly from the other
  devices, so the whole band comes from every device.
- It runs in a web browser on desktop and mobile.
- Players are scored on accuracy, but never ranked against each other. The
  group sees a shared score such as the group average.

## 2. Controls

### Note buttons

Eight buttons, numbered 1 to 8, play eight consecutive notes of a major scale,
rising from button 1. Button 8 is an octave above button 1.

- Keyboard: number keys `1` to `8`.
- Touch and mouse: eight on-screen buttons.

The scale is **movable**: the part sets which major scale the buttons play and
which note of it is on button 1. Button 1 does not have to be Do. See
[Scale position](#scale-position).

A part is monophonic, so only one note sounds at a time. Pressing a note
button while another is held replaces the held note: the old note stops
sounding and its held time stops counting at that press. Releasing the
replaced button afterwards does nothing.

### Modifier buttons

Two modifiers can be held together with a note button, separately or both at
once.

| Modifier | Effect | Symbol | Keys |
|---|---|---|---|
| Semitone | Raises the note by a semitone | ♯ | `C`, `9` |
| Octave | Raises the note by an octave | ↑ | `V`, `0` |

The keys are for playing with both hands on the number keys: the left hand's
little to index fingers on 1 to 4, the right hand's index to little fingers on
5 to 8. That leaves the thumbs free for C and V, below the middle of that row.
9 and 0, next to 8 on the number row, do the same as C and V. They are
physical keys, so the keyboard layout does not change them. Ctrl, Alt
and Cmd are not used because browsers combine them with number keys to switch
tabs.

The modifiers do not have to go down before the note. Frequent semitone and
octave changes were hard to play on a touchscreen. A modifier pressed or
released up to 60 ms after a note button still counts for that note, for
scoring as well as sound. The note and its modifiers can therefore be pressed
together in any order. Timing is still measured from the note button. After
those 60 ms, changing a modifier does not affect the sounding note, so a
modifier can be held down early for the next note.

### Scale position

A part's scale position is two things: the pitch of Do, which picks the major
scale, and the note of that scale on button 1. For example, with Do on D4 and
button 1 on the Sol below it, the buttons play A3, B3, C♯4, D4, E4, F♯4, G4
and A4.

A minor song uses the major scale of its relative major with button 1 on La.
A minor is Do on C with button 1 on A, which gives the natural minor scale.
Other scale patterns, such as harmonic minor, are not used for now.

A part can change its scale position at any point in the song. This one
mechanism covers both key changes and moving the playable range up or down.
Each part has its own scale position, since parts sit in different ranges.

The arranger chooses the scale position, and how each note is played. The
tool `tools/arrange-songs.js` applies the rules below to parts without shifts,
and reports the counts for each part. Do is the song's key, or the relative
major for a minor song. Two rules about shifts come first, strictly:

1. Never shift in the middle of a phrase. Shifts go where they feel natural
   for the phrase.
2. Use as few shifts as possible. A shift is used only when a note cannot be
   reached otherwise, with the octave modifier if needed. Saving other costs
   is not a reason to shift.

Within those, the note on button 1 and the way each note is played are chosen
for the lowest total of these costs:

| Cost | Weight |
|---|---|
| Pressing the octave modifier (once for a run of notes it is held through) | 2 |
| Each note with the semitone modifier | 2 |
| Each wide jump: consecutive notes five or more buttons apart, such as between buttons 1 or 2 and 7 or 8 | 1 |
| Each note with the octave modifier | 0.4 |

- A modifier needed by several notes in a row can be held through them, so a
  run of octave notes costs one press. Rests do not break a run.
- The same pitch can often be played two ways, such as button 8 or button 1
  with "↑", and "8♯" or "1♯↑". The cheaper one is used. Inside a run held with
  "↑", "1♯↑" saves a press, and next to button 2 it also allows a slide, where
  button 8 would be a wide jump.
- Sliding only works between neighbouring buttons, and buttons 1 to 4 and 5 to
  8 are played by different hands on the keyboard, so wide jumps are hard,
  especially repeated ones.
- The cost of each note with "↑" stops a part from holding it through almost
  the whole song, which would be a shift in disguise.
- The weights are a starting point, to be adjusted after the songs have been
  played. If the costs tie, Do goes on button 1, otherwise the highest tied
  note.

Shifts are not announced on screen. Instead, each on-screen button shows its
current pitch name in small text beside the number (for example "1" with a
small "D"), and that text updates when the scale position moves.

### Difficulty

Each player chooses their own difficulty. Every song is playable at every
level.

| Level | The player controls | The game supplies |
|---|---|---|
| Beginner | Timing and duration. Any note button counts. | The whole pitch |
| Intermediate | Timing, duration and the note button (1 to 8) | Semitone and octave |
| Advanced | Timing, duration, note button and modifiers | Nothing |

The modifier buttons are hidden in beginner and intermediate modes.

Buttons 1 and 8 are the same note of the scale an octave apart, and some
pitches can be played more than one way. What counts as the right note:

- **Intermediate:** the written button, or button 1 for a written 8 and button
  8 for a written 1, since the game supplies the octave.
- **Advanced:** any button and modifiers that play the written pitch. For
  example 1↑ for 8, 8 for 1↑, 1♯↑ for 8♯, or 3♯ for 4 where 3 and 4 are a
  semitone apart. The roll shows the way the arranger chose.

## 3. Sound

- The player hears the pitch they actually pressed, even when it is wrong.
- A note that is not pressed is silent. Autoplay never covers for a player.
- A note sounds for as long as its button is held.
- Sounds are synthesised with the Web Audio API. There are no audio files.
- The player's own part is slightly louder than the autoplay parts.

What "the pitch they pressed" means in each mode:

- **Beginner:** any button sounds the pitch of the written note nearest in
  time, so the player is always in tune.
- **Intermediate:** a press of the right note (see
  [Difficulty](#difficulty)) sounds exactly the written pitch, including its
  semitone and octave, even for button 1 against a written 8 or the reverse.
  Any other button sounds with the written note's octave modifier and no
  semitone. With no note in range, only the written button of the nearest
  note sounds its pitch, so button 8 is always an octave above button 1
  except when matched to a written 1 or 8.
- **Advanced:** exactly the button and modifiers pressed.

## 4. Screen

The look is plain and minimal, in the system font with no font files, with
light and dark versions that follow the device's setting.

### Setup screen

The game opens on one setup screen with three choices and a Start button:

- **Song**, from the list of songs.
- **Part**, from the chosen song's parts.
- **Difficulty**: Beginner, Intermediate or Advanced, each with a one-line
  description.

Below them, a short help text lists the keys. Start begins the song with its
count-in (see [Start of a song](#start-of-a-song)).

### Layout

The screen shows the player's own part as a piano roll laid out like sheet
music.

- The part is split into rows of one bar each, so that following the music
  across a row break needs little eye movement. Several bars to a row made
  the eye scan a wider area at each break. If the bar does not fit the
  screen width, the whole roll is drawn smaller, down to three quarters of
  full size. Below that, short notes are squeezed.
- The bar takes the spare width, but grows to at most 1.25 times its
  narrowest width, so that wide screens do not ask for too much eye
  movement. The rows are then centred, and the margins on either side are
  plain background with no frame. This was chosen by comparing caps of 1,
  1.1, 1.25 and 1.5 times and no cap. Wider bars mean larger heads and
  taller rows, so the bar also grows only while the roll still shows two
  and a half rows below the space above the first row. The next row is
  then fully in view by halfway through the current one. The bar is not
  made narrower than its narrowest to reach that.
- Short screens are those 500 px tall or less, which includes every phone
  in landscape. They keep less space around the rows and have lower
  buttons. The line was first at 420 px, but a 956×440 screen then got the
  larger space and buttons and showed fewer rows than an 852×393 one.
- Bar lines follow the song's own time signature, so a song in 2/4 has a
  bar line every two beats. Rows of a 2/4 song are laid out the same way as
  those of a 4/4 song: each holds a pair of bars, counted from the start of
  the song, so a pair takes the width of one bar of 4/4. A row of a 3/4 song
  holds one bar of 3/4, three quarters as wide as a bar of 4/4.
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
  modifier symbols "♯" and "↑" appear above the left end when needed, on a
  mark as wide as the head and 20 px tall, with a 6 px gap between them (at
  full scale). The mark has the modifier's colour and its shape: its top corner is rounded on the left for
  "♯", on the right for "↑", and on both sides for both, with square bottom
  corners, with the "♯" half on the left (see
  [Button colours](#button-colours)). Like the number, it goes on a correct
  press and fades on a wrong one. While a modifier is held, every mark for it
  on the roll moves down to close the gap and sit on its head. In a "♯↑"
  mark each half moves with its own modifier. While both modifiers are
  held, only "♯↑" marks move, and marks for only one modifier stay up. This is being tried and may
  change after play.
- Numbers and symbols are drawn large so they read at a glance, in the system
  font (no font file). On a bar, the number is semibold (600) and 24/34 of the
  head's size, and the symbols are bold (700) at 18 px at full scale. On the
  on-screen buttons, the numbers are bold (700) at 1.75rem (1.5rem on short
  screens in advanced mode, where the buttons are lower) and the modifier
  symbols bold at 1.6rem. Only the sizes were raised, not the weights. This
  was chosen by comparing sizes, weights and fonts side by side.
- In beginner mode, where any button plays, the bars show no numbers but
  keep their badge, empty. The buttons keep their numbers.
- In intermediate and advanced modes each bar has the colour of its button
  (see [Button colours](#button-colours)). In beginner mode, where any button
  plays, all bars share the colour a button fills with while held.
- Faint lines in each row make the rhythm readable at three levels: bar
  lines, beat marks, and sixteenth-note lines between them. Each level is
  lighter than the one above, and the end of the song is marked like a bar
  line. The lines are drawn behind the notes and run the full height of the
  row's display area (see below).
- The current position moves from left to right along the row. At the end of
  the row it wraps to the start of the next. It is shown by two triangles,
  with no line between them: one above the row's display area pointing down,
  and one below it pointing up. They bounce once per beat, like a ball:
  closest to the display area exactly on each beat, and furthest halfway
  between beats. Like a ball, they squash as they land, flatter and wider
  around the moment of the beat. They bounce through the count-in as well.
  Below, "the line" means this current position.
- The triangles are 22 px wide and 16 px tall, bounce 12 px, and have
  slightly rounded corners and a 2 px outline in the roll's background
  colour. They are brown (a light tan in dark mode), a colour no note uses.
  This was chosen by comparing near-black, brown and deep orange, and
  several sizes and styles, side by side.
- The beat the line is in has a subtle highlight, a faint band as tall as the
  row's display area, behind the notes. It moves on at each beat, through
  the count-in as well. It is kept faint so that it does not distract.
- Each row has a display area that reaches 40 px above and below its notes
  (30 px on short screens), with the notes in the middle. The current-beat
  band and the grid lines span it, and the triangles sit just outside it.
  It reaches past the modifier marks, so the triangles never overlap the
  marks of their own row. Rows are not spaced further apart: there is a
  16 px gap between two rows' display areas. The triangles are the same size
  on every screen and may reach past the gap into the neighbouring row,
  where the outline keeps them clear. That is accepted, since they only mark
  the beat being played and so do not distract.
- Above the first row there is 40 px of space (24 px on short screens), so
  that the top triangle has clear space above it. The view keeps this space
  as it scrolls.
- The play screen has no header, so the roll has the most height on short
  screens. Above that space, before the first row, the song title is shown
  on one line and the part name directly below it, smaller and muted.
  Titles can be long, so each has its own line, cut short with "…" if it
  does not fit. The title starts at the rows' left edge, but is indented to
  clear the back button (see [Quitting a song](#quitting-a-song)). It
  scrolls with the rows and leaves the screen during the count-in, since it
  is only needed at the start.
- Row height is fixed, and does not grow to fill a tall screen. It is the same
  in every mode, even where there are no marks, so that the roll does not
  change with the difficulty. On short screens the rows are smaller, but on
  the shortest phones the roll still shows a little under two and a half
  rows, so the next row comes fully into view later in the current row.
  Removing the gap between rows would fix that, but was not chosen.
- The current row stays near the top of the screen with the upcoming rows
  visible below. The view scrolls continuously at a slow, steady pace of one
  row per row of music, a row behind the line: the current row slides from
  the second slot up to the top slot as it is played, so the row just
  finished stays visible above it until the next row reaches the top. The
  view starts with the title at the top and begins to move at the same
  pace just early enough that the title has left the screen when the line
  reaches the second row, so the title and the rows scroll at one constant
  pace. The line itself still jumps from the end of one row to the start
  of the next.

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

The eight note buttons are always on screen, on desktop as well. The two
modifier buttons are on screen in advanced mode only. They light up when
pressed, including when the press comes from the keyboard.

Touch layout, checked on a real phone: landscape orientation, the eight note buttons in a row along the bottom, and the two
modifier buttons in a row above them. Each modifier button is as wide as four
note buttons: semitone above buttons 1 to 4, octave above buttons 5 to 8. In
beginner and intermediate modes, where the modifier buttons are hidden, the
note buttons grow taller to fill their space.

In advanced mode the modifier buttons join the note buttons with no gap. The
note buttons keep their rounded bottom corners, and the modifier buttons'
top corners are rounded as described under
[Button colours](#button-colours). The modifiers sit above the note
buttons as their marks sit above the note heads on the roll. For touch, each button's whole rectangle is its
own, so the small notches left by rounded corners belong to the button whose
corner they are: a note button's to that note button, a modifier button's to
that modifier button. The note buttons
reach down to the bottom of the screen with no padding below, so that space
is part of them too. The modifier buttons are 62 px tall (54 px on short
screens), the height of the gap and padding they replaced when they were
below the note buttons, so the roll keeps its height.

The two modifier buttons sit side by side with no gap. A third button, one
note button wide, is laid over the centre where they meet. It holds both
modifiers at once, so "♯↑" needs one finger. It has no text or symbol: its
left half is pink and its right half blue-grey, and lines along its top,
left and right edges show that the central area is one place to press. The
two modifier buttons have the same lines along their top and outer edges.
The lines are 2 px at the sides and 1 px along the top. The line between
the modifier buttons and the note buttons is 1 px, a little darker than the
usual border colour. Where they
meet, the "♯↑" button covers them, so it stays one undivided area.

The note buttons sit side by side with no gap, like piano keys. Their top
corners are square and their bottom corners rounded, and neighbours share one
border line. A single line across the full width of the screen separates the
roll from the buttons, in place of a top border on each note button. The
buttons are no wider than a row of 4/4 would be on that screen, and centred
below the roll, so they are the same width in every song. On wide screens
their outer edges line up with the rows' edges in 4/4 and 2/4 songs, and
reach beyond the narrower rows of a 3/4 song. The line stays full width.

A finger or mouse held on a note button can slide onto another without lifting:
- Entering another note button presses it, exactly as a new press would. The
  held note ends there and the modifiers are read at that moment. Scoring
  treats it as any other press, so a button crossed on the way is pressed too
  and can score a note as wrong.
- The next button takes over as soon as the finger crosses the boundary.
- Leaving the note buttons, for example onto the roll, keeps the note held
  until the finger lifts. Coming back onto the same button does nothing.
- A finger whose note was replaced by another finger's press takes over again
  when it slides onto a different button.
- A finger on the modifiers also slides: between semitone, the "♯↑" zone and
  octave, changing the held modifiers as it crosses. Leaving the modifiers
  keeps what it held until the finger lifts.

### Button colours

Each note button has its own colour, a rainbow by button position, so a bar
and the button that plays it can be matched at a glance:

| Button | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Colour | Red | Orange | Yellow | Green | Teal | Blue | Purple | Magenta |

- The colour belongs to the button number, not to a pitch, so it stays the same
  when the scale position moves. Button 8 has its own colour rather than
  repeating button 1's.
- Modifiers do not change a note's colour. The "♯" and "↑" marks show them.
- The modifiers have colours of their own, paler and greyer than any note
  colour so that they cannot be taken for a note button: light pink for
  semitone and light blue-grey for octave (muted dark versions in dark
  mode). The modifier buttons are filled with their colour at rest and with
  a deeper version while held. The "♯↑" button is pink on its left half
  and blue-grey on its right, and each half deepens while its modifier is
  held.
- Each modifier also has a shape, so it can be told apart without colour.
  Only top corners are rounded: the modifier row as a whole is rounded at
  its outer top corners (the semitone button's top left and the octave
  button's top right), and the "♯↑" button over the centre at both of its
  top corners, with a larger radius than the note buttons. The cutouts at
  the "♯↑" button's corners show the buttons underneath. Bottom corners are
  square. The marks on the roll match: top corner rounded on the left,
  the right, or both, so the rounded side points to the button that plays
  it.
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
  centre of the bar's head, showing which note was hit. The triangles that
  show the current position are brown, which no note uses, so that they do
  not clash with any bar.
- In beginner mode every button shares one colour: the thick bottom edge at
  rest and the fill while held. Every bar has that same colour, and so does
  a correct hit's effect. The buttons show their number but no pitch name.
- Colour always accompanies the number and never replaces it.

### Start of a song

A count-in of three bars comes before the song, to show when it begins and
set its timing. It is not part of the song data.

- Before a 3/4 song the count-in is three bars of 3/4. The first bar is
  silent, the second counts on beats 1 and 3, and the third counts every
  beat, so the last four counts are on consecutive beats.
- Before any other song, 2/4 included, the count-in is three bars of 4/4. The
  first bar is silent, the second counts twice at half-note intervals, and
  the third counts four times at quarter-note intervals.
- The counts are heard as clicks only, all with the same sound and no accent
  on the first beat. No count is shown, but the line's triangles bounce and
  the current beat is highlighted, as during the song.
- On the roll the count-in is empty bars before bar 1, in the same rows as
  the song, with bar lines in the song's own time signature and beat marks:
  three bars before a 3/4 or 4/4 song, six before a 2/4 song. The
  current position moves through them in time, and the view scrolls as
  it does during the song.
- The count-in ends at beat 0 of the song data, so a song whose data starts
  with empty beats before a pickup keeps them after the count-in.

### Quitting a song

A back icon button, named "Quit" for screen readers, is in the top-left
corner of the roll. It does not scroll. It is faint and semi-transparent,
growing clearer on hover or focus, so that it does not draw attention from
the music, but its touch area is a full 44 px. The top-left is a familiar
place for a back button, and the player's eye moves from the lower left
towards the upper right as the roll scrolls up, so it is the corner least
likely to cover what they are reading: the top row there has already been
played. Pressing it pauses the song
(the music, the count-in and the roll all stop where they are) and asks
"Quit this song?" with two choices:

- **Keep playing** (the default, also chosen by Escape) carries on from
  exactly where the song paused, with no count-in.
- **Quit** ends the song with no score and returns to the setup screen.

"Keep playing" is a plain button and "Quit" is filled red, to mark it as the
choice that throws the run away. Inside the dialog, red is not mistaken for
a note button's colour.

A note held when Quit is pressed is released at that moment, and its
duration stops counting there. There is no separate pause button.

The sound fades out over about 25 ms as the song pauses, and fades back in
on Keep playing, so stopping and starting the sound does not pop. The song
runs on for that short fade before it stops.

### End of a song

When the song ends, the result screen shows the song and part, and the
player's song score out of 100 (see
[Song and group scores](#song-and-group-scores)). It has two buttons:

- **Play again** starts the same song, part and difficulty again, with the
  count-in.
- **Change song** returns to the setup screen.

## 5. Scoring

Scoring rewards matching the written notes in pitch, timing and duration. The
numbers below will need tuning by playing.

### Matching presses to notes

- A press is matched to the nearest unjudged note whose start is within
  200 ms of the press.
- The first press matched to a note judges it. A wrong button cannot be
  corrected for that note. Its modifiers can be, within 60 ms of the press
  (see [Modifier buttons](#modifier-buttons)).
- A press with no note in range sounds but does not affect the score.

### Score for one note (0 to 100)

A note scores 0 if it was missed or the wrong note was pressed. "Wrong" depends
on difficulty: any button is right in beginner, the button must be the same
note of the scale (1 and 8 count as the same) in intermediate, and the button
and modifiers must play the written pitch in advanced (see
[Difficulty](#difficulty)).

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
- A `do` event sets the pitch of Do from that point on. The note name (such
  as `"D4"` or `"Bb3"`) also tells the game how to spell the pitch names shown
  on the buttons.
- A `do` event may also have `button1`, the note on button 1, such as
  `{ "at": 0, "do": "D4", "button1": "A3" }`. It must be a note of Do's major
  scale, and then only Do's note matters, not its octave. Without it, Do is on
  button 1.
- A note event has a `button` (1 to 8) and optional `sharp` and `octave` flags.
- Notes in a part must not overlap. Each part is monophonic.
- `buttons` says what the eight buttons mean. Only `"scale"` exists now. The
  field leaves room for parts whose buttons are chords or percussion sounds.
- `sound` names one of the built-in synthesised sounds.
- The tempo and time signature are fixed for the whole song in format 1.

## 7. Technical approach

- Plain JavaScript using ES modules, with no framework and no build step.
- The game is a set of static files. Playing alone, with every other part on
  autoplay, runs entirely on one device. Several devices connect directly to
  each other (see section 9), so no server is needed then either.
- Because ES modules and `fetch` do not work from `file://`, the files must be
  served over HTTP, by any static file server or a static host.
- The game is published with GitHub Pages at https://www.ionstage.org/otomo/.
  A workflow deploys each push to `main`, copying only the files the game
  needs to run (`index.html`, `css/`, `js/`, `songs/`). Documentation and
  tests are left out. The trial page for multiple devices (`trial/`) is
  kept in the repository but not published.
- The Web Audio clock is the single time reference. Autoplay
  notes are scheduled slightly ahead on that clock, and key and touch events
  are converted to the same clock for judging.
- Scoring and pitch calculation are kept as pure functions, separate from
  audio and display, so they can be unit tested with Node's built-in test
  runner without adding dependencies.
- Third-party code needs agreement first, partly because its licence could
  affect the project's licence. Two libraries are agreed, for multiple
  devices: jsQR (Apache-2.0) to read QR codes from the camera, and Nayuki's
  QR Code generator (MIT) to draw them. Each is kept in the repository as a
  plain JavaScript file with its licence beside it, with no package manager
  and no build step.

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
  harmony and bass. The song has no accidentals, so the semitone button is
  exercised by the other songs: "Rondo alla Turca" and "Minuet in G".

Not included:

- More than one device.
- Percussion and chord parts.
- Any song editing.

## 9. Later

These are taken up in the order listed. Multiple devices come first, as the
point of the game and its largest technical risk. Percussion and chord parts
are designed together, since both give the `buttons` field a new meaning.
The song tools follow once the format has settled.

- **Multiple devices.** Further players connect to the first player's
  device, the host. The network carries clock sync, the start signal, the
  players' notes and scores. The plan for this work is in `docs/multi-device-plan.md`. Agreed so
  far:
  - The devices connect directly over WebRTC data channels on the local
    network, with no server of any kind. Each guest connects to the host
    only, so the host is the hub.
  - The connection details are passed by QR code. The host shows a code
    holding a link to the game, such as `…/otomo/#join=<data>`, and the guest
    scans it with the phone's own camera app, which also opens the game. The
    guest's screen then shows a reply code, which the host scans in the
    game. The host shows a fresh code for each guest.
  - Only the fields that differ between connections are sent (the ICE user
    fragment and password, the DTLS fingerprint and the candidates), and the
    rest of the session description is rebuilt on the other side, so the
    codes stay small and easy to scan.
  - The same data can also be shown as a link to copy, for testing with two
    windows on one computer and for sharing through AirDrop or a messaging
    app.
  - All devices must be on a network that lets them reach each other. Guest
    and public Wi-Fi often does not, and a phone's hotspot is the usual way
    round that. The page itself is loaded from the web the first time.
  - Every device plays the parts nobody has taken. Their volume is lowered
    as devices join, for example divided by the square root of the number
    of devices, so that each player's own part stays slightly louder than
    autoplay. Identical sound from several speakers shows timing differences
    as phasing, but in the trial two devices playing the same parts did not
    phase, so every device plays them. If a larger group does not sound
    right, each untaken part is played by one device only.
  - Players join only between songs. The host's code is not shown during a
    song.
  - Hosting and joining are in a "Play together" section of the setup
    screen. Once hosting, the section lists the players, and Add a player
    shows a fresh code for each new player, with Scan their code to read
    the reply. A guest has a screen of its own, showing its reply code and
    then that it has joined, with Leave. Playing alone is unchanged.
  - Players are numbered in the order they joined: the host is Player 1,
    and the next to join Player 2. A number is not given out again within a
    group, so the numbers keep showing the order of joining. Players do not
    type names.
  - Players take turns choosing the song: the host chooses the first, and
    after each song the turn passes to the next player in the order they
    joined. Anyone who has left is skipped, and anyone who joins goes to the
    end of the order.
  - Every player chooses their own part and difficulty for every song. Each
    part can be held by one player only: choosing a part claims it, even
    before a difficulty, until that player switches to another. If two
    players tap the same part at once, the host's order decides. In the
    lobby, a part another player holds is greyed out with their name. A
    part that anyone has taken is not autoplayed on any device.
  - With more players than parts, a player left without a part once every
    part is held sits the song out and listens. They can still take a part
    that comes free before the start. Their device does not play the song
    and is not counted in the autoplay volume, and they are not scored.
  - Each player's notes are sent, as they are played, to every other device,
    which plays them at once at the lowered autoplay level, so a player's
    own device plays them loudest. Wrong notes and timing are heard
    everywhere, as in a band. The host passes each guest's notes on to the
    other guests. A note arrives a few milliseconds after it is played.
  - Neither a part nor a difficulty is chosen when a song is chosen, so each
    player chooses both afresh for every song. Choosing both marks the player
    ready, and the tap also starts the device's audio.
  - In the lobby, the chooser taps one of the songs, listed as buttons, and
    it is chosen at once. Each part and each difficulty is a button too, so
    that every choice is a tap, which iOS needs before it starts the audio.
    Every device lists the players and which of them are ready, with the
    part each ready player took. A ready player can change their choice
    until the song starts, and stays ready. A chooser who leaves before
    choosing passes the turn to the next player.
  - The song starts as soon as every player is ready or sits it out, with
    no warning beyond the count-in. There is no time limit: the players are
    in one room, so they can ask anyone who has not chosen yet. A player
    whose device disconnects, for example because it went to sleep, is no
    longer waited for. A device that has only just started its audio needs
    about a second of pings to set its clock, so the last player's tap can
    start the song up to a second later than an earlier one would.
  - After a song with several devices, the result screen has one button,
    Continue, back to the lobby, where the turn has passed on. Leaving the
    group is in the lobby. Play again and Change song stay for one device.
  - Nothing pauses with several devices. A guest's Quit asks to confirm with
    the music still playing ("Leave this song? The others play on."), and
    takes only that player out of the song, back to the lobby. The host's
    Quit asks the same way ("End this song for everyone?") and ends the song
    for everyone.
  - A device that loses its connection plays on to the end on its own clock.
    It then sees only its own score and is left out of the group score, and
    the player rejoins by scanning the host's code again. If the host's
    connection is lost, every guest is in that position.
  - The result screen shows the player's own score and, below it, the group
    score with the number of players, once every score has arrived. Until
    then it says "Waiting for the other players' scores…". The group score
    is the average of the players who played the song to the end: a player
    who quit it, sat it out or lost their connection is not counted. A lost
    connection can take half a minute to be reported, so a player the host
    has not heard from for 5 seconds is left out, and a guest that has not
    heard from the host for 5 seconds shows only its own score.
  - The work started with a trial page (`trial/`), before the game screens
    depended on it. An iPad with an iPhone, and a Mac running Chrome with an
    iPhone, connected on home Wi-Fi by QR code and by copied text. Clicks
    and songs on every device sounded as one. Android phones and phone
    hotspots were not tested, and are looked at if problems arise.
  - Each device times its sound by when it is heard, allowing for the
    output latency the browser reports (see open question 2). On a
    Bluetooth speaker the trial measured 190 to 200 ms, and without this
    that device's sound came that late.
  - Two devices' audio clocks drift apart by up to about 170 parts per
    million (a Mac with an iPhone; an iPad with an iPhone drifted 13), which
    is about 30 ms over a three-minute song. So the guests keep pinging the
    host during the song, and once a second each guest moves its song
    towards the latest offset, by at most 2 ms at a time. A change of more
    than 30 ms, as when a device switches its speaker, is made at once.
  - A browser on a Mac needs the Local Network permission (System Settings,
    Privacy & Security) before it can connect. When a connection does not
    open, the game says so and mentions this.
- **Percussion parts**, where each of the eight buttons is a different
  percussive sound.
- **Chord parts**, where each of the eight buttons is one of the chords used in
  the song.
- **MIDI conversion** into the format.
- **Composition tool** for writing songs in the format.
- **Sampled instrument sounds.**
- **Online play.** Deferred because of network latency.

## 10. Open questions

1. **Tuning after play.** The first build has been played, including on a
   real phone, and the round of tuning after it is complete. The scoring
   windows and weights in section 5 and the touch layout in section 4 may
   still be adjusted after further play.
2. **Latency calibration.** Some devices, and all Bluetooth speakers and
   headphones, delay sound noticeably. The game allows for the output
   latency the browser reports, which covers Bluetooth: Chrome's output
   timestamp already includes it, and on Safari, whose timestamp leaves it
   out, the reported latency is taken off as well. In the trial for
   multiple devices, Safari on an iPhone reported 190 ms for a Bluetooth
   speaker and Chrome on a Mac 200 ms, and allowing for them brought the
   devices' sound together. So no offset setting is planned for now. A
   tap-along calibration (the player taps to a steady click and the median
   offset is saved per device) is the likely approach for a device that
   reports its latency wrongly, if one turns up. On Bluetooth the scoring is
   right, but the player's own notes still sound late, since a note cannot
   start before the button is pressed. The phone's own speakers or wired
   headphones play best.
3. **Licence.** The project uses the MIT License (see `LICENSE`). jsQR's
   Apache-2.0 licence is compatible with it and only needs its licence text
   to be kept with the file. The project's licence may change if a library
   it comes to depend on requires it.
4. **Multiple devices.** The connection method is decided (see section 9).
   The questions still open, such as late joining and sharing a part, are
   listed in `docs/multi-device-plan.md`.
5. **Arrangement weights and shifts.** The costs in
   [Scale position](#scale-position) are starting points. The songs have
   been played with no issues so far. The weights may still change, and a
   shift at a phrase boundary
   may be allowed where a part has long runs of held octave presses.
