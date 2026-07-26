/**
 * Rationale tests: reconcile's three cases, and the v0.3 validator checks,
 * especially the machine-enforced never-quantize-a-vibe rule.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from './reconcile.js';
import type { Rationale } from './types.js';
import { validateDesignModel, hasErrors } from '../validate.js';

const base = (documented: Rationale['documented']): Rationale => ({
  summary: 'x',
  sources: [{ url: 'u', tier: 1 }],
  principles: [],
  constraints: [],
  documented,
});

test('reconcile: agreement within tolerance marks the token reconciled', () => {
  const r = reconcile((p) => (p === 'duration.base' ? 240 : null), base([{ token: 'duration.base', value: 250, source: 0 }]));
  assert.deepEqual(r.reconciled, ['duration.base']);
  assert.equal(r.divergences.length, 0);
});

test('reconcile: a real conflict becomes an unresolved divergence', () => {
  const r = reconcile((p) => (p === 'duration.base' ? 240 : null), base([{ token: 'duration.base', value: 400, source: 0 }]));
  assert.equal(r.reconciled.length, 0);
  assert.equal(r.divergences.length, 1);
  assert.equal(r.divergences[0].measured, 240);
  assert.equal(r.divergences[0].resolution, 'unresolved');
});

test('reconcile: documented-only (no measured counterpart) is neither', () => {
  const r = reconcile(() => null, base([{ token: 'duration.base', value: 250, source: 0 }]));
  assert.equal(r.divergences.length, 0);
  assert.equal(r.reconciled.length, 0);
});

const MODEL = `name: X
primary_mode: light
colors:
  light: { background: "#ffffff", text1: "#111111", accent: "#5b5bff" }
motion:
  meta: { confidence: 0.8 }
  primitives: { duration: { base: 240 } }
rationale:
  summary: "It aims for calm, deliberate precision."
  sources:
    - { url: "https://example.com/talk", tier: 4 }
  principles:
    - { claim: "Motion supports focus and never decorates", source: 0, quantified: false }
  constraints:
    - "Never animates data-dense tables"
`;

test('rationale: a valid rationale passes', () => {
  assert.equal(hasErrors(validateDesignModel(MODEL)), false, JSON.stringify(validateDesignModel(MODEL), null, 2));
});

test('rationale: a principle source that does not resolve is an error', () => {
  const bad = MODEL.replace('source: 0', 'source: 5');
  assert.ok(validateDesignModel(bad).some((f) => f.check === 'rationale' && f.level === 'ERROR'));
});

test('rationale: never-quantize-a-vibe (quantified false + numeric implies) is an error', () => {
  const bad = MODEL.replace('quantified: false', 'quantified: false, implies: "240ms"');
  assert.ok(validateDesignModel(bad).some((f) => f.check === 'never-quantize-a-vibe'));
});

test('rationale: an em-dash in the summary is an error', () => {
  const bad = MODEL.replace('calm, deliberate', 'calm — deliberate');
  assert.ok(validateDesignModel(bad).some((f) => f.check === 'em-dash'));
});
