// Audio output: synthesised voices, the autoplay scheduler and the count-in.
// The audio clock is the game's single time reference.

import { midiToFrequency } from './pitch.js';

const SCHEDULE_AHEAD = 0.15;
const TICK_INTERVAL = 25;
const START_DELAY = 0.2;

// The player's own part is slightly louder than autoplay.
const PLAYER_LEVEL = 0.3;
const AUTOPLAY_LEVEL = 0.2;
const CLICK_LEVEL = 0.25;

// Pausing fades all output out over this time before freezing the clock,
// and resuming fades it back in. Stopping the output mid-waveform pops.
const PAUSE_FADE = 0.025;

// The output timestamp's lead is smoothed by this share of each new value,
// and values further than this from zero, in seconds, are ignored.
const STAMP_LEAD_SMOOTHING = 0.05;
const STAMP_LEAD_LIMIT = 1;

const SOUNDS = {
  lead: {
    oscillators: [{ type: 'triangle', gain: 0.8 }, { type: 'square', gain: 0.1 }],
    attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.08,
  },
  soft: {
    oscillators: [{ type: 'sine', gain: 0.8 }, { type: 'triangle', gain: 0.3, detune: 4 }],
    attack: 0.04, decay: 0.3, sustain: 0.8, release: 0.2,
  },
  bass: {
    oscillators: [{ type: 'sawtooth', gain: 0.5 }, { type: 'sine', gain: 0.6 }],
    filter: 900, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.08,
  },
};

