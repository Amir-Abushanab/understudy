/**
 * Report render test: a design model renders to self-contained HTML with the
 * expected sections and no injected scripts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrandModel, LogoAsset } from '../brand/types.js';
import type { MotionModel } from '../analyze/model.js';
import type { DesignModel } from './design-model.js';
import { toBrandReport } from './report.js';

function design(logo?: LogoAsset): DesignModel {
  const motion: MotionModel = {
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
  const brand: BrandModel = {
    mode: 'light',
    colors: { light: { background: '#ffffff', surface: '#f5f5f5', text1: '#111111', text2: '#666666', accent: '#5b5bff', border: '#e5e5e5' } },
    accents: ['#5b5bff', '#22c55e'],
    states: { success: '#22c55e' },
    typography: {
      display: { family: 'Inter', size: 48, weight: 700, lineHeight: 1.1, letterSpacing: '0' },
      body: { family: 'Inter', size: 16, weight: 400, lineHeight: 1.5, letterSpacing: '0' },
      families: ['Inter'], scale: [16, 48], weights: [400, 700], fontFaces: [],
    },
    spacing: [0, 8, 16, 24], radii: [0, 8], borderWidths: [1], containers: [1200],
    shadows: ['0 1px 2px rgba(0,0,0,0.1)'], gradients: ['linear-gradient(135deg, #5b5bff, #22c55e)'],
    accessibility: { light: [{ pair: 'text1-on-background', ratio: 17.4, passes: ['AA-large', 'AA', 'AAA'] }] },
    provenance: { states: 'inferred' }, sampled: 100, challenged: false, confidence: 0.8,
    ...(logo ? { logo } : {}),
  };
  return { name: 'Test', source: 'https://example.com', capturedAt: 't', brand, motion };
}

test('report: renders the brand model as self-contained HTML', () => {
  const html = toBrandReport(design());
  assert.match(html, /<main class="report">/);
  assert.match(html, /Color/);
  assert.match(html, /Typography/);
  assert.match(html, /Motion/);
  assert.match(html, /#5b5bff/, 'accent swatch present');
  assert.match(html, /cubic-bezier\(0, 0, 0.58, 1\)/, 'easing rendered');
  assert.match(html, /AAA/, 'accessibility badges rendered');
});

test('report: strips scripts and on* handlers from an injected logo SVG', () => {
  const evil: LogoAsset = { kind: 'svg', svg: '<svg onload="alert(1)"><script>alert(2)</script><rect fill="#f00"/></svg>' };
  const html = toBrandReport(design(evil));
  assert.ok(!/<script/i.test(html), 'no <script> in output');
  assert.ok(!/onload=/i.test(html), 'no inline handlers in output');
});
