/**
 * Token export tests: a synthetic design model must produce well-formed CSS
 * custom properties, a Tailwind theme.extend config, and W3C DTCG JSON.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrandModel } from '../brand/types.js';
import type { MotionModel } from '../analyze/model.js';
import type { DesignModel } from './design-model.js';
import { toBrandCss, toTailwindConfig, toDesignTokens } from './tokens.js';

function motionModel(): MotionModel {
  return {
    meta: { source: 'https://example.com', capturedAt: 't', confidence: 0.8, passes: ['scroll'] },
    primitives: {
      duration: { base: { value: 240, provenance: 'measured' } },
      easing: { standard: { kind: 'bezier', control: [0, 0, 0.58, 1], provenance: 'measured' } },
      stagger: {},
    },
    semantic: {},
    choreography: [],
    personality: { archetype: 'premium', evidence: [] },
    observed: { samples: 100, rejected: 0, notes: '' },
  };
}

function brandModel(): BrandModel {
  return {
    mode: 'light',
    colors: { light: { background: '#ffffff', surface: '#f5f5f5', text1: '#111111', text2: '#666666', accent: '#5b5bff', border: '#e5e5e5' } },
    accents: ['#5b5bff', '#22c55e'],
    states: { success: '#22c55e' },
    typography: {
      display: { family: 'Inter', size: 48, weight: 700, lineHeight: 1.1, letterSpacing: '0' },
      body: { family: 'Inter', size: 16, weight: 400, lineHeight: 1.5, letterSpacing: '0' },
      families: ['Inter'],
      scale: [16, 48],
      weights: [400, 700],
      fontFaces: [],
    },
    spacing: [0, 8, 16],
    radii: [0, 8],
    borderWidths: [1],
    containers: [1200],
    shadows: ['0 1px 2px rgba(0,0,0,0.1)'],
    gradients: [],
    accessibility: {},
    provenance: {},
    sampled: 100,
    challenged: false,
    confidence: 0.8,
  };
}

function designModel(): DesignModel {
  return { name: 'Test', source: 'https://example.com', capturedAt: 't', brand: brandModel(), motion: motionModel() };
}

test('tokens: CSS custom properties for brand + motion', () => {
  const css = toBrandCss(designModel());
  assert.match(css, /:root\s*{/);
  assert.match(css, /--color-accent:\s*#5b5bff/);
  assert.match(css, /--color-success:\s*#22c55e/);
  assert.match(css, /--space-2:\s*16px/);
  assert.match(css, /--duration-base:\s*240ms/);
  assert.match(css, /--ease-standard:\s*cubic-bezier/);
});

test('tokens: Tailwind theme.extend', () => {
  const tw = toTailwindConfig(designModel());
  assert.match(tw, /"accent":\s*"#5b5bff"/);
  assert.match(tw, /"success":\s*"#22c55e"/);
  assert.match(tw, /transitionDuration/);
  assert.match(tw, /export default/);
});

test('tokens: W3C DTCG JSON', () => {
  const dtcg = toDesignTokens(designModel()) as any;
  assert.equal(dtcg.color.accent.$value, '#5b5bff');
  assert.equal(dtcg.color.accent.$type, 'color');
  assert.equal(dtcg.duration.base.$type, 'duration');
  assert.deepEqual(dtcg.cubicBezier.standard.$value, [0, 0, 0.58, 1]);
});
