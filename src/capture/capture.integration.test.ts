/**
 * Browser integration test (§10 step 2: "verify against fixtures that every
 * animation is seen"). This is the end-to-end proof that the instrument sees
 * real motion in a real browser, including a pure requestAnimationFrame tween
 * that the DevTools Animations panel cannot see.
 *
 * It captures the fixture pages over file:// and checks recovery. It SKIPS
 * cleanly when no browser is installed, so `pnpm test` stays green everywhere;
 * install a browser with `pnpm exec playwright install chromium` to run it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { captureSite } from './session.js';
import { recoverStagger } from '../analyze/cluster.js';
import { fitCubicBezier, evalCubicBezier } from '../analyze/bezier.js';
import { fitSpring } from '../analyze/spring.js';

async function browserAvailable(): Promise<boolean> {
  try {
    const b = await chromium.launch();
    await b.close();
    return true;
  } catch {
    return false;
  }
}

function fixtureUrl(name: string): string {
  return pathToFileURL(resolve(process.cwd(), 'fixtures', name, 'index.html')).href;
}

test('integration: recovers the 120ms stagger from the real fixture', async (t) => {
  if (!(await browserAvailable())) {
    t.skip('chromium not installed (run: pnpm exec playwright install chromium)');
    return;
  }
  const cap = await captureSite({ url: fixtureUrl('stagger-120ms'), passes: [], settleMs: 1500, windowMs: 6000, ignoreRobots: true });
  assert.ok(cap.motion.events.length >= 5, `expected >=5 motions, got ${cap.motion.events.length}`);

  const clusters = recoverStagger(cap.motion.events.filter((e) => e.trigger === 'load')).filter((c) => c.confident);
  assert.ok(clusters.length >= 1, 'a confident stagger cluster was expected');
  const best = clusters.sort((a, b) => b.size - a.size)[0];
  assert.ok(Math.abs(best.intervalMs - 120) <= 20, `recovered ${best.intervalMs}ms, expected ~120ms`);
});

test('integration: sees a pure rAF tween (the DevTools blind spot)', async (t) => {
  if (!(await browserAvailable())) {
    t.skip('chromium not installed');
    return;
  }
  const cap = await captureSite({ url: fixtureUrl('raf-imperative'), passes: [], settleMs: 1200, windowMs: 6000, ignoreRobots: true });
  const raf = cap.motion.events.filter((e) => e.source === 'raf' && e.property === 'translateY');
  assert.ok(raf.length >= 1, 'a rAF translateY motion should be observed');

  // The recovered easing should be front-loaded (ease-out), like easeOutCubic.
  const fit = fitCubicBezier(raf[0].samples);
  assert.ok(evalCubicBezier(fit.control, 0.5) > 0.55, 'fitted easing should decelerate into place');
});

test('integration: sees a rAF spring and detects the overshoot', async (t) => {
  if (!(await browserAvailable())) {
    t.skip('chromium not installed');
    return;
  }
  const cap = await captureSite({ url: fixtureUrl('spring-overshoot'), passes: [], settleMs: 1600, windowMs: 6000, ignoreRobots: true });
  const springable = cap.motion.events.filter((e) => e.property === 'translateY').map((e) => fitSpring(e.samples)).filter(Boolean);
  assert.ok(springable.length >= 1, 'an overshooting spring should be detected');
});
