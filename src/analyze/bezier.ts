/**
 * Easing recovery (§6): sample a motion's progress over its lifetime, then fit a
 * cubic-bezier by minimizing squared error against the samples, and report the
 * fit residual so downstream confidence can reflect how good the fit was.
 *
 * This is the reason understudy can characterize rAF/GSAP easings that DevTools
 * cannot: it fits the observed curve rather than reading a declared one.
 */

import type { ProgressSample } from '../capture/types.js';
import { nelderMead } from './optimize.js';

/** A cubic-bezier easing's two control points: [x1, y1, x2, y2]. P0=(0,0), P3=(1,1). */
export type BezierControl = [number, number, number, number];

export interface BezierFit {
  control: BezierControl;
  /** Root-mean-square error of the fit against normalized samples, in progress units. */
  residual: number;
  /** Number of samples the fit used. */
  sampleCount: number;
}

/**
 * Evaluate a cubic-bezier easing at time fraction `t` in [0, 1]. Inverts X(s)=t
 * with Newton plus a bisection fallback, then reads Y(s). Matches the WebKit
 * UnitBezier reference implementation and the one used in the fixtures.
 */
export function evalCubicBezier(control: BezierControl, t: number): number {
  const [x1, y1, x2, y2] = control;
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
  const sampleDX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;

  let s = t;
  for (let i = 0; i < 8; i++) {
    const d = sampleX(s) - t;
    if (Math.abs(d) < 1e-6) return sampleY(s);
    const dx = sampleDX(s);
    if (Math.abs(dx) < 1e-6) break;
    s -= d / dx;
  }
  let lo = 0;
  let hi = 1;
  s = t;
  for (let i = 0; i < 32; i++) {
    const xs = sampleX(s);
    if (Math.abs(xs - t) < 1e-6) break;
    if (t > xs) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return sampleY(s);
}

/** Normalize raw progress samples to fit-ready (x in [0,1] time fraction, y = progress). */
function normalize(samples: ProgressSample[]): { x: number; y: number }[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const tMax = sorted.length > 0 ? sorted[sorted.length - 1].t : 0;
  if (tMax <= 0) return [];
  // Drop the trivial endpoints where every easing agrees; they carry no shape info.
  return sorted
    .map((sample) => ({ x: sample.t / tMax, y: sample.p }))
    .filter((point) => point.x > 0 && point.x < 1);
}

/**
 * Fit a cubic-bezier easing to sampled progress. Tries several starting curves
 * (linear, ease-in-out, ease-out, ease-in) and keeps the best simplex result,
 * because the error surface has shallow local minima.
 */
export function fitCubicBezier(samples: ProgressSample[]): BezierFit {
  const points = normalize(samples);
  if (points.length < 4) {
    // Not enough shape to trust; report linear with a deliberately poor residual.
    return { control: [0.25, 0.25, 0.75, 0.75], residual: 1, sampleCount: points.length };
  }

  const objective = (c: number[]): number => {
    const [x1, y1, x2, y2] = c;
    // X control points must stay in [0,1] for the easing to be a function of time.
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return Number.POSITIVE_INFINITY;
    let sse = 0;
    for (const point of points) {
      const err = evalCubicBezier(c as BezierControl, point.x) - point.y;
      sse += err * err;
    }
    // Keep the fit in easing-space. Real easings overshoot at most modestly; a y
    // control point of 6 is a numerical artifact of noisy samples, not a curve
    // anyone authored. Softly penalize y outside a generous band.
    return sse + penaltyOutside(y1) + penaltyOutside(y2);
  };

  const starts: BezierControl[] = [
    [0.25, 0.25, 0.75, 0.75], // linear-ish
    [0.42, 0, 0.58, 1], // ease-in-out
    [0, 0, 0.58, 1], // ease-out
    [0.42, 0, 1, 1], // ease-in
    [0.33, 1, 0.68, 1], // ease-out-cubic
  ];

  let best = { x: starts[0] as number[], fx: Number.POSITIVE_INFINITY };
  for (const start of starts) {
    const result = nelderMead(objective, start, { initialStep: 0.08, maxIterations: 500 });
    if (result.fx < best.fx) best = { x: result.x, fx: result.fx };
  }

  const control: BezierControl = [
    clamp01(best.x[0]),
    best.x[1],
    clamp01(best.x[2]),
    best.x[3],
  ];
  const residual = Math.sqrt(best.fx / points.length);
  return { control, residual, sampleCount: points.length };
}

/** RMS residual of a known easing curve against sampled progress. Used to score
 * a declared curve (from CSS/WAAPI) against what was actually measured. */
export function bezierResidual(control: BezierControl, samples: ProgressSample[]): number {
  const points = normalize(samples);
  if (points.length === 0) return 1;
  let sse = 0;
  for (const point of points) {
    const err = evalCubicBezier(control, point.x) - point.y;
    sse += err * err;
  }
  return Math.sqrt(sse / points.length);
}

/** Euclidean distance between two easing curves' control points. */
export function controlDistance(a: BezierControl, b: BezierControl): number {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

const Y_LOW = -0.75;
const Y_HIGH = 1.75;
const Y_PENALTY_WEIGHT = 8;

function penaltyOutside(y: number): number {
  if (y < Y_LOW) return Y_PENALTY_WEIGHT * (Y_LOW - y) ** 2;
  if (y > Y_HIGH) return Y_PENALTY_WEIGHT * (y - Y_HIGH) ** 2;
  return 0;
}

/** A cubic-bezier that reads as a real easing: X in [0,1], Y within a band that
 * allows modest anticipation and overshoot but rejects numerical blowups. */
export function isSaneEasing(control: BezierControl): boolean {
  const [x1, y1, x2, y2] = control;
  return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1 && y1 >= -1 && y1 <= 2 && y2 >= -1 && y2 <= 2;
}

/** Round bezier control points for stable, readable emission. */
export function roundControl(control: BezierControl, places = 2): BezierControl {
  const factor = 10 ** places;
  return control.map((v) => Math.round(v * factor) / factor) as unknown as BezierControl;
}
