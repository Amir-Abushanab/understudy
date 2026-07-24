/**
 * Quantization (§6). Raw measurements are messy: 237ms, 241ms, 238ms. The
 * deliverable is a small, opinionated token scale, not the raw spread. We
 * cluster the measured values, snap each cluster to a human-friendly number,
 * and name it by the nearest canonical anchor. The pre-snap values are kept by
 * the caller for `observed`, so nothing is lost, only tidied.
 */

/** Canonical duration anchors (§5). Cluster representatives borrow the nearest name. */
export const DURATION_ANCHORS: Record<string, number> = {
  instant: 80,
  fast: 160,
  base: 240,
  slow: 420,
  deliberate: 700,
};

/** Canonical stagger anchors (§5). */
export const STAGGER_ANCHORS: Record<string, number> = {
  tight: 40,
  base: 80,
  loose: 120,
};

export interface QuantizedScale {
  /** token name -> snapped representative value (ms). */
  scale: Record<string, number>;
  /** Every input value mapped to its token and snapped value, for audit + semantic wiring. */
  assignments: { raw: number; snapped: number; token: string }[];
}

export interface QuantizeOptions {
  /** Snap grid in ms. */
  grid?: number;
  /** Relative gap that starts a new cluster (fraction of the running value). */
  relativeGap?: number;
  /** Absolute gap floor in ms below which values never split, regardless of ratio. */
  minGapMs?: number;
  /** Minimum members a cluster needs to become a token. When set, overrides the
   * support derived from the sample count. A token should represent repeated use,
   * not a single outlier duration. */
  minSupport?: number;
}

const DEFAULTS = {
  grid: 10,
  relativeGap: 0.3,
  minGapMs: 24,
};

/** How many members a cluster needs to count as a real scale level. Scales with
 * the sample count so one slow outlier does not mint a token, but thin captures
 * still yield something. */
function resolveSupport(explicit: number | undefined, total: number): number {
  if (explicit !== undefined) return explicit;
  if (total >= 20) return Math.max(2, Math.ceil(total * 0.04));
  if (total >= 6) return 2;
  return 1;
}

/** Round `value` to the nearest `grid` (default 10ms). Snaps 237/241/238 -> 240. */
export function snap(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}

/** One-dimensional gap clustering over sorted positive values. */
function cluster(values: number[], relativeGap: number, minGapMs: number): number[][] {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return [];
  const clusters: number[][] = [[clean[0]]];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const gap = clean[i] - prev;
    const splits = gap > minGapMs && gap / prev > relativeGap;
    if (splits) clusters.push([clean[i]]);
    else clusters[clusters.length - 1].push(clean[i]);
  }
  return clusters;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Assign each cluster representative to a canonical anchor name, preserving
 * order: a larger value never receives a name that ranks below a smaller one's.
 * We walk the representatives low-to-high and take the nearest anchor at or
 * after the last one used. Representatives past the top anchor fall back to a
 * value-derived name so nothing is dropped or mislabeled.
 */
function nameClusters(reps: number[], anchors: Record<string, number>): string[] {
  const anchorList = Object.entries(anchors).sort((a, b) => a[1] - b[1]);
  const ordered = reps.map((rep, index) => ({ rep, index })).sort((a, b) => a.rep - b.rep);
  const names = new Array<string>(reps.length);

  let lastAnchor = -1;
  for (const { rep, index } of ordered) {
    let bestAnchor = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let a = lastAnchor + 1; a < anchorList.length; a++) {
      const dist = Math.abs(rep - anchorList[a][1]);
      if (dist < bestDist) {
        bestDist = dist;
        bestAnchor = a;
      }
    }
    if (bestAnchor === -1) {
      names[index] = `ms-${rep}`;
    } else {
      names[index] = anchorList[bestAnchor][0];
      lastAnchor = bestAnchor;
    }
  }
  return names;
}

/** Build a named, snapped scale from raw measurements. */
export function quantizeScale(
  values: number[],
  anchors: Record<string, number> = DURATION_ANCHORS,
  options: QuantizeOptions = {},
): QuantizedScale {
  const { grid, relativeGap, minGapMs } = { ...DEFAULTS, ...options };
  const all = cluster(values, relativeGap, minGapMs);
  if (all.length === 0) return { scale: {}, assignments: [] };

  // Drop outlier clusters that lack support, but never drop everything: if the
  // filter would empty the scale, keep the single best-supported cluster.
  const support = resolveSupport(options.minSupport, values.filter((v) => Number.isFinite(v) && v > 0).length);
  let clusters = all.filter((c) => c.length >= support);
  if (clusters.length === 0) clusters = [all.reduce((a, b) => (b.length > a.length ? b : a))];

  const reps = clusters.map((c) => snap(median(c), grid));
  const names = nameClusters(reps, anchors);

  const scale: Record<string, number> = {};
  names.forEach((name, i) => {
    scale[name] = reps[i];
  });

  const assignments: QuantizedScale['assignments'] = [];
  clusters.forEach((c, i) => {
    for (const raw of c) assignments.push({ raw, snapped: reps[i], token: names[i] });
  });

  return { scale, assignments };
}

/** Map a single raw value to the nearest existing token in a built scale. */
export function assignToken(value: number, scale: Record<string, number>): string | null {
  let best: { name: string; dist: number } | null = null;
  for (const [name, snapped] of Object.entries(scale)) {
    const dist = Math.abs(value - snapped);
    if (best === null || dist < best.dist) best = { name, dist };
  }
  return best ? best.name : null;
}
