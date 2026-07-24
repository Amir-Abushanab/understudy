/**
 * Assembler tests (browser-free): a synthetic raw sample stream must reconstruct
 * the right discrete MotionEvents, segment on idle gaps, drop trivial motions,
 * attach declared metadata, and feed the stagger recovery correctly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleCapture, type RawCaptureData, type RawSampleRec } from './assemble.js';
import { evalCubicBezier, type BezierControl } from '../analyze/bezier.js';
import { recoverStagger } from '../analyze/cluster.js';
import type { CapturePassName } from './types.js';

function motionSamples(
  id: string,
  startT: number,
  dur: number,
  from: number,
  to: number,
  control: BezierControl,
  pass: CapturePassName = 'load',
): RawSampleRec[] {
  const recs: RawSampleRec[] = [];
  for (let t = 0; t <= dur; t += 16) {
    const p = evalCubicBezier(control, t / dur);
    recs.push({ t: startT + t, targetId: id, property: 'translateY', value: from + (to - from) * p, pass });
  }
  return recs;
}

function rawStore(samples: RawSampleRec[], extra: Partial<RawCaptureData> = {}): RawCaptureData {
  return {
    startT: 0,
    samples,
    scroll: [],
    waapi: [],
    css: [],
    labels: {},
    rejected: 0,
    totalRaw: samples.length,
    meta: { reducedMotion: false },
    ...extra,
  };
}

test('assemble: reconstructs one MotionEvent per staggered element with metadata', () => {
  const samples: RawSampleRec[] = [];
  for (let i = 0; i < 3; i++) samples.push(...motionSamples(`e${i}`, i * 120, 240, 12, 0, [0, 0, 0.58, 1]));
  const waapi = [0, 1, 2].map((i) => ({ targetId: `e${i}`, targetLabel: 'text', startT: i * 120, duration: 240, easing: 'ease-out' }));

  const cap = assembleCapture(rawStore(samples, { waapi }), { source: 'x', capturedAt: 't', passes: ['load'] });

  assert.equal(cap.events.length, 3);
  assert.deepEqual(cap.events.map((e) => Math.round(e.startT)), [0, 120, 240]);
  for (const e of cap.events) {
    assert.equal(e.source, 'waapi');
    assert.equal(e.declaredDuration, 240);
    assert.equal(e.declaredEasing, 'ease-out');
    assert.equal(e.targetLabel, 'text');
    assert.ok(e.samples.length > 8);
    assert.ok(Math.abs(e.samples[0].p) < 0.05 && Math.abs(e.samples[e.samples.length - 1].p - 1) < 0.05);
  }

  const clusters = recoverStagger(cap.events).filter((c) => c.confident);
  assert.equal(clusters.length, 1);
  assert.ok(Math.abs(clusters[0].intervalMs - 120) <= 12);
});

test('assemble: segments one element into separate motions on an idle gap', () => {
  const samples = [
    ...motionSamples('e9', 0, 200, 0, 30, [0, 0, 0.58, 1]),
    ...motionSamples('e9', 600, 200, 30, 0, [0, 0, 0.58, 1]),
  ];
  const cap = assembleCapture(rawStore(samples), { source: 'x', capturedAt: 't', passes: ['load'] });
  const forE9 = cap.events.filter((e) => e.targetId === 'e9');
  assert.equal(forE9.length, 2, 'idle gap should split into two motions');
});

test('assemble: drops motions too small to be intentional', () => {
  // 0.5px of translateY is below the min range and should not become a motion.
  const samples = motionSamples('tiny', 0, 240, 12, 11.5, [0, 0, 0.58, 1]);
  const cap = assembleCapture(rawStore(samples), { source: 'x', capturedAt: 't', passes: ['load'] });
  assert.equal(cap.events.length, 0);
});

test('assemble: surfaces reduced-motion as a limitation', () => {
  const cap = assembleCapture(rawStore([], { meta: { reducedMotion: true } }), { source: 'x', capturedAt: 't', passes: ['load'] });
  assert.ok(cap.limitations.some((l) => l.kind === 'reduced-motion'));
});
