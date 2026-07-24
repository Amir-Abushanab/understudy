/**
 * Color extraction. Resolve the brand palette from computed colors, weighting by
 * rendered area so the dominant surfaces and text win, and assigning semantic
 * roles (background, surface, text1/text2, accent, border). Mode (light/dark) is
 * read from the dominant background's luminance.
 *
 * Colors are emitted as hex when opaque and as rgba(...) when translucent, so
 * faint borders and overlays keep their alpha instead of flattening to black.
 */

import type { StyleSnapshot, ColorTokens, Mode, Rgb, StateRole } from './types.js';

export interface ColorResult {
  mode: Mode;
  colors: ColorTokens;
  /** The broader chromatic brand palette, most-used first (accent is [0]). */
  accents: string[];
  /** Fraction of sampled area covered by the dominant background (palette coherence). */
  dominance: number;
}

/** Browser default link, visited, and active colors; presence signals unstyled
 * links, not a brand accent. */
const DEFAULT_LINK_COLORS = new Set(['#0000ee', '#0000ff', '#551a8b', '#ff0000']);

export function parseColor(value: string): Rgb | null {
  if (!value) return null;
  const v = value.trim();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }

  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => parseFloat(x));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

export function colorToken(c: Rgb): string {
  if (c.a >= 0.99) {
    const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${round(c.a, 3)})`;
}

/** WCAG relative luminance in [0,1]. */
export function luminance(c: Rgb): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** Absolute chroma (0..255): how far the color is from gray. */
export function chroma(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
}

/** HSL lightness in [0,1]. */
export function lightness(c: Rgb): number {
  return (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2 / 255;
}

/** A genuinely colorful accent candidate: real chroma, not too pale or too dark. */
export function isChromatic(c: Rgb): boolean {
  if (c.a < 0.5) return false;
  const l = lightness(c);
  return chroma(c) >= 45 && saturation(c) > 0.2 && l >= 0.12 && l <= 0.82;
}

/** WCAG contrast ratio between two luminances. */
export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a possibly-translucent color over an opaque background, so a
 * hairline like rgba(255,255,255,0.05) is judged by how it actually renders. */
export function composite(fg: Rgb, bg: Rgb): Rgb {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

/** HSL hue in degrees [0,360). */
export function hue(c: Rgb): number {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** sRGB -> CIE L*a*b*, for perceptual color comparison. */
export function rgbToLab(c: Rgb): [number, number, number] {
  const lin = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047;
  const y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
  const z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 color difference; deltaE < ~2.3 is a just-noticeable difference. */
export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Merge near-identical colors (compositing/anti-alias noise) into their heaviest
 * representative, so palettes and role assignment are stable. Input must be
 * weight-descending; the first (heaviest) member of a cluster wins. */
export function mergePalette(ranked: { key: string; weight: number }[], threshold = 5): { key: string; weight: number }[] {
  const clusters: { key: string; weight: number; lab: [number, number, number] }[] = [];
  for (const entry of ranked) {
    const rgb = parseColor(entry.key);
    if (!rgb) continue;
    const lab = rgbToLab(rgb);
    const near = clusters.find((c) => deltaE(c.lab, lab) < threshold);
    if (near) near.weight += entry.weight;
    else clusters.push({ key: entry.key, weight: entry.weight, lab });
  }
  return clusters.sort((a, b) => b.weight - a.weight).map(({ key, weight }) => ({ key, weight }));
}

/** Infer semantic state colors from the palette by hue band, excluding the
 * primary accent (a brand's red accent is not an "error" color). Conservative:
 * only clearly chromatic, clearly-banded colors qualify. */
export function classifyStates(accents: string[], accent: string): Partial<Record<StateRole, string>> {
  const states: Partial<Record<StateRole, string>> = {};
  for (const hex of accents) {
    if (hex === accent) continue;
    const c = parseColor(hex);
    if (!c || saturation(c) < 0.3) continue;
    const h = hue(c);
    if (!states.success && h >= 95 && h <= 165) states.success = hex;
    else if (!states.warning && h >= 35 && h < 70) states.warning = hex;
    else if (!states.error && (h < 18 || h >= 345)) states.error = hex;
    else if (!states.info && h >= 195 && h <= 250) states.info = hex;
  }
  return states;
}

/** HSL saturation in [0,1]. */
export function saturation(c: Rgb): number {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

export function extractColors(snapshots: StyleSnapshot[]): ColorResult {
  // Backgrounds by area (opaque only): the page canvas and its surfaces.
  const bgArea = weightedByKey();
  let totalBgArea = 0;
  for (const s of snapshots) {
    const c = parseColor(s.background);
    if (c && c.a > 0.5) {
      bgArea.add(colorToken(c), s.area);
      totalBgArea += s.area;
    }
  }
  const bgRanked = mergePalette(bgArea.ranked());
  const background = bgRanked[0]?.key ?? '#ffffff';
  const dominance = totalBgArea > 0 ? (bgRanked[0]?.weight ?? 0) / totalBgArea : 0;

  const bgRgb = parseColor(background) ?? { r: 255, g: 255, b: 255, a: 1 };
  const bgLum = luminance(bgRgb);
  const mode: Mode = bgLum < 0.4 ? 'dark' : 'light';

  // Surface: a subtle elevation from the page background, so it must be nearly
  // neutral and close to the background's luminance, not a large saturated section
  // or an opposite-luminance band (a black footer on a white page).
  const surface =
    bgRanked.find((e) => {
      if (e.key === background) return false;
      const c = parseColor(e.key);
      return c !== null && chroma(c) < 60 && Math.abs(luminance(c) - bgLum) <= 0.35;
    })?.key ?? background;

  // Text colors by area, excluding the background color itself.
  const textArea = weightedByKey();
  for (const s of snapshots) {
    if (!s.hasText) continue;
    const c = parseColor(s.color);
    if (c && c.a > 0.3) {
      const key = colorToken(c);
      if (key !== background) textArea.add(key, s.area);
    }
  }
  // Text roles by contrast against the background. text1 is the primary (highest
  // contrast, most readable). text2 is the most-used color that is clearly more
  // muted than text1, so a near-duplicate second shade is not mistaken for a
  // secondary; if none exists, text2 collapses to text1.
  const effLum = (hex: string): number => luminance(composite(parseColor(hex) ?? bgRgb, bgRgb));
  const textCandidates = mergePalette(textArea.ranked())
    .slice(0, 6)
    .map((e) => ({ hex: e.key, area: e.weight, contrast: contrastRatio(effLum(e.key), bgLum) }));
  const primary = [...textCandidates].sort((a, b) => b.contrast - a.contrast)[0];
  const text1 = primary?.hex ?? (mode === 'dark' ? '#ffffff' : '#000000');
  const t1Contrast = primary?.contrast ?? 21;
  const secondary = textCandidates
    .filter((e) => e.hex !== text1 && e.contrast >= 2 && e.contrast <= t1Contrast * 0.85)
    .sort((a, b) => b.area - a.area)[0];
  const text2 = secondary?.hex ?? text1;

  // Accent: the most-used genuinely chromatic color, strongly biased toward
  // interactive elements (buttons, links) where brand color concentrates. Pale
  // tints near white have inflated HSL saturation, so we gate on absolute chroma
  // and a mid lightness band, not saturation alone.
  const accentWeight = weightedByKey();
  for (const s of snapshots) {
    for (const [raw, boost] of [
      [s.color, s.interactive ? 4 : 0],
      [s.background, s.interactive ? 3 : 1],
    ] as const) {
      if (boost === 0) continue;
      const c = parseColor(raw);
      if (!c || !isChromatic(c)) continue;
      const key = colorToken(c);
      // Skip the browser default link/visited colors: unstyled links are not a
      // brand choice, and they otherwise masquerade as the accent.
      if (!DEFAULT_LINK_COLORS.has(key)) accentWeight.add(key, s.area * boost);
    }
    // Gradient backgrounds carry brand accent color for gradient-forward brands,
    // but cap the area so one giant hero cannot swamp solid button/link accents.
    for (const c of gradientColors(s.backgroundImage)) {
      const key = colorToken(c);
      if (isChromatic(c) && !DEFAULT_LINK_COLORS.has(key)) accentWeight.add(key, Math.min(s.area, 3000) * 1.2);
    }
  }
  const accentRanked = mergePalette(accentWeight.ranked());
  const accent = accentRanked[0]?.key ?? text1;
  const accents = accentRanked.slice(0, 6).map((e) => e.key);

  // Border: a divider is a low-contrast line against the background. Filtering by
  // composited contrast excludes high-contrast component edges (which are not the
  // neutral divider) and keeps translucent hairlines; weighting by area favors
  // structural dividers over tiny repeated ones. Computed per mode, so light and
  // dark get their own border.
  const borderWeight = weightedByKey();
  for (const s of snapshots) {
    if (s.borderWidth <= 0) continue;
    const c = parseColor(s.borderColor);
    if (!c || c.a < 0.03) continue;
    const contrast = contrastRatio(luminance(composite(c, bgRgb)), bgLum);
    if (contrast >= 1.05 && contrast <= 3) borderWeight.add(colorToken(c), s.area || 1);
  }
  const border =
    mergePalette(borderWeight.ranked())[0]?.key ?? (surface !== background ? surface : subtleDivider(text1));

  return { mode, colors: { background, surface, text1, text2, accent, border }, accents, dominance: round(dominance, 3) };
}

// --------------------------------------------------------------------------

interface Weighted {
  add(key: string, weight: number): void;
  ranked(): { key: string; weight: number }[];
}

/** A faint divider derived from the primary text, for pages with no real borders
 * and no distinct surface (so the fallback is a visible hairline, not the bg). */
function subtleDivider(text1: string): string {
  const c = parseColor(text1);
  return c ? `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, 0.12)` : text1;
}

/** Extract every color stop from a gradient background-image string. */
function gradientColors(backgroundImage: string): Rgb[] {
  if (!backgroundImage) return [];
  const out: Rgb[] = [];
  for (const m of backgroundImage.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
    const c = parseColor(m[0]);
    if (c) out.push(c);
  }
  return out;
}

function weightedByKey(): Weighted {
  const map = new Map<string, number>();
  return {
    add(key, weight) {
      map.set(key, (map.get(key) ?? 0) + weight);
    },
    ranked() {
      return [...map.entries()].map(([key, weight]) => ({ key, weight })).sort((a, b) => b.weight - a.weight);
    },
  };
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
