/**
 * Brand assembler: forced-light and forced-dark computed-style snapshots (plus
 * font assets and page-health signals) -> the measured BrandModel. Pure and
 * browser-free, so it is unit-testable against synthetic snapshots.
 *
 * The site's un-forced default background identifies the primary mode. If the
 * two forced snapshots produce meaningfully different backgrounds the site
 * themes, and both palettes are emitted; otherwise only the primary mode is.
 */

import type { BrandModel, BrandInput, Mode, ColorTokens, Rgb, PageSignals, ContrastCheck, BrandProvenance, Typography } from './types.js';
import { extractColors, luminance, parseColor, classifyStates, isChromatic, colorToken } from './color.js';
import { extractTypography } from './typography.js';
import { auditContrast } from './accessibility.js';
import { spacingScale, radiusScale, shadowSet, gradientSet, containerScale, borderWidthScale } from './scale.js';

export * from './types.js';

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };
const CHALLENGE = /just a moment|attention required|access denied|verify (you|your)|are you a (human|robot)|captcha|enable javascript|checking your browser/i;

export function assembleBrand(input: BrandInput): BrandModel {
  const lightColors = extractColors(input.light, input.extraGradients);
  const darkColors = extractColors(input.dark, input.extraGradients);

  // Primary mode from the site's un-forced background, when it is opaque. Many
  // sites leave body/html transparent (the browser paints white), so fall back
  // to the forced-light snapshot's detected mode rather than reading black.
  const defaultRgb = parseColor(input.defaultBackground);
  const mode: Mode =
    defaultRgb && defaultRgb.a > 0.5 ? (luminance(defaultRgb) < 0.4 ? 'dark' : 'light') : lightColors.mode;

  const primarySnap = mode === 'dark' ? input.dark : input.light;
  const primaryColors = mode === 'dark' ? darkColors : lightColors;

  // Does the site actually theme? Compare the forced backgrounds' luminance.
  const lightLum = luminance(parseColor(lightColors.colors.background) ?? WHITE);
  const darkLum = luminance(parseColor(darkColors.colors.background) ?? BLACK);
  let themed = Math.abs(lightLum - darkLum) > 0.25;

  // colors, plus the ColorResult that produced each mode (so provenance below can
  // read the right source, which is not lightColors/darkColors in the toggle case).
  const colors: Partial<Record<Mode, ColorTokens>> = {};
  const resultFor: Partial<Record<Mode, typeof lightColors>> = {};
  if (themed) {
    colors.light = lightColors.colors; resultFor.light = lightColors;
    colors.dark = darkColors.colors; resultFor.dark = darkColors;
  } else if (input.toggled && input.toggled.length > 0) {
    // The site ignored prefers-color-scheme, but a manual theme toggle was clicked.
    // If it produced an opposite-luminance palette, that toggle IS the second mode.
    const toggledColors = extractColors(input.toggled, input.extraGradients);
    const primaryLum = mode === 'dark' ? darkLum : lightLum;
    const toggledLum = luminance(parseColor(toggledColors.colors.background) ?? WHITE);
    const toggledMode: Mode = toggledLum < 0.4 ? 'dark' : 'light';
    if (toggledMode !== mode && Math.abs(primaryLum - toggledLum) > 0.25) {
      colors[mode] = primaryColors.colors; resultFor[mode] = primaryColors;
      colors[toggledMode] = toggledColors.colors; resultFor[toggledMode] = toggledColors;
      themed = true;
    }
  }
  if (!themed) {
    colors[mode] = primaryColors.colors; resultFor[mode] = primaryColors;
  }

  const challenged = isChallenged(input.signals, input.light.length);

  const typography = extractTypography(primarySnap, input.fontFaces);
  if (input.fontFiles.length > 0) typography.fontFiles = input.fontFiles;
  if (input.measure > 0) typography.measure = input.measure;
  if (input.mobile.length > 20) {
    const responsive = detectResponsive(extractTypography(input.light), extractTypography(input.mobile));
    if (responsive) typography.responsive = responsive;
  }

  const accentHover = dominantChromatic(input.hoverAccents);
  const states = classifyStates(primaryColors.accents, primaryColors.colors.accent);

  const accessibility: Partial<Record<Mode, ContrastCheck[]>> = {};
  const provenance: Record<string, BrandProvenance> = {};
  for (const key of Object.keys(colors) as Mode[]) {
    const tokens = colors[key];
    if (!tokens) continue;
    accessibility[key] = auditContrast(tokens);
    if (resultFor[key]?.borderInferred) provenance[`colors.${key}.border`] = 'inferred';
  }
  if (Object.keys(states).length > 0) provenance.states = 'inferred';

  return {
    mode,
    colors,
    accents: primaryColors.accents,
    states,
    ...(accentHover ? { accentHover } : {}),
    typography,
    spacing: spacingScale(primarySnap),
    radii: radiusScale(primarySnap),
    borderWidths: borderWidthScale(primarySnap),
    containers: containerScale(primarySnap),
    shadows: shadowSet(primarySnap),
    gradients: [...new Set([...gradientSet(primarySnap), ...input.extraGradients])].slice(0, 8),
    ...(input.logo ? { logo: input.logo } : {}),
    accessibility,
    provenance,
    sampled: primarySnap.length,
    challenged,
    confidence: brandConfidence(
      primarySnap.length,
      primaryColors.dominance,
      primaryColors.colors.accent !== primaryColors.colors.text1,
      challenged,
    ),
  };
}

/** Roles whose size changes between desktop and mobile are fluid/responsive. */
function detectResponsive(desktop: Typography, mobile: Typography): Record<string, { min: number; max: number }> | undefined {
  const out: Record<string, { min: number; max: number }> = {};
  for (const roleKey of ['display', 'body'] as const) {
    const d = desktop[roleKey].size;
    const m = mobile[roleKey].size;
    if (Math.abs(d - m) > 1) out[roleKey] = { min: Math.min(d, m), max: Math.max(d, m) };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Most common genuinely chromatic color in a list (hover accent). */
function dominantChromatic(colors: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const raw of colors) {
    const rgb = parseColor(raw);
    if (rgb && isChromatic(rgb)) {
      const key = colorToken(rgb);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : undefined;
}

/** A capture that landed on a bot/challenge or stripped page should not be
 * trusted: too few elements, almost no text, or a known interstitial title. */
function isChallenged(signals: PageSignals, sampleCount: number): boolean {
  if (sampleCount < 60 || signals.textLength < 200) return true;
  return CHALLENGE.test(signals.title);
}

/** Confidence in the extraction: more samples and a coherent, dominant palette
 * with a distinct accent read as more trustworthy; a challenge page reads as
 * near-zero. */
function brandConfidence(sampled: number, dominance: number, distinctAccent: boolean, challenged: boolean): number {
  if (challenged) return 0.05;
  let c = 0.4;
  c += Math.min(0.3, (sampled / 2000) * 0.3);
  c += 0.2 * dominance;
  if (distinctAccent) c += 0.1;
  return Math.round(Math.min(0.95, Math.max(0.1, c)) * 100) / 100;
}
