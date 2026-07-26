/**
 * Typography extraction. Recover the font families (ranked by how much of the
 * page they set), the type size scale, and representative body / display / mono
 * roles, all weighted by rendered area so the dominant copy defines "body" and
 * the largest headings define "display".
 */

import type { StyleSnapshot, Typography, TypographyRole, FontFaceRule } from './types.js';

const MONO_HINT = /mono|consol|menlo|courier|code|ibm plex mono|roboto mono|jetbrains/i;

export function extractTypography(snapshots: StyleSnapshot[], fontFaces: FontFaceRule[] = []): Typography {
  const text = snapshots.filter((s) => s.hasText && s.fontSize > 0 && s.fontFamily);

  // Families ranked by area.
  const famArea = new Map<string, number>();
  for (const s of text) famArea.set(s.fontFamily, (famArea.get(s.fontFamily) ?? 0) + s.area);
  const families = [...famArea.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);

  // Type size scale.
  const scale = sizeScale(text.map((s) => s.fontSize));

  // Body: the dominant style among ordinary copy (roughly 12 to 20px).
  const bodyPool = text.filter((s) => s.fontSize >= 12 && s.fontSize <= 20);
  const body = representativeRole(bodyPool.length > 0 ? bodyPool : text);

  // Display: the largest heading style that actually covers meaningful area.
  const displayThreshold = Math.max(body.size * 1.5, 24);
  const displayPool = text.filter((s) => s.fontSize >= displayThreshold);
  const display = representativeRole(displayPool.length > 0 ? displayPool : text, /* preferLargest */ true);

  // Mono: a monospace family if one is used.
  const monoPool = text.filter((s) => MONO_HINT.test(s.fontFamily));
  const mono = monoPool.length > 0 ? representativeRole(monoPool) : undefined;

  // Label / eyebrow: small text that is uppercased or positively letter-spaced.
  const labelPool = text.filter(
    (s) => s.fontSize <= body.size && (s.textTransform === 'uppercase' || isTracked(s.letterSpacing)),
  );
  const label = labelPool.length >= 2 ? representativeRole(labelPool) : undefined;

  const result: Typography = {
    display,
    body,
    families: families.slice(0, 6),
    scale,
    weights: weightScale(text),
    fontFaces: dedupeFaces(fontFaces),
  };
  const ratio = detectScaleRatio(scale);
  if (ratio) result.scaleRatio = ratio;
  if (mono) result.mono = mono;
  if (label) result.label = label;
  const headings = headingScale(snapshots);
  if (Object.keys(headings).length > 0) result.headings = headings;
  return result;
}

/** Positive (spread-out) letter spacing, the tracking a label style uses. */
function isTracked(letterSpacing: string): boolean {
  if (!letterSpacing || letterSpacing === '0' || letterSpacing === 'normal') return false;
  const n = parseFloat(letterSpacing);
  return Number.isFinite(n) && n > 0;
}

/** Median ratio between adjacent type sizes: the modular scale, approximately. */
function detectScaleRatio(scale: number[]): number | undefined {
  if (scale.length < 3) return undefined;
  const ratios: number[] = [];
  for (let i = 1; i < scale.length; i++) if (scale[i - 1] > 0) ratios.push(scale[i] / scale[i - 1]);
  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  return median > 1 ? Math.round(median * 100) / 100 : undefined;
}

