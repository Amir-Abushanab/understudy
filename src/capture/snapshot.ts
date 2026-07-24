/**
 * Computed-style snapshot: one walk of the rendered DOM after load, capturing the
 * style values every brand analyzer needs. Runs in the page and returns plain
 * records (style + geometry only, never text or selectors).
 *
 * The walk pierces open shadow roots and same-origin iframes, so web-component
 * and embed-heavy sites are not silently under-sampled. Alongside the element
 * snapshot, we read the @font-face rules (the actual brand font assets) and a few
 * page-health signals used to detect bot/challenge pages.
 */

import type { Page } from 'playwright';
import type { StyleSnapshot, FontFaceRule, PageSignals } from '../brand/types.js';

const MAX_ELEMENTS = 6000;

export function snapshotStyles(page: Page): Promise<StyleSnapshot[]> {
  return page.evaluate((max) => {
    const out: StyleSnapshot[] = [];

    const record = (el: Element): void => {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 1) return;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;

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
        width: Math.round(rect.width),
        maxWidth: cs.maxWidth === 'none' ? 0 : parseFloat(cs.maxWidth) || 0,
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
        backgroundImage: cs.backgroundImage.includes('gradient') ? cs.backgroundImage.slice(0, 400) : '',
        hasText,
        interactive: tag === 'a' || tag === 'button' || tag === 'input' || el.getAttribute('role') === 'button',
      });
    };

    const walk = (root: Document | ShadowRoot): void => {
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        if (out.length >= max) return;
        const el = all[i];
        record(el);
        if (el.shadowRoot) walk(el.shadowRoot); // open shadow DOM
        if (el.tagName === 'IFRAME') {
          try {
            const doc = (el as HTMLIFrameElement).contentDocument;
            if (doc) walk(doc); // same-origin iframe; cross-origin throws
          } catch {
            /* cross-origin frame, skip */
          }
        }
      }
    };

    walk(document);
    return out;
  }, MAX_ELEMENTS);
}

/** Read @font-face rules from the page stylesheets: the real brand font assets. */
export function snapshotFontFaces(page: Page): Promise<FontFaceRule[]> {
  return page.evaluate(() => {
    const faces: FontFaceRule[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const style = rule.style;
          const rawSrc = style.getPropertyValue('src');
          const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(rawSrc);
          faces.push({
            family: (style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(),
            weight: style.getPropertyValue('font-weight') || '400',
            style: style.getPropertyValue('font-style') || 'normal',
            src: url ? new URL(url[1], sheet.href || location.href).href : '',
          });
        }
      }
    }
    return faces;
  });
}

/** Font file URLs the page actually loaded. Reads the resource timeline and
 * preload links, so it captures cross-origin CDN fonts that CSSOM cannot. */
export function fontFiles(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const urls = new Set<string>();
    for (const entry of performance.getEntriesByType('resource')) {
      if (/\.(woff2?|ttf|otf)(\?|$)/i.test(entry.name)) urls.add(entry.name);
    }
    for (const link of Array.from(document.querySelectorAll('link[rel="preload"][as="font"]'))) {
      const href = (link as HTMLLinkElement).href;
      if (href) urls.add(href);
    }
    return Array.from(urls).slice(0, 40);
  });
}

/** Cheap page-health signals for bot/challenge detection. */
export function pageSignals(page: Page): Promise<PageSignals> {
  return page.evaluate(() => ({
    elementCount: document.querySelectorAll('*').length,
    title: document.title || '',
    textLength: (document.body ? document.body.innerText : '').length,
  }));
}
