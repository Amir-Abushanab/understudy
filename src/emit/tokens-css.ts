/**
 * Emit motion primitives as CSS custom properties, using the flat
 * `--{category}-{scale}` naming convention (§14): `--duration-base`,
 * `--ease-entrance`, `--stagger-tight`. No brand prefix, no nesting, so multiple
 * packs can coexist.
 *
 * Beziers become `cubic-bezier(...)`. A measured spring becomes a sampled
 * `linear()` easing that actually reproduces the overshoot in pure CSS, plus a
 * companion duration for its settling time, so measured springs are usable and
 * not merely declarative.
 */

import type { MotionModel, EasingToken } from '../analyze/model.js';
import { springStepResponse } from '../analyze/spring.js';

/**
 * Flatten primitives to a theme-var map keyed without the leading `--`
 * (the shape the shadcn registry's `cssVars.theme` wants in v0.4). All motion
 * tokens are theme-scoped: durations and easings never change with color mode.
 */
export function toThemeVars(model: MotionModel): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [name, token] of Object.entries(model.primitives.duration)) {
    vars[`duration-${name}`] = `${token.value}ms`;
  }
  for (const [name, token] of Object.entries(model.primitives.stagger)) {
    vars[`stagger-${name}`] = `${token.value}ms`;
  }
  for (const [name, token] of Object.entries(model.primitives.easing)) {
    if (token.kind === 'bezier') {
      const [x1, y1, x2, y2] = token.control;
      vars[`ease-${name}`] = `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
    } else {
      vars[`ease-${name}`] = springToLinear(token);
      vars[`duration-${name}`] = `${springSettleMs(token)}ms`;
    }
  }

  return vars;
}

/** Render the theme vars as a `:root { ... }` block. */
export function emitTokensCss(model: MotionModel): string {
  const vars = toThemeVars(model);
  const lines = Object.entries(vars).map(([k, v]) => `  --${k}: ${v};`);
  return [
    '/* understudy motion tokens. Generated, measured. All theme-scoped: */',
    '/* durations and easings do not change with color mode. */',
    ':root {',
    ...lines,
    '}',
    '',
  ].join('\n');
}

function omega(token: Extract<EasingToken, { kind: 'spring' }>): number {
  return Math.sqrt(token.stiffness / token.mass);
}

function zeta(token: Extract<EasingToken, { kind: 'spring' }>): number {
  return token.damping / (2 * Math.sqrt(token.stiffness * token.mass));
}

/** Settling time in ms (~5 time constants), the natural duration for the spring. */
function springSettleMs(token: Extract<EasingToken, { kind: 'spring' }>): number {
  const zetaOmega = zeta(token) * omega(token);
  const seconds = zetaOmega > 0 ? 5 / zetaOmega : 1;
  return Math.round(Math.min(Math.max(seconds, 0.2), 3) * 1000);
}

/**
 * Sample the spring's normalized step response into a CSS `linear()` easing.
 * The input percentages are uniform in time across the settling window; the
 * output values carry the overshoot, so the CSS animation bounces exactly as
 * measured.
 */
function springToLinear(token: Extract<EasingToken, { kind: 'spring' }>): string {
  const w = omega(token);
  const z = zeta(token);
  const settleS = springSettleMs(token) / 1000;
  const n = 24;
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const frac = i / (n - 1);
    const value = i === n - 1 ? 1 : round(springStepResponse(w, z, frac * settleS), 4);
    const pct = round(frac * 100, 2);
    stops.push(i === 0 ? `${value}` : `${value} ${pct}%`);
  }
  return `linear(${stops.join(', ')})`;
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
