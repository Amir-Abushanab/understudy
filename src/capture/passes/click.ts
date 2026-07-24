/**
 * Click pass (§10 step 7). Click safe targets only. "Safe" is defined in
 * capture/safety.ts: never a form control, submit button, off-origin link, or
 * anything whose text/label reads as destructive or transactional. The
 * off-origin navigation guard is a second line of defense if a click still tries
 * to navigate away.
 */

import type { Page } from 'playwright';
import type { PassOptions } from '../types.js';
import { collectSafeTargets } from '../safety.js';

const MAX_CLICK_TARGETS = 8;

export async function runClickPass(page: Page, opts: PassOptions): Promise<void> {
  const targets = await collectSafeTargets(page, 'click', MAX_CLICK_TARGETS);
  for (const target of targets) {
    try {
      await page.mouse.click(target.x, target.y, { delay: 20 });
    } catch {
      // A target may have moved or been covered; skip it rather than fail the run.
    }
    await page.waitForTimeout(opts.settleMs);
  }
}
