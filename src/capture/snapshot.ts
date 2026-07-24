/**
 * Computed-style snapshot: one walk of the rendered DOM after load, capturing the
 * style values every brand analyzer needs. Runs in the page and returns plain
 * records (style + geometry only, never text or selectors).
 *
 * This is the non-motion half of a capture: understudy reads the *computed*
 * brand values directly, which is more accurate than inferring them from a
 * screenshot, especially for CSS-in-JS with hashed class names.
 */

import type { Page } from 'playwright';
import type { StyleSnapshot } from '../brand/types.js';

const MAX_ELEMENTS = 5000;

export function snapshotStyles(page: Page): Promise<StyleSnapshot[]> {
  return page.evaluate((max) => {
    const out: StyleSnapshot[] = [];
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length && out.length < max; i++) {
      const el = all[i];
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 1) continue;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;

      let hasText = false;
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3 && (node.textContent || '').trim().length > 0) {
          hasText = true;
          break;
        }
      }

      const tag = el.tagName.toLowerCase();
      const family = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();

      out.push({
        tag,
        area,
        color: cs.color,
        background: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        borderWidth: parseFloat(cs.borderTopWidth) || 0,
        fontFamily: family,
        fontSize: parseFloat(cs.fontSize) || 0,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        lineHeight: cs.lineHeight === 'normal' ? 0 : parseFloat(cs.lineHeight) || 0,
        letterSpacing: cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing,
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
        paddingTop: parseFloat(cs.paddingTop) || 0,
        paddingLeft: parseFloat(cs.paddingLeft) || 0,
        marginTop: parseFloat(cs.marginTop) || 0,
        gap: parseFloat(cs.gap) || 0,
        // Only gradients matter for accent recovery; skip images and cap length.
        backgroundImage: cs.backgroundImage.includes('gradient') ? cs.backgroundImage.slice(0, 400) : '',
        hasText,
        interactive: tag === 'a' || tag === 'button' || tag === 'input' || el.getAttribute('role') === 'button',
      });
    }
    return out;
  }, MAX_ELEMENTS);
}
