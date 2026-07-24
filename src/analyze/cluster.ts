/**
 * Stagger recovery (§6). The web has no native concept of a grouped animation;
 * choreography is emergent from many independently-scheduled motions. So we
 * cluster animation start timestamps, and within a cluster ask whether the
 * inter-arrival deltas are consistent. Low variance means an intentional
 * stagger and we emit the interval; high variance means the motions are
 * coincidental and we stay silent.
 *
 * Two guards keep this honest:
 *   - a floor (~16ms): sub-frame deltas are boundary noise, not intent, so
 *     near-simultaneous starts collapse into a single beat;
 *   - a variance gate: a rhythm has to actually be a rhythm to be reported.
 */

import type { MotionEvent } from '../capture/types.js';

export interface StaggerCluster {
  /** Start timestamp of the first member, ms since capture start. */
  startT: number;
  /** Number of member motions. */
  size: number;
  /** Number of distinct beats after collapsing near-simultaneous starts. */
  beats: number;
  /** Recovered stagger interval in ms (mean inter-beat delta). */
  intervalMs: number;
  /** Coefficient of variation of the deltas; the variance-gate statistic. */
  cv: number;
  /** Raw inter-beat deltas, retained for auditability. */
  deltas: number[];
  /** Member motion ids, in start order. */
  memberIds: string[];
  /** Ordered beat times (ms), for choreography reconstruction. */
  beatTimes: number[];
  /** Passed the floor and the variance gate: safe to emit as a stagger. */
  confident: boolean;
}

export interface ClusterOptions {
  /** Sub-frame floor; deltas below this collapse into one beat. */
  floorMs?: number;
  /** A gap larger than this ends the group; it is not a stagger step. */
  maxGroupGapMs?: number;
  /** Max coefficient of variation for a group to count as a real rhythm. */
  cvThreshold?: number;
}

const DEFAULTS: Required<ClusterOptions> = {
  floorMs: 16,
  maxGroupGapMs: 600,
  cvThreshold: 0.35,
};

/**
 * Cluster motions by start time and recover per-cluster stagger intervals.
 * Only clusters with `confident: true` should be emitted as stagger tokens; the
 * rest are returned for auditing but represent coincidental timing.
 */
export function recoverStagger(events: MotionEvent[], options: ClusterOptions = {}): StaggerCluster[] {
  const { floorMs, maxGroupGapMs, cvThreshold } = { ...DEFAULTS, ...options };
  if (events.length < 2) return [];

  const sorted = [...events].sort((a, b) => a.startT - b.startT);

  // Partition into groups: a gap larger than maxGroupGap starts a new group.
  const groups: MotionEvent[][] = [];
  let current: MotionEvent[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startT - sorted[i - 1].startT;
    if (gap > maxGroupGapMs) {
      groups.push(current);
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  groups.push(current);

  const clusters: StaggerCluster[] = [];
  for (const group of groups) {
    if (group.length < 2) continue;

    // Collapse near-simultaneous starts (delta < floor) into single beats.
    const beatTimes: number[] = [];
    const beatMembers: string[] = [];
    let beatAccum: number[] = [group[0].startT];
    for (let i = 1; i < group.length; i++) {
      const t = group[i].startT;
      const beatMean = beatAccum.reduce((a, b) => a + b, 0) / beatAccum.length;
      if (t - beatMean < floorMs) {
        beatAccum.push(t);
      } else {
        beatTimes.push(beatAccum.reduce((a, b) => a + b, 0) / beatAccum.length);
        beatAccum = [t];
      }
    }
    beatTimes.push(beatAccum.reduce((a, b) => a + b, 0) / beatAccum.length);

    const deltas: number[] = [];
    for (let i = 1; i < beatTimes.length; i++) deltas.push(beatTimes[i] - beatTimes[i - 1]);

    if (deltas.length === 0) continue; // all one beat: parallel, not staggered

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : Number.POSITIVE_INFINITY;

    clusters.push({
      startT: group[0].startT,
      size: group.length,
      beats: beatTimes.length,
      intervalMs: round(mean, 1),
      cv: round(cv, 3),
      deltas: deltas.map((d) => round(d, 1)),
      memberIds: group.map((e) => e.id),
      beatTimes: beatTimes.map((t) => round(t, 1)),
      // Need at least two deltas to call it a rhythm, low variance, above the floor.
      confident: deltas.length >= 2 && cv < cvThreshold && mean >= floorMs,
    });
  }

  return clusters;
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
