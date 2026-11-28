# Chord and drums parts plan

This is the handoff for implementing chord parts and drums parts, the next
items in section 9 of [design.md](design.md). The design records what was
agreed, under "Chord parts" and "Percussion parts". This document suggests
how to build it, and lists what is not yet decided.

Scale parts, playing alone and playing together must keep working exactly as
they do now. The first build and multiple devices are recorded in
[first-build-plan.md](first-build-plan.md) and
[multi-device-plan.md](multi-device-plan.md).

## Songs

- **"Ode to Joy"** gains a chord part, written for this project like its
  other parts. It is in D major and needs only a few chords, so the whole
  part should fit on buttons 1 to 8 with no modifier. Write it in
  consistent voicings, so the chord count stays low (see the design).
- **"When the Saints Go Marching In"** is a new song for trying drums. The
  tune is traditional and public domain. Modern recordings and arrangements
  are not, so every part is written for this project from the tune alone,
  not copied from any edition. Parts: melody, chords, bass and drums. The
  drums part should use all ten sounds naturally: a straight beat of
  hi-hat, bass drum and snare, tom fills at phrase ends, the open hi-hat and
  rim for variety, the cymbal on downbeats after fills, and the tambourine
  in a later chorus.

## Suggested file layout

This is a suggestion. Change it if a better split appears.

```
js/chords.js    assign a chord part's chords to buttons and groups, and
                name a chord from its notes (pure)
js/drums.js     the drum kit: sounds, groups and labels, and the drums
                rules for judging and for what a press sounds (pure)
songs/when-the-saints.json
test/chords.test.js
test/drums.test.js
```

`chords.js` and `drums.js` must be pure, like `judge.js`, so they can be
tested with `node --test`. Changes to `song.js` and `judge.js` stay pure too.
The synthesised drum sounds go in `audio.js`, beside the other sounds.

## Suggested order

Each step ends with something that can be checked.

1. **Loading chord and drums parts.** `song.js` accepts `"buttons":
   "chords"` and `"buttons": "drums"`, checks them as the design describes,
   and resolves them to notes. For chords, `chords.js` counts presses,
   sorts the chords and assigns buttons and groups, and rejects more than 32.
   For drums, it checks at most one note per group at a time, and at least
   a sixteenth note apart within a group. Check: tests cover the
   assignment, including ties, more than eight chords, and the octave
   making two chords different.
2. **Judging.** Chords use the existing judging with a button and a group.
   Drums judge each group on its own, score duration as 100, merge pairs
   in beginner and intermediate, and treat a pair's group A button as
   wrong in intermediate. `pressPitch`, or its equivalent, says what each
   press sounds in each mode. Check: tests cover every rule for chords and
   drums in the design.
3. **Sound.** Chords sound several notes at once, using the existing synth
   voices. The ten drum sounds are synthesised, ring out regardless of
   release, and a closed hi-hat cuts off a ringing open hi-hat. Check, by
   the user: the new songs sound right on autoplay, and the drums sound
   like a kit.
4. **Input and buttons.**
   - **Chords:** the modifiers are labelled "9" and "0", and the buttons show
     the chord names of the group held.
   - **Drums:** 9 and 0 are sound buttons with no 60 ms modifier window, a
     button from each group can be held at once, sliding is off, the "♯↑"
     button is hidden, and 9 and 0 are hidden in beginner mode. Each button
     shows its sound name.

   Check: every mode is playable on a desktop keyboard and on a phone.
5. **The roll.**
   - **Chords:** chord parts draw as scale parts do, with marks labelled "9"
     and "0".
   - **Drums:** square heads one sixteenth wide with a thin separator, group
     A in the upper half and group B in the lower, one centred line in
     beginner mode, and 9 and 0 in the modifiers' colours.

   Draw the row-height options from the design so the user can compare them
   side by side: the usual row height with smaller heads, using the margin
   left by having no modifier marks, and taller rows showing fewer of them.
   Check, by the user: the row height is chosen and recorded in the design,
   and the modifiers' colours on heads are looked at.
6. **Playing together.** A player's chord or drum hits are sent to the other
   devices and sound there, as notes do now. The `note` message carries a
   single `midi`, so it needs to carry a chord's notes or a drum sound.
   Check: two devices play "When the Saints" together, with one on drums.

## Technical notes

- **Chord identity.** Compare chords by their sorted MIDI numbers, so the
  order notes are written in does not matter, but octaves do.
- **Counting presses.** Each chord event is one press, so a chord struck four
  times counts four. Ties go to the chord that appears first.
- **Volume.** A chord is several voices at once, so scale each voice down,
  for example by the square root of the number of notes, so a chord part is
  not louder than a melody.
- **Drum timing.** A drum sound is one press with no release, so the sound
  starts at the press and does not depend on the button being held.
- **The arrangement tool.** `tools/arrange-songs.js` arranges scale parts
  only. It should skip chord and drums parts, and could report each chord
  part's chord count and how many presses need a modifier.
- **Format.** The new values of `buttons` are additions, and every existing
  song stays valid, so `"format"` stays at 1.

## Not yet decided

Each has a suggested default. Use the default and report it, unless it turns
out to need more than that. Ask the user before anything larger.

| Topic | Suggested default |
|---|---|
| Chord parts' sound | The existing `soft` sound, held for as long as the button is. |
| Which chords are named | Major, minor, diminished and augmented triads, sus2 and sus4, and the dominant, major and minor sevenths. An inversion is named as a slash chord, such as "C/E". Anything else shows no name. |
| Sound names on the drum buttons | "Tom L", "Tom M", "Tom H", "HH", "Kick", "Snare", "Rim", "Tamb", "Open HH", "Cym". |
| The separator between drum heads | 1 px at full scale, in the roll's background colour. |
| The hit effect for a pair | One effect for each head that was hit. In beginner and intermediate, one effect for the merged head. |
| Showing a part's kind in the setup screen and lobby | None. The part names, such as "Chords" and "Drums", say it. |
| "When the Saints" key, tempo and form | F major, about 110 beats a minute with straight eighths, the tune played twice, with the tambourine and more fills the second time. |

## After this plan

The design notes several things to look at after play: chords that are
used often but land far apart, the modifiers' colours on drum heads, and
the drums row height. Record what is decided in section 9 of the design.
