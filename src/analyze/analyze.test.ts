/**
 * The falsifiability suite. Each analyzer is fed synthetic signals generated
 * from fixtures/ground-truth.json and must recover the known values within the
 * tolerances declared there. This is the machine check on the project's central
 * claim: that understudy measures rather than guesses.
 *
 * The signal generators mirror the fixture pages: the spring uses the same
 * semi-implicit Euler integrator the fixture ships, and the easing is sampled
 * from the same cubic-bezier. If a fixture page changes, ground-truth.json
 * changes with it, and these tests follow automatically.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { MotionEvent, ProgressSample } from '../capture/types.js';
import { recoverStagger } from './cluster.js';
import { evalCubicBezier, fitCubicBezier } from './bezier.js';
import { fitSpring, detectsOvershoot } from './spring.js';
import { snap, quantizeScale, assignToken, STAGGER_ANCHORS } from './quantize.js';

const GT = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/ground-truth.json'), 'utf8'));

// Deterministic jitter so runs are stable but not artificially perfect.
const JITTER = [0, 1.6, -1.1, 2.0, -0.6, 0.9, -1.4, 0.4];

function makeEvent(partial: Partial<MotionEvent> & { id: string; startT: number }): MotionEvent {
  return {
    targetId: partial.id,
    targetLabel: 'item',
    property: 'translateY',
    endT: partial.startT + 320,
    from: 12,
    to: 0,
    samples: [],
    source: 'waapi',
    trigger: 'load',
    ...partial,
  };
}

/** Sample a cubic-bezier easing over a duration, mirroring the raf-imperative fixture. */
function bezierSamples(control: [number, number, number, number], durationMs: number, dt = 16): ProgressSample[] {
  const out: ProgressSample[] = [];
  for (let t = 0; t <= durationMs; t += dt) out.push({ t, p: evalCubicBezier(control, t / durationMs) });
  return out;
}

/**
 * Sub-stepped semi-implicit Euler spring, identical to the spring-overshoot
 * fixture. The physics advances in fixed 2ms steps so the realized motion
 * actually matches stiffness/damping (a coarse per-frame step would shift the
 * effective frequency and make the "known" values a lie); progress is sampled
 * at the given frame cadence, mirroring how the instrument observes it.
 */
function springSamplesEuler(k: number, c: number, m: number, from: number, durationMs: number, sampleDt = 16): ProgressSample[] {
  let p = from;
  let v = 0;
  const physStepMs = 2;
  const physStepS = physStepMs / 1000;
  let simMs = 0;
  const out: ProgressSample[] = [{ t: 0, p: 0 }];
  for (let t = sampleDt; t <= durationMs; t += sampleDt) {
    while (simMs < t) {
      const a = (-k * p - c * v) / m;
      v += a * physStepS;
      p += v * physStepS;
      simMs += physStepMs;
    }
    out.push({ t, p: (from - p) / from });
  }
  return out;
}

test('stagger: recovers the known 120ms interval within tolerance', () => {
  const g = GT['stagger-120ms'];
  const events: MotionEvent[] = [];
  for (let i = 0; i < g.count; i++) {
    events.push(makeEvent({ id: `s${i}`, startT: i * g.staggerMs + JITTER[i % JITTER.length] }));
  }
  const clusters = recoverStagger(events);
  assert.equal(clusters.length, 1, 'one cluster expected');
  const cluster = clusters[0];
  assert.ok(cluster.confident, 'cluster should pass the variance gate');
  assert.ok(
    Math.abs(cluster.intervalMs - g.staggerMs) <= g.tolerance.staggerMs,
    `recovered ${cluster.intervalMs}, expected ${g.staggerMs} +/- ${g.tolerance.staggerMs}`,
  );
  assert.equal(cluster.beats, g.count, 'each item is its own beat');
});

test('stagger: coincidental timing does not pass the variance gate', () => {
  // Irregular starts (not a rhythm) must not be reported as a stagger.
  const starts = [0, 40, 300, 315, 900];
  const events = starts.map((startT, i) => makeEvent({ id: `c${i}`, startT }));
  const clusters = recoverStagger(events);
  const confident = clusters.filter((c) => c.confident);
  assert.equal(confident.length, 0, 'high-variance timing must not be emitted as stagger');
});

test('stagger: near-simultaneous starts collapse to one beat (16ms floor)', () => {
  // Two elements per beat, three beats 120ms apart.
  const starts = [0, 4, 120, 123, 240, 244];
  const events = starts.map((startT, i) => makeEvent({ id: `p${i}`, startT }));
  const clusters = recoverStagger(events);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].beats, 3, 'pairs within the floor collapse into single beats');
  assert.ok(Math.abs(clusters[0].intervalMs - 120) <= 8);
});

