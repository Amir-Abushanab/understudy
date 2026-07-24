/**
 * Hover pass (§10 step 7). Hover each safe interactive element, then move away so
 * the hover-out transition is also observed. Target selection and all safety
 * constraints live in capture/safety.ts.
 */

import type { Page } from 'playwright';
import type { PassOptions } from '../types.js';
import { collectSafeTargets } from '../safety.js';

const MAX_HOVER_TARGETS = 16;

export async function runHoverPass(page: Page, opts: PassOptions): Promise<void> {
  const targets = await collectSafeTargets(page, 'hover', MAX_HOVER_TARGETS);
  for (const target of targets) {
    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(opts.settleMs);
    await page.mouse.move(2, 2); // move away to trigger the hover-out
    await page.waitForTimeout(Math.min(opts.settleMs, 120));
  }
}
