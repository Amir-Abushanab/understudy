/**
 * Capture session: Playwright lifecycle, instrument injection, and pass
 * orchestration. Honors the §7 safety posture end to end:
 *   - prefers-reduced-motion is forced to no-preference during capture, so we
 *     measure the real motion (disclosed in the README as a deliberate choice);
 *   - an honest, identifiable user-agent;
 *   - robots.txt is respected (capture refuses when disallowed);
 *   - a raw CDP session is attached (spec §3) and top-level off-origin
 *     navigations are cancelled;
 *   - one page at a time, with a settle delay between passes.
 */

import { chromium, type Browser, type Page } from 'playwright';
import type { CapturePassName, CaptureLimitation, SiteCapture } from './types.js';
import { instrumentBrowser } from './instrument.js';
import { snapshotStyles, snapshotFontFaces, fontFiles, pageSignals, captureLogo, captureExtraGradients, captureMeasure } from './snapshot.js';
import { assembleCapture, type RawCaptureData } from './assemble.js';
import { USER_AGENT_SUFFIX, installOffOriginGuard, isAllowedByRobots, collectSafeTargets } from './safety.js';
import { runScrollPass } from './passes/scroll.js';
import { runHoverPass } from './passes/hover.js';
import { runClickPass } from './passes/click.js';

export interface CaptureOptions {
  url: string;
  passes?: CapturePassName[];
  windowMs?: number;
  settleMs?: number;
  headless?: boolean;
  /** Bypass the robots.txt check. Off by default; used for local fixture runs. */
  ignoreRobots?: boolean;
}

const DEFAULT_PASSES: CapturePassName[] = ['scroll', 'hover', 'click'];

/** Time to let load / on-enter motion play out before the interaction passes.
 * Longer than the inter-step settle because entrance choreography often runs
 * for a second or more; this is why a plain capture needs no --settle tuning. */
const LOAD_SETTLE_MS = 1200;

export async function captureSite(options: CaptureOptions): Promise<SiteCapture> {
  const passes = options.passes ?? DEFAULT_PASSES;
  const windowMs = options.windowMs ?? 8000;
  const settleMs = options.settleMs ?? 350;
  const headless = options.headless ?? true;
  const capturedAt = new Date().toISOString();
  const limitations: CaptureLimitation[] = [];

  if (!options.ignoreRobots && !(await isAllowedByRobots(options.url, USER_AGENT_SUFFIX))) {
    throw new Error(`robots.txt disallows capturing ${options.url}. Respecting it and stopping.`);
  }

  const browser: Browser = await chromium.launch({ headless });
  try {
    // Read the real UA once so we can append our identifier honestly.
    const probe = await browser.newContext();
    const probePage = await probe.newPage();
    const baseUA = await probePage.evaluate(() => navigator.userAgent);
    await probe.close();

    const context = await browser.newContext({
      userAgent: `${baseUA} ${USER_AGENT_SUFFIX}`,
      reducedMotion: 'no-preference',
      viewport: { width: 1280, height: 800 },
    });
    const page: Page = await context.newPage();

    // Attach a raw CDP session (spec §3). Not required by the result-sampling
    // approach, but available for future CDP-based hooks and cross-checks.
    await context.newCDPSession(page).catch(() => undefined);

    // Define esbuild's __name helper globally before anything else runs, so
    // functions serialized into the page (addInitScript, page.evaluate) resolve
    // it. tsx/esbuild keeps function names via __name wrappers; without this shim
    // those wrappers throw in the page. A no-op under the plain tsc build.
    await page.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
    await page.addInitScript(instrumentBrowser);
    await installOffOriginGuard(page, options.url);

    await page.goto(options.url, { waitUntil: 'load', timeout: Math.max(20000, windowMs) });
    await page.waitForTimeout(Math.max(settleMs, LOAD_SETTLE_MS)); // let load / on-enter motion run (tagged `load`)

    const t0 = Date.now();
    for (const name of passes) {
      if (Date.now() - t0 > windowMs) {
        limitations.push({ kind: 'truncated-raf', detail: `capture window of ${windowMs}ms reached before the ${name} pass ran` });
        break;
      }
      await setPass(page, name);
      if (name === 'scroll') await runScrollPass(page, { settleMs, windowMs });
      else if (name === 'hover') await runHoverPass(page, { settleMs, windowMs });
      else if (name === 'click') await runClickPass(page, { settleMs, windowMs });
    }

    const raw = (await page.evaluate(() => (window as unknown as Record<string, unknown>).__UNDERSTUDY__)) as RawCaptureData;
    if (!raw) throw new Error('instrumentation did not initialize; no data captured');

    // Brand snapshots in both color schemes. Motion is already frozen in `raw`,
    // so forcing a scheme (which can trigger theme transitions) cannot pollute it.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
    const defaultBackground = await page.evaluate(pageBackgroundInPage);

    // Interaction-state colors: hover safe targets and note chromatic shifts.
    const hoverAccents = await captureHoverAccents(page);
    const logo = await captureLogo(page);
    const extraGradients = await captureExtraGradients(page);
    const measure = await captureMeasure(page);

    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(250);
    const light = await snapshotStyles(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(250);
    const dark = await snapshotStyles(page);

    const fontFaces = await snapshotFontFaces(page);
    const fontFileUrls = await fontFiles(page);
    const signals = await pageSignals(page);

    // A mobile-width, light-scheme snapshot so responsive/fluid type is visible.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobile = await snapshotStyles(page);

    // Manual theme toggle: many sites implement dark mode with a button + class,
    // not prefers-color-scheme, so emulateMedia never flips them. Back at desktop,
    // find and click a theme toggle (best-effort, never navigates); if it flips the
    // theme, assembleBrand picks up the second mode.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(200);
    const toggled = await tryThemeToggle(page);

    const motion = assembleCapture(raw, { source: options.url, capturedAt, passes, limitations });
    return {
      motion,
      styles: {
        light, dark, mobile, defaultBackground, fontFaces, fontFiles: fontFileUrls, hoverAccents, extraGradients, measure, signals,
        ...(toggled ? { toggled } : {}),
        ...(logo ? { logo } : {}),
      },
    };
  } finally {
    await browser.close();
  }
}

/** The color actually painted behind the page. body/html cover most sites, but
 * many leave both transparent and paint the background on a full-bleed wrapper
 * <div> (Tailwind's `dark:bg-*`, an app root like #__next). When both are
 * transparent, sample the background through the page gutters, so wrapper-painted
 * backgrounds (and the ones a theme toggle flips) are actually seen. Runs in the
 * page; self-contained so it can be serialized to page.evaluate. */
function pageBackgroundInPage(): string {
  const transparent = (c: string): boolean => !c || c === 'transparent' || /rgba?\([^)]*,\s*0\s*\)$/.test(c);
  const bg = (el: Element | null): string => (el ? getComputedStyle(el).backgroundColor : '');
  const html = document.documentElement;
  if (!transparent(bg(document.body))) return bg(document.body);
  if (!transparent(bg(html))) return bg(html);
  const firstOpaque = (el: Element | null): string => {
    let n: Element | null = el;
    while (n && n !== html) {
      const c = bg(n);
      if (!transparent(c)) return c;
      n = n.parentElement;
    }
    return bg(html);
  };
  const vw = window.innerWidth || 1280;
  const mid = Math.round((window.innerHeight || 800) / 2);
  const points: [number, number][] = [
    [3, mid],
    [vw - 3, mid],
    [Math.round(vw / 2), 3],
  ];
  for (const [x, y] of points) {
    const c = firstOpaque(document.elementFromPoint(x, y));
    if (!transparent(c)) return c;
  }
  return bg(html) || bg(document.body);
}

