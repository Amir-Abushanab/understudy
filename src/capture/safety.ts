/**
 * Capture safety (§7). The passes drive a real browser against a real site, so
 * every interaction is constrained here in one place:
 *   - never submit forms or touch form controls / submit buttons;
 *   - never click destructive or transactional text (buy, delete, checkout, ...);
 *   - never authenticate;
 *   - stay on-origin (cancel top-level navigations away from the target);
 *   - respect robots.txt and send a truthful, identifiable user-agent.
 *
 * This is an additive helper (not in the spec's file layout §4); it exists so
 * the §7 rules live in exactly one auditable place instead of being duplicated
 * across the scroll/hover/click passes.
 */

import type { Page } from 'playwright';

/** Appended to the browser UA so we are identifiable and honest (§7). */
export const USER_AGENT_SUFFIX =
  'understudy/0.1 (+https://github.com/understudy-motion/understudy; motion measurement bot)';

/** Words that mark a control as destructive or transactional; never interacted with. */
const DESTRUCTIVE_SRC =
  '\\b(buy|purchase|checkout|pay|order|subscribe|unsubscribe|sign\\s?up|signup|register|log\\s?in|login|sign\\s?in|delete|remove|cancel|confirm|add to cart|donate)\\b';

export interface SafePoint {
  x: number;
  y: number;
}

/**
 * Collect viewport-center points of elements that are safe to hover or click.
 * Runs entirely in the page; returns only coordinates, never selectors or text,
 * so nothing identifying leaves the browser.
 */
export function collectSafeTargets(page: Page, kind: 'hover' | 'click', max: number): Promise<SafePoint[]> {
  return page.evaluate(
    ({ kind, max, destructiveSrc }) => {
      const destructive = new RegExp(destructiveSrc, 'i');
      const selector =
        kind === 'hover'
          ? 'a, button, [role="button"], [tabindex], summary'
          : 'button, [role="button"], [aria-expanded], summary';
      const out: { x: number; y: number }[] = [];
      const seen = new Set<string>();

      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (out.length >= max) break;
        if (el.closest('form')) continue; // never touch anything inside a form
        const type = el.getAttribute('type');
        if (type === 'submit' || type === 'reset') continue;
        const text = (el.textContent || '').trim().slice(0, 60);
        if (destructive.test(text)) continue;
        if (destructive.test(el.getAttribute('aria-label') || '')) continue;
        if (el instanceof HTMLAnchorElement) {
          if (el.target === '_blank') continue;
          try {
            if (new URL(el.href, location.href).origin !== location.origin) continue;
          } catch {
            continue;
          }
        }
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x, y });
      }
      return out;
    },
    { kind, max, destructiveSrc: DESTRUCTIVE_SRC },
  );
}

/**
 * Cancel any top-level navigation away from the target origin (§7). Subresources
 * (fonts, images, CDN scripts) continue normally; only a main-frame document
 * request to a different origin is aborted. No-op for file:// captures.
 */
export async function installOffOriginGuard(page: Page, targetUrl: string): Promise<void> {
  let origin: string;
  try {
    const u = new URL(targetUrl);
    if (u.protocol === 'file:') return;
    origin = u.origin;
  } catch {
    return;
  }
  await page.route('**/*', (route) => {
    const req = route.request();
    try {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        const u = new URL(req.url());
        if (u.origin !== origin && req.url() !== targetUrl) return route.abort();
      }
    } catch {
      /* fall through to continue */
    }
    return route.continue();
  });
}

/**
 * Minimal robots.txt check for the given URL and user-agent. Returns true (allow)
 * when robots.txt is absent or unreadable, which is the conventional default.
 */
export async function isAllowedByRobots(targetUrl: string, userAgent: string): Promise<boolean> {
  let base: URL;
  try {
    base = new URL(targetUrl);
  } catch {
    return true;
  }
  if (base.protocol === 'file:') return true;

  let text: string;
  try {
    const res = await fetch(new URL('/robots.txt', base.origin), { headers: { 'user-agent': userAgent } });
    if (!res.ok) return true;
    text = await res.text();
  } catch {
    return true;
  }

  const disallows = collectDisallows(text, userAgent);
  const path = base.pathname || '/';
  return !disallows.some((rule) => rule.length > 0 && path.startsWith(rule));
}

/** Parse Disallow rules from the group matching our UA, falling back to `*`. */
function collectDisallows(robots: string, userAgent: string): string[] {
  const lines = robots.split('\n').map((l) => l.replace(/#.*$/, '').trim());
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.disallow.length > 0) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === 'disallow' && current) {
      current.disallow.push(value);
    }
  }

  const uaLower = userAgent.toLowerCase();
  const matching = groups.filter((g) => g.agents.some((a) => a === '*' || uaLower.includes(a) || a.includes('understudy')));
  const chosen = matching.length > 0 ? matching : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.disallow);
}
