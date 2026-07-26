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
import type { StyleSnapshot, FontFaceRule, PageSignals, LogoAsset } from '../brand/types.js';

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
      const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';

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
        textTransform: cs.textTransform || 'none',
        fontStyle: cs.fontStyle || 'normal',
        fontStretch: cs.fontStretch || 'normal',
        fontVariantNumeric: cs.fontVariantNumeric || 'normal',
        fontFeatureSettings: cs.fontFeatureSettings || 'normal',
        fontVariationSettings: cs.fontVariationSettings || 'normal',
        fontOpticalSizing: cs.fontOpticalSizing || 'auto',
        wordSpacing: cs.wordSpacing === 'normal' || parseFloat(cs.wordSpacing) === 0 ? '0' : cs.wordSpacing,
        radius: parseFloat(cs.borderTopLeftRadius) || 0,
        shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
        paddingTop: parseFloat(cs.paddingTop) || 0,
        paddingLeft: parseFloat(cs.paddingLeft) || 0,
        marginTop: parseFloat(cs.marginTop) || 0,
        gap: parseFloat(cs.gap) || 0,
        backgroundImage: cs.backgroundImage.includes('gradient') ? cs.backgroundImage.slice(0, 400) : '',
        fill: isSvg && cs.fill !== 'none' ? cs.fill : '',
        stroke: isSvg && cs.stroke !== 'none' ? cs.stroke : '',
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

/** Find the brand mark: the home-linking header element containing an SVG or img. */
export function captureLogo(page: Page): Promise<LogoAsset | null> {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const candidates = links.filter((a) => {
      try {
        const home = a.href === location.origin || a.href === location.origin + '/' || new URL(a.href).pathname === '/';
        const named = /logo|brand|home/i.test(`${a.className} ${a.getAttribute('aria-label') || ''}`);
        return (home || named) && (a.querySelector('svg') !== null || a.querySelector('img') !== null);
      } catch {
        return false;
      }
    });
    // Prefer the topmost, leftmost candidate (the header mark).
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
    const el = candidates[0];
    if (!el) return null;

    const svg = el.querySelector('svg');
    if (svg) {
      const markup = svg.outerHTML.slice(0, 4000);
      const alt = el.getAttribute('aria-label');
      return alt ? { kind: 'svg' as const, svg: markup, alt } : { kind: 'svg' as const, svg: markup };
    }
    const img = el.querySelector('img');
    if (img) {
      return img.alt ? { kind: 'img' as const, src: img.src, alt: img.alt } : { kind: 'img' as const, src: img.src };
    }
    return null;
  });
}

/**
 * Gradients the element walk misses: SVG gradient defs (referenced via
 * fill="url(#id)", so the computed fill is just a URL) reconstructed as CSS
 * gradient strings, and background gradients on ::before/::after of large blocks.
 * These are where decorative brand gradients (Stripe's waves) actually live.
 */
export function captureExtraGradients(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const grads: string[] = [];

    const pct = (offset: string): string =>
      offset.includes('%') ? offset.trim() : `${Math.round((parseFloat(offset) || 0) * 100)}%`;
    const withOpacity = (color: string, opacity: string): string => {
      const o = parseFloat(opacity);
      if (!Number.isFinite(o) || o >= 1) return color;
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (!m) return color;
      const [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
      return `rgba(${r}, ${g}, ${b}, ${o})`;
    };

    // SVG gradient definitions.
    for (const g of Array.from(document.querySelectorAll('linearGradient, radialGradient'))) {
      const stops = Array.from(g.querySelectorAll('stop')).map((s) => {
        const cs = getComputedStyle(s);
        return `${withOpacity(cs.stopColor, cs.stopOpacity)} ${pct(s.getAttribute('offset') || '0')}`;
      });
      if (stops.length < 2) continue;
      if (g.tagName.toLowerCase() === 'lineargradient') {
        const x1 = parseFloat(g.getAttribute('x1') || '0');
        const y1 = parseFloat(g.getAttribute('y1') || '0');
        const x2 = parseFloat(g.getAttribute('x2') || '1');
        const y2 = parseFloat(g.getAttribute('y2') || '0');
        const angle = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90);
        grads.push(`linear-gradient(${angle}deg, ${stops.join(', ')})`);
      } else {
        grads.push(`radial-gradient(circle, ${stops.join(', ')})`);
      }
    }

    // Pseudo-element gradients on large blocks (decorative backgrounds).
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const rect = all[i].getBoundingClientRect();
      if (rect.width * rect.height < 20000) continue;
      for (const pseudo of ['::before', '::after']) {
        const bg = getComputedStyle(all[i], pseudo).backgroundImage;
        if (bg && bg.includes('gradient')) grads.push(bg.slice(0, 400));
      }
    }

    return Array.from(new Set(grads)).slice(0, 20);
  });
}

/** Body measure: the median characters-per-line of wrapped running text. A real
 * typographic decision (optimal measure is ~45-75ch), measured from rendered
 * paragraphs (text length / line count) rather than estimated. */
export function captureMeasure(page: Page): Promise<number> {
  return page.evaluate(() => {
    const measures: number[] = [];
    for (const p of Array.from(document.querySelectorAll('p, li'))) {
      const text = (p.textContent || '').trim();
      if (text.length < 40) continue;
      const cs = getComputedStyle(p);
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
      if (!lh) continue;
      const lines = Math.round(p.getBoundingClientRect().height / lh);
      if (lines < 2) continue; // single-line text is not measure-limited
      measures.push(text.length / lines);
    }
    if (measures.length === 0) return 0;
    measures.sort((a, b) => a - b);
    return Math.round(measures[Math.floor(measures.length / 2)]);
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
