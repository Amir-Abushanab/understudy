/**
 * Scroll pass (§10 step 3). Stepped scroll with a settle wait between steps, so
 * scroll-driven and reveal-on-enter motion has time to run and be sampled. This
 * is where the most brand-distinctive motion lives, so it is the first pass.
 */

import type { Page } from 'playwright';
import type { PassOptions } from '../types.js';

export async function runScrollPass(page: Page, opts: PassOptions): Promise<void> {
  const { scrollHeight, viewport } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));

  const distance = Math.max(0, scrollHeight - viewport);
  const steps = Math.min(14, Math.max(3, Math.ceil(scrollHeight / Math.max(viewport, 1))));

  for (let i = 1; i <= steps; i++) {
    const top = Math.round((distance * i) / steps);
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'auto' }), top);
    await page.waitForTimeout(opts.settleMs);
  }

  // Return to the top to catch motion triggered on the way back up.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await page.waitForTimeout(opts.settleMs);
}