export class AudioEngine {
  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.output = this.context.createDynamicsCompressor();
    this.master = this.context.createGain();
    this.output.connect(this.master).connect(this.context.destination);
    this.pausing = null;
    this.voices = new Set();
    this.timer = null;
    this.queue = [];
    this.queueIndex = 0;
    this.songStart = 0;
    this.stampLead = null;
  }

  // Must be called from a user gesture. The fade in is scheduled on the
  // clock as it stands, so it plays as soon as the clock runs again.
  resume() {
    this.pausing = null;
    this.fadeMaster(1);
    return this.context.resume();
  }

  startSong(song, autoplayParts) {
    this.stopSong();
    const beatLength = song.secondsPerBeat;
    this.songStart = this.context.currentTime + START_DELAY + song.countIn.beats * beatLength;
    for (const beat of song.countIn.clicks) {
      this.click(this.songStart + beat * beatLength);
    }
    this.queue = autoplayParts
      .flatMap((part) => part.notes.map((note) => ({ note, sound: part.sound })))
      .sort((a, b) => a.note.start - b.note.start);
    this.queueIndex = 0;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_INTERVAL);
  }

  // Suspending the context freezes its clock, so the song time, the
  // scheduled notes and the count-in all stop where they are and carry on
  // from there on resume. The song runs on for the length of the fade out
  // first. A resume during the fade cancels the suspend.
  pause() {
    const pausing = {};
    this.pausing = pausing;
    this.fadeMaster(0);
    return new Promise((resolve) => setTimeout(resolve, (PAUSE_FADE + 0.01) * 1000)).then(() => {
      if (this.pausing === pausing) {
        return this.context.suspend();
      }
    });
  }

  fadeMaster(level) {
    const now = this.context.currentTime;
    const gain = this.master.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(level, now + PAUSE_FADE);
  }

  stopSong() {
    clearInterval(this.timer);
    this.timer = null;
    for (const voice of this.voices) {
      voice.kill();
    }
    this.queue = [];
  }

  // Schedules autoplay notes a short time ahead, so timer jitter does not
  // affect when they sound.
  schedule() {
    const until = this.context.currentTime + SCHEDULE_AHEAD;
    while (this.queueIndex < this.queue.length) {
      const { note, sound } = this.queue[this.queueIndex];
      const start = this.songStart + note.start;
      if (start > until) {
        break;
      }
      this.startVoice(sound, note.midi, start, AUTOPLAY_LEVEL).release(this.songStart + note.end);
      this.queueIndex++;
    }
  }

  // Starts a player note now. Returns a voice to release.
  noteOn(sound, midi) {
    return this.startVoice(sound, midi, this.context.currentTime, PLAYER_LEVEL);
  }

  now() {
    return this.context.currentTime;
  }

  // Song time of the sound being heard at `performanceTime`, which is on the
  // performance.now() clock that event time stamps use.
  songTime(performanceTime = performance.now()) {
    return this.audibleTime(performanceTime) - this.songStart;
  }

  // The context time of the sound heard at `performanceTime`.
  //
  // Never later than the context's clock. Just after a resume, the output
  // timestamp can still be the one from before the pause, and extrapolating
  // from it would jump ahead by the length of the pause.
  //
  // Chrome's output timestamp allows for the output latency, Bluetooth
  // included. Safari's does not: it runs level with currentTime even with a
  // Bluetooth speaker reporting 190 ms. So the part of the reported latency
  // that the timestamp does not cover is taken off as well.
  audibleTime(performanceTime) {
    const context = this.context;
    const stamp = context.getOutputTimestamp?.();
    if (stamp && stamp.contextTime > 0 && stamp.performanceTime > 0) {
      this.trackStampLead(context.currentTime
        - (stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000));
      return Math.min(stamp.contextTime + (performanceTime - stamp.performanceTime) / 1000,
        context.currentTime) - this.missingLatency();
    }
    return context.currentTime - this.reportedLatency() - (performance.now() - performanceTime) / 1000;
  }

  reportedLatency() {
    return (this.context.outputLatency || 0) + (this.context.baseLatency || 0);
  }

  // How far the context's clock runs ahead of the output timestamp, smoothed
  // over calls, since currentTime moves in steps of a render quantum. A
  // stale timestamp just after a resume gives a value well out of range,
  // which is ignored.
  trackStampLead(value) {
    if (this.context.state !== 'running' || value < -STAMP_LEAD_LIMIT || value > STAMP_LEAD_LIMIT) {
      return;
    }
    this.stampLead = this.stampLead === null ? value : this.stampLead + (value - this.stampLead) * STAMP_LEAD_SMOOTHING;
  }

  // The output latency the output timestamp leaves out.
  missingLatency() {
    return this.stampLead === null ? 0 : Math.max(0, this.reportedLatency() - this.stampLead);
  }

  startVoice(soundName, midi, time, level) {
    const context = this.context;
    const sound = SOUNDS[soundName] ?? SOUNDS.lead;
    const frequency = midiToFrequency(midi);
    const envelope = context.createGain();
    const gain = envelope.gain;
    gain.setValueAtTime(0, time);
    gain.linearRampToValueAtTime(level, time + sound.attack);
    gain.setTargetAtTime(level * sound.sustain, time + sound.attack, sound.decay / 3);
    envelope.connect(this.output);

    let input = envelope;
    if (sound.filter) {
      input = context.createBiquadFilter();
      input.type = 'lowpass';
      input.frequency.value = sound.filter;
      input.connect(envelope);
    }
    const oscillators = sound.oscillators.map(({ type, gain: oscillatorGain, detune = 0 }) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      const mix = context.createGain();
      mix.gain.value = oscillatorGain;
      oscillator.connect(mix).connect(input);
      oscillator.start(time);
      return oscillator;
    });

    let released = false;
    const stopAll = (at) => {
      for (const oscillator of oscillators) {
        try {
          oscillator.stop(at);
        } catch {
          // Already stopped.
        }
      }
    };
    const voice = {
      // Changes the pitch of a sounding voice now.
      setPitch: (newMidi) => {
        const now = context.currentTime;
        for (const oscillator of oscillators) {
          oscillator.frequency.setValueAtTime(midiToFrequency(newMidi), now);
        }
      },
      release: (at = context.currentTime) => {
        if (released) {
          return;
        }
        released = true;
        if (gain.cancelAndHoldAtTime) {
          gain.cancelAndHoldAtTime(at);
        } else {
          gain.cancelScheduledValues(at);
          gain.setValueAtTime(at <= context.currentTime ? gain.value : level * sound.sustain, at);
        }
        gain.setTargetAtTime(0, at, sound.release / 4);
        stopAll(at + sound.release * 1.5);
      },
      kill: () => {
        released = true;
        stopAll(0);
        envelope.disconnect();
        this.voices.delete(voice);
      },
    };
    oscillators[0].onended = () => {
      envelope.disconnect();
      this.voices.delete(voice);
    };
    this.voices.add(voice);
    return voice;
  }

  click(time) {
    const context = this.context;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 1000;
    envelope.gain.setValueAtTime(CLICK_LEVEL, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    oscillator.connect(envelope).connect(this.output);
    oscillator.start(time);
    oscillator.stop(time + 0.06);
    const voice = {
      kill: () => {
        try {
          oscillator.stop(0);
        } catch {
          // Already stopped.
        }
        envelope.disconnect();
        this.voices.delete(voice);
      },
    };
    oscillator.onended = () => {
      envelope.disconnect();
      this.voices.delete(voice);
    };
    this.voices.add(voice);
  }
}
