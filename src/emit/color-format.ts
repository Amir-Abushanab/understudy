/**
 * Color value formatting for the report: one measured color, rendered in every
 * standard notation so the reader can switch the whole report between them.
 *
 * OKLCH is the default: it is perceptually uniform (equal numeric steps look
 * like equal visual steps), it is the modern CSS working-group direction, and
 * its lightness/chroma/hue axes map to how designers actually reason about
 * color. hex / rgb / hsl stay a click away for pasting into older tooling.
 *
 * Values that do not parse to sRGB (e.g. `transparent`, `currentColor`, a
 * wide-gamut `color(display-p3 ...)`) are returned verbatim in every slot, so
 * switching format is a harmless no-op rather than a lossy guess.
 */

import { parseColor } from '../brand/color.js';

export type ColorNotation = 'oklch' | 'hex' | 'rgb' | 'hsl';

export type ColorFormats = Record<ColorNotation, string>;

export function colorFormats(value: string): ColorFormats {
  const c = parseColor(value);
  if (!c) return { oklch: value, hex: value, rgb: value, hsl: value };
  const { r, g, b, a } = c;
  return {
    oklch: toOklch(r, g, b, a),
    hex: toHex(r, g, b, a),
    rgb: toRgb(r, g, b, a),
    hsl: toHsl(r, g, b, a),
  };
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Trim an alpha to 2 decimals without trailing zeros: 0.36 -> "0.36", 0.5 -> "0.5". */
const alpha = (a: number): string => String(Number(a.toFixed(2)));

function toHex(r: number, g: number, b: number, a: number): string {
  const h = (n: number): string => clampByte(n).toString(16).padStart(2, '0');
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a < 1 ? `${base}${h(a * 255)}` : base;
}

function toRgb(r: number, g: number, b: number, a: number): string {
  const [R, G, B] = [clampByte(r), clampByte(g), clampByte(b)];
  return a < 1 ? `rgba(${R}, ${G}, ${B}, ${alpha(a)})` : `rgb(${R}, ${G}, ${B})`;
}

function toHsl(r: number, g: number, b: number, a: number): string {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const [H, S, L] = [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  return a < 1 ? `hsla(${H}, ${S}%, ${L}%, ${alpha(a)})` : `hsl(${H}, ${S}%, ${L}%)`;
}

/**
 * sRGB -> OKLCH via Björn Ottosson's OKLab. sRGB is gamma-decoded to linear
 * light, projected into LMS cone response, cube-rooted, and rotated into OKLab;
 * chroma is the a/b magnitude and hue its angle.
 */
function toOklch(r: number, g: number, b: number, a: number): string {
  const lin = (u: number): number => {
    const s = u / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];

  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const Bo = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.hypot(A, Bo);
  let H = (Math.atan2(Bo, A) * 180) / Math.PI;
  if (H < 0) H += 360;

  const Lp = Number((L * 100).toFixed(1));
  const Cp = Number(C.toFixed(3));
  const Hp = C < 0.0005 ? 0 : Number(H.toFixed(1)); // achromatic -> hue is meaningless
  const base = `oklch(${Lp}% ${Cp} ${Hp}`;
  return a < 1 ? `${base} / ${alpha(a)})` : `${base})`;
}
