/**
 * Browser integration test for brand extraction: capture the brand-known fixture
 * (which has intentional, recorded values) and assert the full pipeline recovers
 * them. This is the fixtures-first discipline applied to brand, the same way the
 * motion fixtures anchor motion recovery. SKIPS cleanly when no browser exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { captureSite } from '../capture/session.js';
import { assembleBrand } from './index.js';

const GT = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/ground-truth.json'), 'utf8'))['brand-known'];

async function browserAvailable(): Promise<boolean> {
  try {
    const b = await chromium.launch();
    await b.close();
    return true;
  } catch {
    return false;
  }
}

test('integration: recovers the known brand from the fixture', async (t) => {
  if (!(await browserAvailable())) {
    t.skip('chromium not installed (run: pnpm exec playwright install chromium)');
    return;
  }
  const url = pathToFileURL(resolve(process.cwd(), 'fixtures/brand-known/index.html')).href;
  const cap = await captureSite({ url, passes: [], settleMs: 400, windowMs: 6000, ignoreRobots: true });
  const brand = assembleBrand(cap.styles);
  const c = brand.colors[brand.mode];

  assert.equal(brand.mode, 'light');
  assert.ok(c, 'primary palette present');
  assert.equal(c!.background, GT.background);
  assert.equal(c!.accent, GT.accent, 'violet accent');
  assert.equal(c!.surface, GT.surface);
  assert.equal(c!.text1, GT.text1, 'near-black primary text');
  assert.equal(c!.text2, GT.text2, 'muted secondary text');
  assert.equal(c!.border, GT.border);

  assert.ok(brand.typography.families.includes(GT.bodyFamily), `families ${brand.typography.families}`);
  assert.equal(brand.typography.body.size, GT.bodySize);
  assert.equal(brand.typography.display.size, GT.displaySize);

  for (const s of GT.spacing) assert.ok(brand.spacing.includes(s), `spacing ${brand.spacing} is missing ${s}`);
  assert.ok(brand.radii.includes(GT.radius), `radii ${brand.radii}`);

  assert.ok(
    brand.accents.includes(GT.successColor) || brand.states.success === GT.successColor,
    `expected the green ${GT.successColor}; accents ${brand.accents}, states ${JSON.stringify(brand.states)}`,
  );

  assert.ok(brand.logo && brand.logo.kind === 'svg', 'inline SVG logo captured');
});
