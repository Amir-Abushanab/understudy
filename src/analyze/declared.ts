/**
 * Parse a declared easing string (from CSS `transition-timing-function` /
 * `animation-timing-function`, or a WAAPI `options.easing`) into control points.
 *
 * When the page declares an easing, that value is authoritative: the browser
 * uses it exactly. So for CSS transitions and WAAPI animations we should prefer
 * the declared curve over a noisy fit, and reserve curve-fitting for the pure
 * requestAnimationFrame case where nothing is declared. The fit then becomes a
 * cross-check rather than the primary source (§6: two channels agreeing is the
 * strongest signal). This is an additive helper beyond the spec's file layout.
 */

import type { BezierControl } from './bezier.js';

export type DeclaredEasing =
  | { kind: 'bezier'; control: BezierControl }
  | { kind: 'steps'; count: number }
  | { kind: 'linear-fn' } // CSS linear() easing; not a cubic-bezier
  | { kind: 'none' };

/** Browsers normalize keyword easings to these control points. */
const KEYWORDS: Record<string, BezierControl> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

const CUBIC_BEZIER =
  /cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/;

export function parseDeclaredEasing(raw: string | undefined): DeclaredEasing {
  if (!raw) return { kind: 'none' };
  const s = raw.trim().toLowerCase();
  if (s === '' || s === 'none') return { kind: 'none' };

  const keyword = KEYWORDS[s];
  if (keyword) return { kind: 'bezier', control: keyword };

  const match = CUBIC_BEZIER.exec(s);
  if (match) {
    return {
      kind: 'bezier',
      control: [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4])],
    };
  }

  if (s.startsWith('steps(')) {
    const count = /steps\(\s*(\d+)/.exec(s);
    return { kind: 'steps', count: count ? parseInt(count[1], 10) : 1 };
  }
  if (s === 'step-start' || s === 'step-end') return { kind: 'steps', count: 1 };
  if (s.startsWith('linear(')) return { kind: 'linear-fn' };

  return { kind: 'none' };
}

/** Whether two durations agree within tolerance (default 25%). */
export function durationsAgree(declared: number, measured: number, tolerance = 0.25): boolean {
  if (declared <= 0 || measured <= 0) return false;
  return Math.abs(declared - measured) / declared <= tolerance;
}
