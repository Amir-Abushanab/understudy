/**
 * WCAG contrast audit for the key brand pairs. Reuses the same luminance +
 * compositing math the color role assignment uses, so the ratios reflect how the
 * colors actually render (translucent text over the background, etc.).
 */

import type { ColorTokens, ContrastCheck, Rgb } from './types.js';
import { parseColor, luminance, composite, contrastRatio } from './color.js';

const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0, a: 1 };

export function auditContrast(colors: ColorTokens): ContrastCheck[] {
  const bg = parseColor(colors.background);
  if (!bg) return [];
  const bgLum = luminance(bg);
  const checks: ContrastCheck[] = [];

  const against = (name: string, hex: string): void => {
    const c = parseColor(hex);
    if (!c) return;
    const ratio = contrastRatio(luminance(composite(c, bg)), bgLum);
    checks.push({ pair: `${name}-on-background`, ratio: round(ratio), passes: levels(ratio) });
  };
  against('text1', colors.text1);
  against('text2', colors.text2);
  against('accent', colors.accent);

  // Readable text placed on the accent (accent used as a button fill).
  const accent = parseColor(colors.accent);
  if (accent) {
    const accentLum = luminance(accent);
    const onWhite = contrastRatio(luminance(WHITE), accentLum);
    const onBlack = contrastRatio(luminance(BLACK), accentLum);
    const label = onWhite >= onBlack ? 'white' : 'black';
    const ratio = Math.max(onWhite, onBlack);
    checks.push({ pair: `${label}-text-on-accent`, ratio: round(ratio), passes: levels(ratio) });
  }

  return checks;
}

/** WCAG levels met: AA-large at 3:1, AA at 4.5:1, AAA at 7:1. */
function levels(ratio: number): string[] {
  const out: string[] = [];
  if (ratio >= 3) out.push('AA-large');
  if (ratio >= 4.5) out.push('AA');
  if (ratio >= 7) out.push('AAA');
  return out;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
