import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockSample, driftRate, estimateOffset, recentSamples, retimeStep, toHostTime, toLocalTime } from '../js/clock.js';

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

test('a sample with equal legs gives the true offset', () => {
  // The host is 5 s ahead. The ping takes 10 ms each way.
  const sample = clockSample(1, 1.01 + 5, 1.02);
  near(sample.offset, 5);
  near(sample.rtt, 0.02);
  assert.equal(sample.time, 1.02);
});

test('the estimate uses the fastest samples', () => {
  const offset = 2;
  // Slow samples have an uneven first leg, which skews their offset.
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const t0 = i;
    const slow = i % 4 !== 0;
    const out = slow ? 0.08 : 0.005;
    const back = 0.005;
    samples.push(clockSample(t0, t0 + out + offset, t0 + out + back));
  }
  const estimate = estimateOffset(samples);
  assert.equal(estimate.count, 5);
  near(estimate.offset, offset);
  near(estimate.rtt, 0.01);
  near(estimate.spread, 0);
});

test('the estimate needs samples and uses at least one', () => {
  assert.equal(estimateOffset([]), null);
  const estimate = estimateOffset([clockSample(0, 3.5, 1)]);
  assert.equal(estimate.count, 1);
  near(estimate.offset, 3);
});

test('recent samples are those within the window', () => {
  const samples = [1, 2, 3, 4, 5].map((time) => ({ time, rtt: 0, offset: 0 }));
  assert.deepEqual(recentSamples(samples, 5, 2).map((sample) => sample.time), [4, 5]);
});

test('the drift rate is the slope of the offsets', () => {
  // 20 parts per million.
  const points = [0, 60, 120, 180].map((time) => ({ time, offset: 0.3 + time * 20e-6 }));
  near(driftRate(points), 20e-6, 1e-12);
  assert.equal(driftRate(points.slice(0, 1)), null);
  assert.equal(driftRate([{ time: 1, offset: 0 }, { time: 1, offset: 1 }]), null);
});

test('times convert between the clocks', () => {
  near(toLocalTime(10, 2.5), 7.5);
  near(toHostTime(7.5, 2.5), 10);
});

test('retiming moves a small gap a little at a time', () => {
  near(retimeStep(10, 10.001), 10.001);
  near(retimeStep(10, 10.01), 10.002);
  near(retimeStep(10, 9.99), 9.998);
});

test('retiming closes a large gap at once', () => {
  near(retimeStep(10, 10.2), 10.2);
  near(retimeStep(10, 9.9), 9.9);
});

test('170 ppm of drift is followed with steps once a second', () => {
  let current = 0;
  let target = 0;
  for (let second = 0; second < 180; second++) {
    target += 170e-6;
    current = retimeStep(current, target);
  }
  near(current, target, 1e-9);
});
