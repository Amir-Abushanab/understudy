/**
 * Spring recovery (§6, §5 rule 4): when a motion's progress overshoots its
 * target, a cubic-bezier is the wrong model. Detect the overshoot, then fit a
 * second-order spring (stiffness / damping / mass) to the sampled response.
 *
 * Critically, we only emit a spring when overshoot is *actually* observed. The
 * spec is explicit: do not fabricate a spring to look sophisticated.
 */

import type { ProgressSample } from '../capture/types.js';
import { nelderMead } from './optimize.js';

export interface SpringFit {
  /** k, with mass normalized to 1. */
  stiffness: number;
  /** c (damping coefficient), with mass normalized to 1. */
  damping: number;
  /** Always 1: the observable response fixes only k/m and c/m, so we pin m=1. */
  mass: number;
  /** Undamped natural frequency in rad/s (sqrt(k/m)). */
  naturalFrequency: number;
  /** Damping ratio; < 1 means it overshoots. */
  dampingRatio: number;
  /** Peak overshoot as a fraction above the target (0.23 == 23% past the mark). */
  overshoot: number;
  /** RMS residual of the fit against normalized samples. */
  residual: number;
}

const OVERSHOOT_THRESHOLD = 0.05; // 5% past target before we call it a spring

/**
 * Normalized unit-step response of an underdamped second-order system, starting
 * at 0 and settling at 1, with `t` in seconds. This is exactly the shape a
 * displacement released from rest traces as a spring pulls it home.
 */
export function springStepResponse(omega: number, zeta: number, t: number): number {
  if (t <= 0) return 0;
  const z = Math.min(0.999, Math.max(0.001, zeta));
  const omegaD = omega * Math.sqrt(1 - z * z);
  const decay = Math.exp(-z * omega * t);
  return 1 - decay * (Math.cos(omegaD * t) + ((z * omega) / omegaD) * Math.sin(omegaD * t));
}

/** True if the progress samples pass their target and then settle back near it. */
export function detectsOvershoot(samples: ProgressSample[]): boolean {
  if (samples.length < 4) return false;
  const maxP = Math.max(...samples.map((s) => s.p));
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const tail = sorted.slice(-3);
  const settles = tail.every((s) => Math.abs(s.p - 1) < 0.12);
  return maxP > 1 + OVERSHOOT_THRESHOLD && settles;
}

/**
 * Fit a spring to overshooting samples. Returns null when no overshoot is
 * detected, which is the signal to the emitter that a bezier easing is the
 * right model instead.
 */
export function fitSpring(samples: ProgressSample[]): SpringFit | null {
  if (!detectsOvershoot(samples)) return null;

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const seconds = sorted.map((s) => ({ t: s.t / 1000, p: s.p }));
  const maxP = Math.max(...seconds.map((s) => s.p));
  const overshoot = maxP - 1;

  // Data-driven initial guess so the simplex starts near the basin.
  // zeta from overshoot magnitude: OS = exp(-zeta*pi / sqrt(1 - zeta^2)).
  const lnOS = Math.log(Math.max(overshoot, 1e-3));
  const zeta0 = Math.min(0.95, Math.max(0.05, -lnOS / Math.sqrt(Math.PI * Math.PI + lnOS * lnOS)));
  // omega from the time of first peak: t_peak = pi / omega_d.
  const peak = seconds.reduce((best, s) => (s.p > best.p ? s : best), seconds[0]);
  const tPeak = peak.t > 0 ? peak.t : 0.1;
  const omegaD0 = Math.PI / tPeak;
  const omega0 = omegaD0 / Math.sqrt(1 - zeta0 * zeta0);

  const objective = (params: number[]): number => {
    const [omega, zeta] = params;
    if (omega <= 0 || zeta <= 0 || zeta >= 1) return Number.POSITIVE_INFINITY;
    let sse = 0;
    for (const s of seconds) {
      const err = springStepResponse(omega, zeta, s.t) - s.p;
      sse += err * err;
    }
    return sse;
  };

  const result = nelderMead(objective, [omega0, zeta0], {
    initialStep: 0.2,
    maxIterations: 800,
  });
  const [omega, zeta] = result.x;

  // mass pinned to 1: k = omega^2 * m, c = 2 * zeta * omega * m.
  const mass = 1;
  const stiffness = omega * omega * mass;
  const damping = 2 * zeta * omega * mass;
  const residual = Math.sqrt(result.fx / seconds.length);

  return {
    stiffness: round(stiffness, 1),
    damping: round(damping, 1),
    mass,
    naturalFrequency: round(omega, 3),
    dampingRatio: round(zeta, 3),
    overshoot: round(overshoot, 3),
    residual: round(residual, 4),
  };
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
