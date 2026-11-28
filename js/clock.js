// Estimates the offset between a guest's clock and the host's from ping
// samples. All times are in seconds. See "Clock sync" in
// docs/multi-device-plan.md.
//
// The guest sends its time t0, the host replies with its own time th, and
// the guest notes when the reply arrived, t1. If the two legs took equally
// long, the host's clock read th at the guest's (t0 + t1) / 2. Legs are
// rarely equal, but the shorter the round trip, the less they can differ,
// so the estimate uses the fastest samples.

// One ping. `offset` is the host's time minus the guest's.
export function clockSample(t0, th, t1) {
  return { time: t1, rtt: t1 - t0, offset: th - (t0 + t1) / 2 };
}

// The samples taken within `window` seconds before `now`.
export function recentSamples(samples, now, window) {
  return samples.filter((sample) => sample.time > now - window && sample.time <= now);
}

// The mean offset of the fastest `fraction` of the samples, at least one.
// Returns null without samples. `rtt` is the slowest round trip used, and
// `spread` is half the range of the offsets used.
export function estimateOffset(samples, { fraction = 0.25 } = {}) {
  if (samples.length === 0) {
    return null;
  }
  const fastest = [...samples].sort((a, b) => a.rtt - b.rtt)
    .slice(0, Math.max(1, Math.round(samples.length * fraction)));
  const offsets = fastest.map((sample) => sample.offset);
  return {
    offset: offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length,
    rtt: fastest[fastest.length - 1].rtt,
    spread: (Math.max(...offsets) - Math.min(...offsets)) / 2,
    count: fastest.length,
  };
}

// How fast the offset changes, in seconds per second, by a least-squares
// line through points of { time, offset }. Returns null for fewer than two
// distinct times.
export function driftRate(points) {
  if (points.length < 2) {
    return null;
  }
  const meanTime = points.reduce((sum, point) => sum + point.time, 0) / points.length;
  const meanOffset = points.reduce((sum, point) => sum + point.offset, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const { time, offset } of points) {
    covariance += (time - meanTime) * (offset - meanOffset);
    variance += (time - meanTime) ** 2;
  }
  return variance === 0 ? null : covariance / variance;
}

// A time on the host's clock as a time on this device's, for an offset
// from estimateOffset.
export function toLocalTime(hostTime, offset) {
  return hostTime - offset;
}

export function toHostTime(localTime, offset) {
  return localTime + offset;
}

// Drift correction during a song: the next value of a time that should be
// `target`. It moves at most `maxStep` seconds a step, so the music never
// jumps for the small changes drift and noise make. A gap larger than
// `jump`, as when a device switches its speaker mid-song, is closed at once.
export function retimeStep(current, target, { maxStep = 0.002, jump = 0.03 } = {}) {
  const gap = target - current;
  if (Math.abs(gap) > jump) {
    return target;
  }
  return current + Math.max(-maxStep, Math.min(maxStep, gap));
}
