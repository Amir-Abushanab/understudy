/**
 * The instrumentation init script, injected via `Page.addInitScript` so it runs
 * before any page script (§10 step 2). It is a single self-contained function:
 * Playwright serializes it with `.toString()`, so it must close over nothing and
 * reference only browser globals.
 *
 * The core idea (see capture/types.ts): observe the *result*, not the mechanism.
 *   - A rAF sampling loop reads the computed transform/opacity of tracked
 *     elements every frame and records what changed. This is what lets us see
 *     requestAnimationFrame / GSAP / Lenis motion that DevTools cannot.
 *   - Elements enter the tracked set when they fire a transition/animation event,
 *     when Element.animate() is called on them, or when a MutationObserver sees
 *     their inline style/class change (which is exactly what imperative JS
 *     animation libraries do every frame).
 *   - WAAPI and CSS motions additionally contribute declared metadata (duration,
 *     easing, delay), captured but never depended upon.
 *
 * Everything is deposited on `window.__UNDERSTUDY__`; the Node session reads it
 * with page.evaluate after the passes run.
 */

/** Injected into the page. Keep self-contained: no imports, no outer references. */
export function instrumentBrowser(): void {
  const w = window as unknown as Record<string, any>;
  if (w.__UNDERSTUDY__) return; // idempotent across re-injection

  const MAX_SAMPLES = 60000;
  const EPS = { translate: 0.5, scale: 0.01, rotate: 0.5, opacity: 0.01 };

  const store = {
    pass: 'load' as string,
    startT: performance.now(),
    samples: [] as any[],
    scroll: [] as any[],
    waapi: [] as any[],
    css: [] as any[],
    labels: {} as Record<string, string>,
    rejected: 0,
    totalRaw: 0,
    meta: {
      reducedMotion:
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    },
  };
  w.__UNDERSTUDY__ = store;

  const now = (): number => performance.now() - store.startT;

  // --- stable, non-identifying element identity ----------------------------
  const ids = new WeakMap<Element, string>();
  let counter = 0;
  function idOf(el: Element): string {
    let id = ids.get(el);
    if (!id) {
      id = 'e' + counter++;
      ids.set(el, id);
    }
    return id;
  }
  /** A generic role label; never element text or a selector, to avoid leaking. */
  function labelOf(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (tag === 'h1') return 'headline';
    if (tag === 'h2' || tag === 'h3') return 'subhead';
    if (tag === 'button' || role === 'button') return 'cta';
    if (tag === 'a') return 'link';
    if (tag === 'img' || tag === 'picture' || tag === 'svg') return 'image';
    if (tag === 'p' || tag === 'span' || tag === 'li') return 'text';
    if (tag === 'section' || tag === 'header' || tag === 'main') return 'region';
    return tag;
  }

  // --- computed motion channels --------------------------------------------
  function parseTransform(value: string): { translateX: number; translateY: number; scale: number; rotate: number } {
    if (!value || value === 'none') return { translateX: 0, translateY: 0, scale: 1, rotate: 0 };
    const nums = value.match(/matrix3?d?\(([^)]+)\)/);
    if (!nums) return { translateX: 0, translateY: 0, scale: 1, rotate: 0 };
    const p = nums[1].split(',').map((n) => parseFloat(n));
    if (value.startsWith('matrix3d')) {
      return {
        translateX: p[12], translateY: p[13],
        scale: Math.hypot(p[0], p[1]),
        rotate: (Math.atan2(p[1], p[0]) * 180) / Math.PI,
      };
    }
    return {
      translateX: p[4], translateY: p[5],
      scale: Math.hypot(p[0], p[1]),
      rotate: (Math.atan2(p[1], p[0]) * 180) / Math.PI,
    };
  }
  function channelsOf(el: Element): Record<string, number> {
    const cs = getComputedStyle(el);
    const t = parseTransform(cs.transform);
    return {
      translateX: t.translateX,
      translateY: t.translateY,
      scale: t.scale,
      rotate: t.rotate,
      opacity: parseFloat(cs.opacity) || 1,
    };
  }
  function epsFor(channel: string): number {
    if (channel === 'opacity') return EPS.opacity;
    if (channel === 'scale') return EPS.scale;
    if (channel === 'rotate') return EPS.rotate;
    return EPS.translate;
  }

  // --- tracked set + sampling loop -----------------------------------------
  const tracked = new Map<Element, Record<string, number>>();
  function track(el: Element): void {
    if (!(el instanceof Element) || tracked.has(el)) return;
    tracked.set(el, channelsOf(el)); // baseline
  }

  function record(el: Element, channel: string, value: number): void {
    store.totalRaw++;
    if (store.samples.length >= MAX_SAMPLES) {
      store.rejected++;
      return;
    }
    const id = idOf(el);
    if (!store.labels[id]) store.labels[id] = labelOf(el);
    store.samples.push({ t: now(), targetId: id, property: channel, value, pass: store.pass });
    if (store.pass === 'scroll') {
      store.scroll.push({
        t: now(), targetId: id, targetLabel: labelOf(el),
        property: channel, scrollY: window.scrollY, value,
      });
    }
  }

  function sample(): void {
    for (const [el, last] of tracked) {
      if (!el.isConnected) continue;
      const cur = channelsOf(el);
      for (const channel of Object.keys(cur)) {
        if (Math.abs(cur[channel] - last[channel]) > epsFor(channel)) {
          record(el, channel, cur[channel]);
          last[channel] = cur[channel];
        }
      }
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);

  // --- discovery: mutation observer on style/class -------------------------
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target instanceof Element) track(m.target);
    }
  });
  const startObserver = (): void =>
    observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  if (document.documentElement) startObserver();
  else addEventListener('DOMContentLoaded', startObserver, { once: true });

  // --- discovery + metadata: CSS transitions / animations ------------------
  addEventListener(
    'transitionrun',
    (e) => {
      const el = e.target as Element;
      if (!(el instanceof Element)) return;
      track(el);
      const cs = getComputedStyle(el);
      store.css.push({
        targetId: idOf(el), targetLabel: labelOf(el),
        property: (e as TransitionEvent).propertyName, startT: now(),
        duration: parseMs(cs.transitionDuration), easing: cs.transitionTimingFunction, kind: 'css-transition',
      });
    },
    true,
  );
  addEventListener(
    'animationstart',
    (e) => {
      const el = e.target as Element;
      if (!(el instanceof Element)) return;
      track(el);
      const cs = getComputedStyle(el);
      store.css.push({
        targetId: idOf(el), targetLabel: labelOf(el),
        property: 'animation:' + (e as AnimationEvent).animationName, startT: now(),
        duration: parseMs(cs.animationDuration), easing: cs.animationTimingFunction, kind: 'css-animation',
      });
    },
    true,
  );

  // --- discovery + metadata: WAAPI Element.animate -------------------------
  const originalAnimate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, keyframes: any, options: any): Animation {
    try {
      track(this);
      const duration = typeof options === 'number' ? options : options?.duration;
      const easing = typeof options === 'object' ? options?.easing : undefined;
      const delay = typeof options === 'object' ? options?.delay : undefined;
      store.waapi.push({
        targetId: idOf(this), targetLabel: labelOf(this),
        property: 'waapi', startT: now(),
        duration: typeof duration === 'number' ? duration : undefined,
        easing: typeof easing === 'string' ? easing : undefined,
        delay: typeof delay === 'number' ? delay : undefined,
      });
    } catch {
      /* never let instrumentation break the page */
    }
    return originalAnimate.call(this, keyframes, options);
  };

  function parseMs(value: string): number {
    // computed durations look like "0.32s" or "320ms", possibly comma-separated.
    const first = (value || '').split(',')[0].trim();
    if (first.endsWith('ms')) return parseFloat(first);
    if (first.endsWith('s')) return parseFloat(first) * 1000;
    return parseFloat(first) || 0;
  }
}
