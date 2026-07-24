/**
 * Spacing, radius, and shadow scales. Sites reuse a small set of spacing and
 * radius values; we recover those by frequency, merge near-duplicates, and
 * return an ascending scale. Shadows are kept verbatim, ranked by use.
 */

import type { StyleSnapshot } from './types.js';

export function spacingScale(snapshots: StyleSnapshot[]): number[] {
  const values: number[] = [];
  for (const s of snapshots) values.push(s.paddingTop, s.paddingLeft, s.marginTop, s.gap);
  const raw = commonValues(values, { mergeWithin: 2, minShare: 0.004, cap: 16 });
  const snapped = snapAndDedupe(raw, detectBase(raw), 9);
  return [0, ...snapped].slice(0, 10);
}

export function radiusScale(snapshots: StyleSnapshot[]): number[] {
  const raw = commonValues(snapshots.map((s) => s.radius), { mergeWithin: 1, minShare: 0.004, cap: 10 });
  const snapped = snapAndDedupe(raw, 2, 6);
  return [0, ...snapped].slice(0, 7);
}

/** Pick a 4px or 8px base grid, whichever most of the observed values align to. */
function detectBase(values: number[]): number {
  const eligible = values.filter((v) => v >= 8);
  if (eligible.length === 0) return 4;
  const near8 = eligible.filter((v) => Math.abs(v - Math.round(v / 8) * 8) <= 1).length;
  return near8 / eligible.length >= 0.6 ? 8 : 4;
}

/** Snap each value to the nearest base multiple, drop zeros/dupes, sort, cap. */
function snapAndDedupe(values: number[], base: number, cap: number): number[] {
  const snapped = values.map((v) => Math.round(v / base) * base).filter((v) => v > 0);
  return [...new Set(snapped)].sort((a, b) => a - b).slice(0, cap);
}

export function shadowSet(snapshots: StyleSnapshot[]): string[] {
  const counts = new Map<string, number>();
  for (const s of snapshots) {
    if (s.shadow) counts.set(s.shadow, (counts.get(s.shadow) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([shadow]) => shadow);
}

/** Signature gradient background-images, most-used first. */
export function gradientSet(snapshots: StyleSnapshot[]): string[] {
  const counts = new Map<string, number>();
  for (const s of snapshots) {
    if (s.backgroundImage) counts.set(s.backgroundImage.trim(), (counts.get(s.backgroundImage.trim()) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g);
}

/** Content container max-widths in px, ascending: the site's layout measures. */
export function containerScale(snapshots: StyleSnapshot[]): number[] {
  const widths = snapshots.filter((s) => s.maxWidth >= 320 && s.maxWidth <= 1920).map((s) => s.maxWidth);
  return commonValues(widths, { mergeWithin: 8, minShare: 0.005, cap: 6 });
}

/** Distinct border widths in px, ascending (e.g. [1, 2]). */
export function borderWidthScale(snapshots: StyleSnapshot[]): number[] {
  return commonValues(snapshots.map((s) => s.borderWidth), { mergeWithin: 0, minShare: 0.01, cap: 4 });
}

interface CommonOptions {
  mergeWithin: number;
  minShare: number;
  cap: number;
}

function commonValues(values: number[], { mergeWithin, minShare, cap }: CommonOptions): number[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (const v of values) {
    const r = Math.round(v);
    if (r > 0) {
      counts.set(r, (counts.get(r) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return [];
  const kept = [...counts.entries()]
    .filter(([, c]) => c / total >= minShare)
    .map(([v]) => v)
    .sort((a, b) => a - b);
  const merged: number[] = [];
  for (const v of kept) {
    if (merged.length === 0 || v - merged[merged.length - 1] > mergeWithin) merged.push(v);
  }
  return merged.slice(0, cap);
}
