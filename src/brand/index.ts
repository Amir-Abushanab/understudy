/**
 * Brand assembler: forced-light and forced-dark computed-style snapshots -> the
 * measured BrandModel. Pure and browser-free, so it is unit-testable against
 * synthetic snapshots.
 *
 * The site's un-forced default background identifies the primary mode. If the
 * two forced snapshots produce meaningfully different backgrounds the site
 * themes, and both palettes are emitted; otherwise only the primary mode is.
 */

import type { BrandModel, BrandInput, Mode, ColorTokens, Rgb } from './types.js';
import { extractColors, luminance, parseColor } from './color.js';
import { extractTypography } from './typography.js';
import { spacingScale, radiusScale, shadowSet } from './scale.js';

export * from './types.js';

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };

export function assembleBrand(input: BrandInput): BrandModel {
  const lightColors = extractColors(input.light);
  const darkColors = extractColors(input.dark);

  // Primary mode from the site's un-forced background, when it is opaque. Many
  // sites leave body/html transparent (the browser paints white), so fall back
  // to the forced-light snapshot's detected mode rather than reading black.
  const defaultRgb = parseColor(input.defaultBackground);
  const mode: Mode =
    defaultRgb && defaultRgb.a > 0.5 ? (luminance(defaultRgb) < 0.4 ? 'dark' : 'light') : lightColors.mode;

  // The primary snapshot (matching the site's default) drives the mode-independent
  // dimensions (type, spacing, radii, shadows).
  const primarySnap = mode === 'dark' ? input.dark : input.light;
  const primaryColors = mode === 'dark' ? darkColors : lightColors;

  // Does the site actually theme? Compare the forced backgrounds' luminance.
  const lightLum = luminance(parseColor(lightColors.colors.background) ?? WHITE);
  const darkLum = luminance(parseColor(darkColors.colors.background) ?? BLACK);
  const themed = Math.abs(lightLum - darkLum) > 0.25;

  const colors: Partial<Record<Mode, ColorTokens>> = {};
  if (themed) {
    colors.light = lightColors.colors;
    colors.dark = darkColors.colors;
  } else {
    colors[mode] = primaryColors.colors;
  }

  return {
    mode,
    colors,
    typography: extractTypography(primarySnap),
    spacing: spacingScale(primarySnap),
    radii: radiusScale(primarySnap),
    shadows: shadowSet(primarySnap),
    sampled: primarySnap.length,
    confidence: brandConfidence(primarySnap.length, primaryColors.dominance, primaryColors.colors.accent !== primaryColors.colors.text1),
  };
}

/** Confidence in the extraction: more samples and a coherent, dominant palette
 * with a distinct accent read as more trustworthy. */
function brandConfidence(sampled: number, dominance: number, distinctAccent: boolean): number {
  let c = 0.4;
  c += Math.min(0.3, (sampled / 2000) * 0.3);
  c += 0.2 * dominance;
  if (distinctAccent) c += 0.1;
  return Math.round(Math.min(0.95, Math.max(0.1, c)) * 100) / 100;
}
