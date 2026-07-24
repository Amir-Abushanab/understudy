/**
 * Declared-easing parsing and duration agreement. These back the "prefer the
 * value the page declared over a noisy fit" behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeclaredEasing, durationsAgree } from './declared.js';

test('declared: parses cubic-bezier', () => {
  const e = parseDeclaredEasing('cubic-bezier(0.4, 0, 0.2, 1)');
  assert.equal(e.kind, 'bezier');
  if (e.kind === 'bezier') assert.deepEqual(e.control, [0.4, 0, 0.2, 1]);
});

test('declared: normalizes keyword easings to control points', () => {
  const out = parseDeclaredEasing('ease-out');
  assert.deepEqual(out.kind === 'bezier' ? out.control : null, [0, 0, 0.58, 1]);
  const lin = parseDeclaredEasing('linear');
  assert.deepEqual(lin.kind === 'bezier' ? lin.control : null, [0, 0, 1, 1]);
});

test('declared: recognizes steps() and linear() as non-bezier', () => {
  const steps = parseDeclaredEasing('steps(4, end)');
  assert.equal(steps.kind, 'steps');
  if (steps.kind === 'steps') assert.equal(steps.count, 4);
  assert.equal(parseDeclaredEasing('linear(0, 0.25, 1)').kind, 'linear-fn');
});

test('declared: absent or unknown is none', () => {
  assert.equal(parseDeclaredEasing(undefined).kind, 'none');
  assert.equal(parseDeclaredEasing('').kind, 'none');
  assert.equal(parseDeclaredEasing('wobble').kind, 'none');
});

test('declared: duration agreement is within tolerance', () => {
  assert.equal(durationsAgree(240, 250), true);
  assert.equal(durationsAgree(240, 400), false);
  assert.equal(durationsAgree(240, 0), false);
});
