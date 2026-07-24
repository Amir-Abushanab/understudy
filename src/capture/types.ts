/**
 * Shared capture contract.
 *
 * The instrumentation layer (browser side) produces these records; the analysis
 * layer (Node side) consumes them. Because the contract is plain data, every
 * analyzer can be unit-tested against synthetic records with no browser in the
 * loop — which is what makes the "measured, not guessed" claim falsifiable.
 *
 * The central design decision: understudy measures the *result* (how tracked
 * DOM properties change over time), not the *mechanism*. That is why it can see
 * requestAnimationFrame / GSAP / Lenis motion that Chrome's Animations panel
 * cannot: it samples the moving property, then reconstructs timing from the
 * samples. WAAPI (`Element.animate`) and CSS transitions/animations additionally
 * expose declared metadata (duration, easing, delay) which we capture when
 * present, but never depend on.
 */

/** Which scripted interaction pass produced an observation. `load` is the
 * initial page-load / on-enter motion, captured before any interaction. */
export type CapturePassName = 'load' | 'scroll' | 'hover' | 'click';

/** How a motion was observed. `raf` motion is result-sampled only; the others
 * also carry declared metadata from the animation API that scheduled them. */
export type MotionSource = 'waapi' | 'css-transition' | 'css-animation' | 'raf';

/**
 * A single observation of one animated numeric property on one element at one
 * instant. This is the rawest unit the instrument emits. `value` is normalized
 * to a canonical unit per property channel (px for translate/length, unitless
 * for opacity/scale, deg for rotate) so the analyzers never parse CSS.
 */
export interface RawSample {
  /** High-resolution timestamp in ms, relative to capture start. */
  t: number;
  /** Stable identifier for the element across the capture session. */
  targetId: string;
  /** Canonical property channel, e.g. `translateY`, `opacity`, `scale`. */
  property: string;
  /** Numeric value in the channel's canonical unit. */
  value: number;
  /** Pass that was active when the sample was taken. */
  pass: CapturePassName;
}

/** One point on a motion's normalized progress curve. `p` is 0 at the start
 * value and 1 at the end value; it may exceed 1 (or dip below 0) when the
 * motion overshoots, which is exactly the signal `spring.ts` looks for. */
export interface ProgressSample {
  /** ms since the motion's own start (not since capture start). */
  t: number;
  /** Normalized progress in [0, 1], unclamped so overshoot survives. */
  p: number;
}

/**
 * A discrete animation of one property channel on one element, assembled from
 * the raw sample stream (and enriched with declared metadata when the source
 * exposes it). This is the primary unit the analyzers reason over.
 */
export interface MotionEvent {
  /** Unique id for this motion within the capture. */
  id: string;
  /** Element this motion animated. */
  targetId: string;
  /** A short, non-identifying label for the element (tag + role/text hint),
   * used only to name choreography steps. Never a selector into a real site. */
  targetLabel: string;
  /** The property channel that moved. */
  property: string;
  /** Start timestamp in ms, relative to capture start. Drives clustering. */
  startT: number;
  /** End timestamp in ms, relative to capture start. */
  endT: number;
  /** Raw start and end values in canonical units. */
  from: number;
  to: number;
  /** Normalized progress samples over the motion's lifetime, ordered by `t`. */
  samples: ProgressSample[];
  /** How the motion was observed. */
  source: MotionSource;
  /** What appears to have triggered it. */
  trigger: CapturePassName;
  /** Declared duration in ms, when the source exposed it (WAAPI/CSS). */
  declaredDuration?: number;
  /** Declared timing function verbatim, when exposed (e.g. `cubic-bezier(...)`,
   * `ease-out`, `linear(...)`). Advisory only; the fit is authoritative. */
  declaredEasing?: string;
  /** Declared delay in ms, when exposed. */
  declaredDelay?: number;
}

/**
 * An observation used for scroll-coupling analysis: the value of a tracked
 * property at a given scroll offset. Parallax is recovered by regressing
 * `value` against `scrollY`, which a time-based progress curve cannot express.
 */
export interface ScrollSample {
  t: number;
  targetId: string;
  targetLabel: string;
  property: string;
  /** Document scroll offset in px when the sample was taken. */
  scrollY: number;
  /** Property value in canonical units at that scroll offset. */
  value: number;
}

/** Notes about what capture could not do, surfaced into `observed.notes`. */
export interface CaptureLimitation {
  kind: 'login-required' | 'truncated-raf' | 'reduced-motion' | 'off-origin' | 'other';
  detail: string;
}

/**
 * The complete output of a capture session: everything the analysis stage needs
 * and nothing that identifies the site beyond the URL the user supplied.
 */
export interface CaptureResult {
  /** The URL the user asked to capture. */
  source: string;
  /** ISO-8601 capture start time. */
  capturedAt: string;
  /** Passes that actually ran. */
  passes: CapturePassName[];
  /** Assembled discrete motions. */
  events: MotionEvent[];
  /** Scroll-coupled samples for parallax detection. */
  scrollSamples: ScrollSample[];
  /** Count of raw samples that were observed but rejected as noise. */
  rejected: number;
  /** Total raw samples observed (accepted + rejected). */
  totalSamples: number;
  /** Things capture could not see or chose not to do. */
  limitations: CaptureLimitation[];
}

/** Options shared by every capture pass. The concrete passes live in
 * `capture/passes/*` and drive Playwright directly; this contract stays
 * Playwright-free so the analysis side never transitively imports a browser. */
export interface PassOptions {
  /** Settle delay in ms between interaction steps (rate limiting, §7). */
  settleMs: number;
  /** Capture window budget in ms; passes must not exceed it. */
  windowMs: number;
}

/** A full capture: the motion stream plus computed-style snapshots (one per color
 * scheme). Both come from the one browser session so a capture yields the whole
 * brand, light and dark. */
export interface SiteCapture {
  motion: CaptureResult;
  styles: import('../brand/types.js').BrandInput;
}
