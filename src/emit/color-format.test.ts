/**
 * Color notation conversions: one sRGB color, rendered in OKLCH / hex / rgb /
 * hsl. OKLCH is derived through OKLab, so the tests pin the axes (L/C/H) rather
 * than an exact string, and confirm alpha and unparseable values are handled.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorFormats } from './color-format.js';

test('color-format: white and black are achromatic in OKLCH', () => {
  assert.equal(colorFormats('#ffffff').oklch, 'oklch(100% 0 0)');
  assert.equal(colorFormats('#000000').oklch, 'oklch(0% 0 0)');
});

test('color-format: a mid blue converts across every notation', () => {
  const f = colorFormats('#2563eb'); // rgb 37, 99, 235
  assert.equal(f.hex, '#2563eb');
  assert.equal(f.rgb, 'rgb(37, 99, 235)');
  assert.match(f.hsl, /^hsl\(\d+, \d+%, \d+%\)$/);
  const m = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(f.oklch);
  assert.ok(m, `unexpected OKLCH shape: ${f.oklch}`);
  assert.ok(Number(m![1]) > 45 && Number(m![1]) < 65, `lightness ${m![1]}% out of range`);
  assert.ok(Number(m![2]) > 0.15 && Number(m![2]) < 0.3, `chroma ${m![2]} out of range`);
  assert.ok(Number(m![3]) > 250 && Number(m![3]) < 275, `hue ${m![3]} out of range`);
});

test('color-format: alpha is carried through every notation', () => {
  const f = colorFormats('rgba(88, 166, 255, 0.36)');
  assert.equal(f.hex, '#58a6ff5c', '0.36 * 255 -> 92 -> 0x5c');
  assert.equal(f.rgb, 'rgba(88, 166, 255, 0.36)');
  assert.match(f.hsl, /^hsla\(.+, 0\.36\)$/);
  assert.match(f.oklch, / \/ 0\.36\)$/);
});

test('color-format: an unparseable value is returned verbatim in every slot', () => {
  assert.deepEqual(colorFormats('transparent'), {
    oklch: 'transparent',
    hex: 'transparent',
    rgb: 'transparent',
    hsl: 'transparent',
  });
});
