/**
 * assetUrls picks exactly the external assets a report loads (web fonts + a
 * raster logo) and skips inline/relative ones. The fetching in
 * collectReportAssets is network I/O and is exercised end to end, not here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrls } from './inline-assets.js';
import type { DesignModel } from './design-model.js';

function model(fontFaces: unknown[], logo: unknown): DesignModel {
  return { source: 'https://acme.test', brand: { typography: { fontFaces }, logo } } as unknown as DesignModel;
}

test('assetUrls: collects http font faces and a raster logo, skips inline/relative', () => {
  const d = model(
    [
      { family: 'A', src: 'https://acme.test/a.woff2', weight: '400', style: 'normal' },
      { family: 'B', src: '/rel/b.woff2', weight: '400', style: 'normal' }, // relative: skip
      { family: 'C', src: 'data:font/woff2;base64,zzz', weight: '400', style: 'normal' }, // inline: skip
      { family: 'D' }, // no src: skip
    ],
    { kind: 'img', src: 'https://acme.test/logo.png' },
  );
  assert.deepEqual(assetUrls(d).sort(), ['https://acme.test/a.woff2', 'https://acme.test/logo.png']);
});

test('assetUrls: an inlined SVG logo needs no fetch', () => {
  const d = model([], { kind: 'svg', svg: '<svg><path d="M0 0h10v10H0z"/></svg>' });
  assert.deepEqual(assetUrls(d), []);
});