/** Deduplicate @font-face rules by family/weight/style, keeping the real assets. */
function dedupeFaces(faces: FontFaceRule[]): FontFaceRule[] {
  const seen = new Set<string>();
  const out: FontFaceRule[] = [];
  for (const f of faces) {
    if (!f.family) continue;
    const key = `${f.family}|${f.weight}|${f.style}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out.slice(0, 24);
}

/** Distinct font weights in real use, ascending. */
function weightScale(text: StyleSnapshot[]): number[] {
  const counts = new Map<number, number>();
  for (const s of text) counts.set(s.fontWeight, (counts.get(s.fontWeight) ?? 0) + 1);
  const total = text.length || 1;
  return [...counts.entries()]
    .filter(([, c]) => c / total >= 0.01)
    .map(([w]) => w)
    .sort((a, b) => a - b);
}

/** The area-weighted most common style in a pool (optionally biased to the largest size). */
function representativeRole(pool: StyleSnapshot[], preferLargest = false): TypographyRole {
  if (pool.length === 0) {
    return { family: 'sans-serif', size: 16, weight: 400, lineHeight: 24, letterSpacing: '0' };
  }
  // Group by (family, roundedSize, weight); weight by area (and size, if preferLargest).
  const groups = new Map<string, { s: StyleSnapshot; weight: number }>();
  for (const s of pool) {
    const key = `${s.fontFamily}|${Math.round(s.fontSize)}|${s.fontWeight}`;
    const w = s.area * (preferLargest ? s.fontSize : 1);
    const existing = groups.get(key);
    if (existing) existing.weight += w;
    else groups.set(key, { s, weight: w });
  }
  const best = [...groups.values()].sort((a, b) => b.weight - a.weight)[0].s;
  const role: TypographyRole = {
    family: best.fontFamily,
    size: Math.round(best.fontSize),
    weight: best.fontWeight,
    lineHeight: best.lineHeight > 0 ? round(best.lineHeight / best.fontSize, 2) : 0,
    letterSpacing: best.letterSpacing,
  };
  if (best.textTransform && best.textTransform !== 'none') role.transform = best.textTransform;
  if (best.fontStyle && best.fontStyle !== 'normal') role.style = best.fontStyle;
  if (best.fontStretch && best.fontStretch !== 'normal' && best.fontStretch !== '100%') role.stretch = best.fontStretch;
  if (best.fontVariantNumeric && best.fontVariantNumeric !== 'normal') role.numeric = best.fontVariantNumeric;
  if (best.fontFeatureSettings && best.fontFeatureSettings !== 'normal' && best.fontFeatureSettings !== 'none') {
    role.featureSettings = best.fontFeatureSettings;
  }
  if (best.fontVariationSettings && best.fontVariationSettings !== 'normal') role.variationSettings = best.fontVariationSettings;
  if (best.fontOpticalSizing && best.fontOpticalSizing !== 'auto') role.opticalSizing = best.fontOpticalSizing;
  if (best.wordSpacing && best.wordSpacing !== '0' && best.wordSpacing !== 'normal') role.wordSpacing = best.wordSpacing;
  return role;
}

/** The semantic heading scale: the dominant (area-weighted) size/weight per h1..h6. */
function headingScale(snapshots: StyleSnapshot[]): Record<string, { size: number; weight: number }> {
  const out: Record<string, { size: number; weight: number }> = {};
  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const groups = new Map<string, { size: number; weight: number; area: number }>();
    for (const s of snapshots) {
      if (s.tag !== level || s.fontSize <= 0) continue;
      const key = `${Math.round(s.fontSize)}|${s.fontWeight}`;
      const g = groups.get(key) ?? { size: Math.round(s.fontSize), weight: s.fontWeight, area: 0 };
      g.area += s.area;
      groups.set(key, g);
    }
    const best = [...groups.values()].sort((a, b) => b.area - a.area)[0];
    if (best) out[level] = { size: best.size, weight: best.weight };
  }
  return out;
}

/** Cluster font sizes into an ascending, deduped scale (merging within 1px). */
function sizeScale(sizes: number[]): number[] {
  const counts = new Map<number, number>();
  for (const s of sizes) {
    const r = Math.round(s);
    if (r > 0) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const total = sizes.length || 1;
  // Keep sizes used by at least 1% of text, then merge near-equal.
  const kept = [...counts.entries()]
    .filter(([, c]) => c / total >= 0.01)
    .map(([size]) => size)
    .sort((a, b) => a - b);
  const merged: number[] = [];
  for (const size of kept) {
    if (merged.length === 0 || size - merged[merged.length - 1] > 1) merged.push(size);
  }
  return merged;
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
