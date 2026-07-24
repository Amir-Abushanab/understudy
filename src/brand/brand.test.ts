/**
 * Brand analyzer tests (browser-free): synthetic computed-style snapshots must
 * recover the expected palette roles, mode, type roles, and scales.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StyleSnapshot } from './types.js';
import { assembleBrand } from './index.js';
import { extractColors, luminance, parseColor, mergePalette } from './color.js';

function snap(p: Partial<StyleSnapshot>): StyleSnapshot {
  return {
    tag: 'div', area: 100, width: 100, maxWidth: 0, color: 'rgb(20, 20, 20)', background: 'rgba(0, 0, 0, 0)',
    borderColor: 'rgb(0, 0, 0)', borderWidth: 0, fontFamily: 'Inter', fontSize: 16, fontWeight: 400,
    lineHeight: 24, letterSpacing: '0', radius: 0, shadow: '', paddingTop: 0, paddingLeft: 0,
    marginTop: 0, gap: 0, backgroundImage: '', hasText: false, interactive: false, ...p,
  };
}

function input(light: StyleSnapshot[], dark: StyleSnapshot[], defaultBackground: string) {
  return { light, dark, mobile: [], defaultBackground, fontFaces: [], fontFiles: [], hoverAccents: [], signals: { elementCount: light.length, title: '', textLength: 5000 } };
}

function lightSite(): StyleSnapshot[] {
  const s: StyleSnapshot[] = [];
  // white canvas
  for (let i = 0; i < 20; i++) s.push(snap({ background: 'rgb(255, 255, 255)', area: 10000 }));
  // dark body text
  for (let i = 0; i < 30; i++) s.push(snap({ color: 'rgb(20, 20, 20)', hasText: true, area: 500, fontSize: 16, fontWeight: 400 }));
  // muted secondary text
  for (let i = 0; i < 10; i++) s.push(snap({ color: 'rgb(110, 110, 120)', hasText: true, area: 200, fontSize: 14 }));
  // headings
  for (let i = 0; i < 4; i++) s.push(snap({ color: 'rgb(20, 20, 20)', hasText: true, area: 3000, fontSize: 48, fontWeight: 700 }));
  // blue accent buttons
  for (let i = 0; i < 6; i++) s.push(snap({ background: 'rgb(37, 99, 235)', interactive: true, area: 900, radius: 8, tag: 'button' }));
  // spacing + radii + border
  for (let i = 0; i < 10; i++) s.push(snap({ paddingTop: 8, gap: 16, area: 400 }));
  for (let i = 0; i < 10; i++) s.push(snap({ paddingTop: 16, area: 400 }));
  for (let i = 0; i < 6; i++) s.push(snap({ paddingTop: 24, radius: 12, area: 400, borderWidth: 1, borderColor: 'rgb(229, 229, 229)' }));
  return s;
}

test('brand: recovers a light palette with roles', () => {
  const { mode, colors } = extractColors(lightSite());
  assert.equal(mode, 'light');
  assert.equal(colors.background, '#ffffff');
  assert.equal(colors.text1, '#141414');
  assert.equal(colors.accent, '#2563eb', 'blue button color is the accent');
  assert.notEqual(colors.text2, colors.text1, 'a secondary text color is distinguished');
});

test('brand: detects dark mode from a dark canvas', () => {
  const s: StyleSnapshot[] = [];
  for (let i = 0; i < 20; i++) s.push(snap({ background: 'rgb(15, 15, 20)', area: 10000 }));
  for (let i = 0; i < 20; i++) s.push(snap({ color: 'rgb(240, 240, 245)', hasText: true, area: 500 }));
  assert.equal(extractColors(s).mode, 'dark');
});

test('brand: recovers type roles and scales', () => {
  const brand = assembleBrand(input(lightSite(), lightSite(), 'rgb(255, 255, 255)'));
  assert.equal(brand.mode, 'light');
  assert.ok(brand.colors.light, 'light palette present');
  assert.equal(brand.typography.families[0], 'Inter');
  assert.equal(brand.typography.body.size, 16);
  assert.ok(brand.typography.display.size >= 40, 'display picks up the heading size');
  assert.equal(brand.typography.display.weight, 700);
  assert.ok(brand.typography.weights.includes(400) && brand.typography.weights.includes(700), `weights were ${brand.typography.weights}`);
  assert.ok(brand.spacing.includes(8) && brand.spacing.includes(16), `spacing was ${brand.spacing}`);
  assert.equal(brand.spacing[0], 0, 'spacing scale starts at 0');
  assert.ok(brand.radii.includes(8), `radii were ${brand.radii}`);
});

test('brand: emits both palettes when the site themes light and dark', () => {
  const light = lightSite();
  const dark: StyleSnapshot[] = [];
  for (let i = 0; i < 20; i++) dark.push(snap({ background: 'rgb(15, 15, 20)', area: 10000 }));
  for (let i = 0; i < 20; i++) dark.push(snap({ color: 'rgb(240, 240, 245)', hasText: true, area: 500 }));
  const brand = assembleBrand(input(light, dark, 'rgb(255, 255, 255)'));
  assert.equal(brand.mode, 'light', 'primary mode from default background');
  assert.ok(brand.colors.light && brand.colors.dark, 'both palettes emitted when themed');
  assert.equal(brand.colors.dark?.background, '#0f0f14');
});

test('brand: emits a single palette when the site ignores the scheme', () => {
  const only = lightSite();
  const brand = assembleBrand(input(only, only, 'rgb(255, 255, 255)'));
  assert.deepEqual(Object.keys(brand.colors), ['light']);
});

test('color: mergePalette folds near-identical colors together', () => {
  const merged = mergePalette([
    { key: '#061b31', weight: 10 },
    { key: '#061b32', weight: 5 },
    { key: '#e5edf5', weight: 8 },
  ]);
  assert.equal(merged.length, 2, 'the two near-navies collapse into one');
  assert.equal(merged[0].key, '#061b31', 'heaviest member is the representative');
  assert.equal(merged[0].weight, 15);
});

test('brand: a bot/challenge page is flagged with near-zero confidence', () => {
  const brand = assembleBrand({
    light: [], dark: [], mobile: [], defaultBackground: 'rgb(255,255,255)', fontFaces: [], fontFiles: [], hoverAccents: [],
    signals: { elementCount: 12, title: 'Just a moment...', textLength: 40 },
  });
  assert.equal(brand.challenged, true);
  assert.ok(brand.confidence <= 0.1, `confidence was ${brand.confidence}`);
});

test('brand: infers a success state from a palette green, not the accent', () => {
  const site = lightSite();
  for (let i = 0; i < 5; i++) site.push(snap({ background: 'rgb(22, 163, 74)', interactive: true, area: 300, tag: 'button' }));
  const brand = assembleBrand(input(site, site, 'rgb(255, 255, 255)'));
  assert.ok(brand.accents.length >= 2, `accents ${brand.accents}`);
  assert.equal(brand.colors.light?.accent, '#2563eb', 'blue is still the primary accent');
  assert.ok(brand.states.success, `expected a success state, got ${JSON.stringify(brand.states)}`);
});

test('color: luminance ranks light above dark', () => {
  const white = parseColor('rgb(255,255,255)')!;
  const black = parseColor('rgb(0,0,0)')!;
  assert.ok(luminance(white) > luminance(black));
});