/** Find and click a manual theme/appearance toggle, then snapshot the result, so
 * toggle-based dark modes — which prefers-color-scheme emulation cannot trigger —
 * are still captured. Best-effort and safe: it never follows a navigating link,
 * and returns null on no match or any error, so a wrong guess just yields a
 * snapshot the assembler discards (no luminance change). */
async function tryThemeToggle(page: Page): Promise<Awaited<ReturnType<typeof snapshotStyles>> | null> {
  try {
    // Effective page background, including wrapper-<div>-painted ones (see helper).
    const bgOf = (): Promise<string> => page.evaluate(pageBackgroundInPage);
    const initial = await bgOf();

    // Drive the CSS dark-mode mechanism directly rather than hunting for a toggle
    // button (often an icon inside a closed dropdown). A toggle just sets a class
    // or data-* on <html>; apply the common signals ourselves and see if the
    // stylesheet responds. Self-validating: it only counts if the background flips,
    // so a site with no dark mode simply yields nothing. Try dark first, then light
    // (so a dark-default site still reveals its light mode).
    const apply = (theme: 'dark' | 'light'): Promise<void> =>
      page.evaluate((t) => {
        const other = t === 'dark' ? 'light' : 'dark';
        for (const el of [document.documentElement, document.body]) {
          if (!el) continue;
          el.classList.remove(other, `${other}-mode`, `theme-${other}`);
          el.classList.add(t, `${t}-mode`);
          for (const a of ['data-theme', 'data-color-mode', 'data-mode', 'data-bs-theme', 'data-color-scheme', 'data-appearance']) el.setAttribute(a, t);
          (el as HTMLElement).style.colorScheme = t;
        }
      }, theme);

    for (const theme of ['dark', 'light'] as const) {
      await apply(theme);
      await page.waitForTimeout(400); // let the stylesheet + transitions settle
      if ((await bgOf()) !== initial) return await snapshotStyles(page);
    }
    return null;
  } catch {
    return null;
  }
}

/** Hover a handful of safe interactive elements and record the resulting color at
 * that point. Best-effort: wrapped so it never fails a capture. */
async function captureHoverAccents(page: Page): Promise<string[]> {
  const shifts: string[] = [];
  try {
    const targets = await collectSafeTargets(page, 'hover', 10);
    for (const target of targets) {
      const before = await colorAtPoint(page, target.x, target.y);
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(110);
      const after = await colorAtPoint(page, target.x, target.y);
      await page.mouse.move(2, 2);
      if (after && after !== before) shifts.push(after);
    }
  } catch {
    /* best-effort; hover states are a bonus, not required */
  }
  return shifts;
}

function colorAtPoint(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      const transparent = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)' || /,\s*0\)\s*$/.test(bg);
      return transparent ? cs.color : bg;
    },
    { x, y },
  );
}

async function setPass(page: Page, name: CapturePassName): Promise<void> {
  await page.evaluate((n) => {
    const store = (window as unknown as Record<string, any>).__UNDERSTUDY__;
    if (store) store.pass = n;
  }, name);
}
