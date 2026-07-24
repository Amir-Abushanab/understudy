/**
 * A small, dependency-free Nelder-Mead simplex optimizer.
 *
 * The spec (§3) permits `fmin` or a hand-rolled Nelder-Mead and prizes a short
 * dependency list, so we hand-roll it. Both the cubic-bezier fitter and the
 * spring fitter minimize squared error against sampled progress, so they share
 * this one optimizer.
 *
 * This is an additive internal helper, not one of the modules named in the
 * spec's file layout (§4); it exists only to avoid duplicating the simplex in
 * `bezier.ts` and `spring.ts`.
 */

export interface NelderMeadOptions {
  maxIterations?: number;
  /** Convergence tolerance on the objective value. */
  tolFun?: number;
  /** Convergence tolerance on the simplex spread. */
  tolX?: number;
  /** Initial simplex edge length per dimension. */
  initialStep?: number;
}

export interface NelderMeadResult {
  x: number[];
  fx: number;
  iterations: number;
  converged: boolean;
}

/**
 * Minimize `f` starting from `x0`. Objective may return Infinity/NaN for
 * infeasible points; the simplex will move away from them.
 */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  options: NelderMeadOptions = {},
): NelderMeadResult {
  const maxIterations = options.maxIterations ?? 400;
  const tolFun = options.tolFun ?? 1e-10;
  const tolX = options.tolX ?? 1e-8;
  const step = options.initialStep ?? 0.1;

  const n = x0.length;
  const alpha = 1; // reflection
  const gamma = 2; // expansion
  const rho = 0.5; // contraction
  const sigma = 0.5; // shrink

  const safe = (x: number[]): number => {
    const v = f(x);
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };

  // Build the initial simplex: x0 plus a perturbation along each axis.
  const simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const point = x0.slice();
    const delta = point[i] !== 0 ? step * Math.abs(point[i]) : step;
    point[i] = point[i] + delta;
    simplex.push(point);
  }

  let values = simplex.map(safe);
  let iterations = 0;
  let converged = false;

  const order = (): void => {
    const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const sortedSimplex = idx.map((i) => simplex[i]);
    const sortedValues = idx.map((i) => values[i]);
    for (let i = 0; i < simplex.length; i++) {
      simplex[i] = sortedSimplex[i];
      values[i] = sortedValues[i];
    }
  };

  for (; iterations < maxIterations; iterations++) {
    order();

    // Convergence: both the value spread and the geometric spread are tiny.
    const fSpread = Math.abs(values[values.length - 1] - values[0]);
    let xSpread = 0;
    for (let i = 1; i < simplex.length; i++) {
      for (let j = 0; j < n; j++) {
        xSpread = Math.max(xSpread, Math.abs(simplex[i][j] - simplex[0][j]));
      }
    }
    if (fSpread < tolFun && xSpread < tolX) {
      converged = true;
      break;
    }

    // Centroid of all points except the worst.
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < simplex.length - 1; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    }

    const worst = simplex.length - 1;
    const reflected = centroid.map((c, j) => c + alpha * (c - simplex[worst][j]));
    const fr = safe(reflected);

    if (fr < values[0]) {
      // Better than the best: try to expand further.
      const expanded = centroid.map((c, j) => c + gamma * (reflected[j] - c));
      const fe = safe(expanded);
      if (fe < fr) {
        simplex[worst] = expanded;
        values[worst] = fe;
      } else {
        simplex[worst] = reflected;
        values[worst] = fr;
      }
    } else if (fr < values[worst - 1]) {
      // Middling: accept the reflection.
      simplex[worst] = reflected;
      values[worst] = fr;
    } else {
      // Worse: contract toward the centroid.
      const contracted = centroid.map((c, j) => c + rho * (simplex[worst][j] - c));
      const fc = safe(contracted);
      if (fc < values[worst]) {
        simplex[worst] = contracted;
        values[worst] = fc;
      } else {
        // Shrink the whole simplex toward the best point.
        for (let i = 1; i < simplex.length; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + sigma * (v - simplex[0][j]));
          values[i] = safe(simplex[i]);
        }
      }
    }
  }

  order();
  return { x: simplex[0], fx: values[0], iterations, converged };
}