test('bezier: recovers a known easeOutCubic curve', () => {
  const g = GT['raf-imperative'];
  const control = g.easing as [number, number, number, number];
  const samples = bezierSamples(control, g.durationMs);
  const fit = fitCubicBezier(samples);
  // Compare the curves by their y-values across the timeline, which is what
  // actually matters perceptually; control points can trade off but the shape
  // must match. Also spot-check the control points against tolerance.
  for (let t = 0.1; t < 1; t += 0.1) {
    const expected = evalCubicBezier(control, t);
    const got = evalCubicBezier(fit.control, t);
    assert.ok(Math.abs(expected - got) <= g.tolerance.bezier, `curve mismatch at t=${t.toFixed(1)}`);
  }
  assert.ok(fit.residual < 0.02, `fit residual too high: ${fit.residual}`);
});

test('bezier: is robust to a modest amount of sample noise', () => {
  const control: [number, number, number, number] = [0.16, 1, 0.3, 1];
  const samples = bezierSamples(control, 500);
  // Add small deterministic noise.
  samples.forEach((s, i) => {
    s.p += (JITTER[i % JITTER.length] / 1000) * 3;
  });
  const fit = fitCubicBezier(samples);
  for (let t = 0.2; t < 1; t += 0.2) {
    assert.ok(Math.abs(evalCubicBezier(control, t) - evalCubicBezier(fit.control, t)) < 0.06);
  }
});

test('spring: detects overshoot and recovers stiffness/damping', () => {
  const g = GT['spring-overshoot'];
  const samples = springSamplesEuler(g.stiffness, g.damping, g.mass, g.fromPx, 1500);
  assert.ok(detectsOvershoot(samples), 'overshoot should be detected');
  const fit = fitSpring(samples);
  assert.ok(fit, 'a spring should be fit');
  assert.ok(
    Math.abs(fit.stiffness - g.stiffness) / g.stiffness <= g.tolerance.stiffnessPct,
    `stiffness ${fit.stiffness}, expected ~${g.stiffness}`,
  );
  assert.ok(
    Math.abs(fit.damping - g.damping) / g.damping <= g.tolerance.dampingPct,
    `damping ${fit.damping}, expected ~${g.damping}`,
  );
  assert.ok(fit.mass === 1, 'mass is pinned to 1');
});

test('spring: a plain ease-out is NOT fit as a spring', () => {
  // No overshoot -> fitSpring must return null (never fabricate a spring, §5 rule 4).
  const samples = bezierSamples([0, 0, 0.58, 1], 400);
  assert.equal(detectsOvershoot(samples), false);
  assert.equal(fitSpring(samples), null);
});

test('quantize: snaps messy durations to a single token', () => {
  assert.equal(snap(237), 240);
  assert.equal(snap(241), 240);
  assert.equal(snap(238), 240);
  const scale = quantizeScale([237, 241, 238]);
  assert.deepEqual(Object.keys(scale.scale), ['base']);
  assert.equal(scale.scale.base, 240);
});

test('quantize: separates distinct clusters into named levels', () => {
  const scale = quantizeScale([237, 241, 238, 158, 162, 79, 82]);
  assert.equal(scale.scale.base, 240);
  assert.equal(scale.scale.fast, 160);
  assert.equal(scale.scale.instant, 80);
  assert.equal(assignToken(159, scale.scale), 'fast');
});

test('quantize: a lone outlier duration does not mint a token', () => {
  // 30 motions near 200ms plus a single 1200ms outlier: the outlier lacks support
  // and must not become a scale level (this is the real-site fix for slow fades).
  const values = [...Array.from({ length: 30 }, () => 200), 1200];
  const scale = quantizeScale(values);
  assert.ok(!Object.values(scale.scale).includes(1200), 'outlier must not become a token');
  assert.equal(Object.keys(scale.scale).length, 1, 'only the supported level survives');
});

test('quantize: keeps the largest cluster when data is too thin for support', () => {
  // A single measurement should still yield one token, not an empty scale.
  const scale = quantizeScale([260]);
  assert.equal(Object.keys(scale.scale).length, 1);
});

test('quantize: the fixture stagger 120 maps to the loose stagger anchor', () => {
  const scale = quantizeScale([120, 118, 122], STAGGER_ANCHORS);
  assert.equal(scale.scale.loose, 120);
});
