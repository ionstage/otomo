// Re-arranges the songs by the rules in "Scale position" in section 2 of
// docs/design.md, keeping every note's pitch and timing.
//
//   node tools/arrange-songs.js [--write] [ode-to-joy.json ...]
//
// Without --write it only reports, for each part, the current and the new
// counts. File names are in songs/, and without any it takes every song in
// songs/index.json. Each part keeps the key of its first `do` event. A part
// with more than one `do` event is left alone, since shifts are placed by
// hand.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveSong } from '../js/song.js';
import { arrangePart, measure } from './arrange.js';

const songsDir = new URL('../songs/', import.meta.url);

// One event per line, as the song files are written.
export function formatSong(data) {
  const event = (e) => `{${Object.entries(e).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`;
  const text = JSON.stringify(data, null, 2).replace(
    /"events": \[[\s\S]*?\n {6}\]/g,
    (block) => `"events": [\n${JSON.parse(`{${block}}`).events.map((e) => `        ${event(e)}`).join(',\n')}\n      ]`,
  );
  return `${text}\n`;
}

export function arrangeSong(data) {
  const song = resolveSong(data);
  const report = [];
  data.parts.forEach((part, index) => {
    const resolved = song.parts[index];
    const before = measure(resolved.notes);
    if (resolved.positions.length > 1) {
      report.push({ name: part.name, before, skipped: 'it has shifts' });
      return;
    }
    const doLetter = resolved.positions[0].doName.replace(/-?\d+$/, '');
    const arranged = arrangePart(resolved.notes.map((note) => note.midi), doLetter);
    const sources = part.events.filter((e) => !('do' in e));
    part.events = [
      { at: 0, ...arranged.doEvent },
      ...arranged.notes.map((way, i) => {
        const e = { at: sources[i].at, length: sources[i].length, button: way.button };
        if (way.sharp) {
          e.sharp = true;
        }
        if (way.octave) {
          e.octave = true;
        }
        return e;
      }),
    ];
    report.push({ name: part.name, before, after: arranged.counts, doEvent: arranged.doEvent });
  });
  return report;
}

function describe(counts) {
  return `↑ holds ${counts.octaveHolds}, ↑ notes ${counts.octaveNotes}, ♯ ${counts.sharps}, wide jumps ${counts.wideJumps}`;
}

function main(args) {
  const write = args.includes('--write');
  const named = args.filter((arg) => arg !== '--write');
  const files = named.length > 0 ? named : JSON.parse(readFileSync(new URL('index.json', songsDir), 'utf8'));
  for (const file of files) {
    const url = new URL(file, songsDir);
    const data = JSON.parse(readFileSync(url, 'utf8'));
    const before = formatSong(data);
    const report = arrangeSong(data);
    console.log(file);
    for (const part of report) {
      console.log(`  ${part.name}`);
      console.log(`    now: ${describe(part.before)}`);
      console.log(part.skipped ? `    left alone: ${part.skipped}` : `    new: ${describe(part.after)}  ${JSON.stringify(part.doEvent)}`);
    }
    const after = formatSong(data);
    if (after === before) {
      console.log('  no change');
    } else if (write) {
      writeFileSync(url, after);
      console.log('  written');
    } else {
      console.log('  would change: run with --write to save');
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
