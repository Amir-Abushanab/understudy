/**
 * Validator suite. A canonical valid block must pass with zero errors; each
 * malformed mutation must produce at least one ERROR (the wrapper turns that
 * into exit code 1). This is the machine backing for the DoD line "validate.mjs
 * exits 1 on every malformed case in the test suite" (§11).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMotionBlock, validateDesignModel, validateCss, hasErrors } from './validate.js';

const VALID = `motion:
  meta:
    source: "https://example.com"
    captured_at: "2026-07-24T10:00:00Z"
    confidence: 0.82
    passes: [scroll, hover]
  primitives:
    duration:
      fast: 160
      base: 240
    easing:
      standard: [0.32, 0.72, 0, 1]
      spring-soft:
        stiffness: 180
        damping: 24
        mass: 1
    stagger:
      base: 80
  semantic:
    hover-lift: { duration: fast, easing: standard }
    modal-enter: { duration: base, easing: standard }
    list-reveal: { duration: base, easing: standard, stagger: base }
  choreography:
    - name: hero
      trigger: load
      steps:
        - { target: eyebrow, delay: 0, token: modal-enter }
        - { target: headline, delay: 80, token: modal-enter }
  personality:
    archetype: premium
    evidence:
      - "median duration 240ms, above the 180ms corporate median"
  observed:
    samples: 1000
    rejected: 20
    notes: "nothing suppressed during capture"
`;

function errorChecks(text: string): string[] {
  return validateMotionBlock(text).filter((f) => f.level === 'ERROR').map((f) => f.check);
}

test('valid block passes with zero errors', () => {
  const findings = validateMotionBlock(VALID);
  assert.equal(hasErrors(findings), false, JSON.stringify(findings, null, 2));
});

test('missing meta.confidence is an error', () => {
  const bad = VALID.replace('    confidence: 0.82\n', '');
  assert.ok(errorChecks(bad).includes('confidence'));
});

test('out-of-range confidence is an error', () => {
  const bad = VALID.replace('confidence: 0.82', 'confidence: 1.7');
  assert.ok(errorChecks(bad).includes('confidence'));
});

test('semantic reference to an unknown token is an error', () => {
  const bad = VALID.replace('hover-lift: { duration: fast', 'hover-lift: { duration: nope');
  assert.ok(errorChecks(bad).includes('semantic'));
});

test('a raw numeric literal in semantic is an error', () => {
  const bad = VALID.replace('hover-lift: { duration: fast,', 'hover-lift: { duration: 160,');
  assert.ok(errorChecks(bad).includes('no-raw-literals'));
});

test('a raw numeric literal as a choreography token is an error', () => {
  const bad = VALID.replace('token: modal-enter }\n        - { target: headline, delay: 80, token: modal-enter', 'token: modal-enter }\n        - { target: headline, delay: 80, token: 42');
  assert.ok(errorChecks(bad).includes('no-raw-literals'));
});

test('an unknown choreography token is an error', () => {
  const bad = VALID.replace('token: modal-enter }\n        - { target: headline, delay: 80, token: modal-enter', 'token: modal-enter }\n        - { target: headline, delay: 80, token: ghost');
  assert.ok(errorChecks(bad).includes('choreography'));
});

test('a zero-duration token is an error', () => {
  const bad = VALID.replace('base: 240', 'base: 0');
  assert.ok(errorChecks(bad).includes('duration-bounds'));
});

test('an over-long duration is flagged, not clamped', () => {
  const bad = VALID.replace('base: 240', 'base: 5000');
  assert.ok(errorChecks(bad).includes('duration-bounds'));
});

test('a long-form token without provenance is an error', () => {
  const bad = VALID.replace('base: 240', 'base: { value: 240 }');
  assert.ok(errorChecks(bad).includes('provenance'));
});

test('an em-dash in a prose field is an error', () => {
  const bad = VALID.replace('"nothing suppressed during capture"', '"truncated — three sequences"');
  assert.ok(errorChecks(bad).includes('em-dash'));
});

test('unparseable YAML is a single yaml-parse error', () => {
  const findings = validateMotionBlock('motion:\n  meta: [unterminated');
  assert.ok(findings.some((f) => f.check === 'yaml-parse' && f.level === 'ERROR'));
});

test('CSS with an undefined var(--token) is an error', () => {
  const css = ':root { --duration-base: 240ms; }\n.x { transition-duration: var(--duration-missing); }';
  assert.ok(validateCss(css).some((f) => f.check === 'css-vars' && f.level === 'ERROR'));
});

const DESIGN_MODEL = `name: Example
source: "https://example.com"
primary_mode: light
confidence:
  brand: 0.8
  motion: 0.7
colors:
  light:
    background: "#ffffff"
    surface: "#f5f5f5"
    text1: "#111111"
    text2: "rgba(17, 17, 17, 0.6)"
    accent: "#5b5bff"
    border: "#e5e5e5"
${VALID}`;

test('design-model: a full valid model passes', () => {
  assert.equal(hasErrors(validateDesignModel(DESIGN_MODEL)), false, JSON.stringify(validateDesignModel(DESIGN_MODEL), null, 2));
});

test('design-model: an invalid color value is an error', () => {
  const bad = DESIGN_MODEL.replace('accent: "#5b5bff"', 'accent: "not-a-color"');
  assert.ok(validateDesignModel(bad).some((f) => f.check === 'brand' && f.level === 'ERROR'));
});

test('design-model: an unknown primary_mode is warned', () => {
  const bad = DESIGN_MODEL.replace('primary_mode: light', 'primary_mode: twilight');
  assert.ok(validateDesignModel(bad).some((f) => f.check === 'brand' && f.level === 'WARN'));
});

test('design-model: still catches motion errors inside the model', () => {
  const bad = DESIGN_MODEL.replace('confidence: 0.82', 'confidence: 3.0');
  assert.ok(validateDesignModel(bad).some((f) => f.check === 'confidence' && f.level === 'ERROR'));
});

test('CSS with all vars defined passes', () => {
  const css = ':root { --duration-base: 240ms; }\n.x { transition-duration: var(--duration-base); }';
  assert.equal(hasErrors(validateCss(css)), false);
});
