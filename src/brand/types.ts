/**
 * Brand-extraction contract. One computed-style snapshot per element feeds every
 * brand analyzer (color, typography, spacing, radii, shadow). Like the motion
 * contract, this is plain data so the analyzers are unit-testable without a
 * browser.
 *
 * The snapshot carries only style values and geometry, never element text or
 * selectors, so nothing identifying leaves the page (same posture as §7).
 */

/** Computed style of one visible element, plus its area for weighting. */
export interface StyleSnapshot {
  tag: string;
  /** Rendered area in px^2; dominant brand values come from large, frequent elements. */
  area: number;
  /** Computed text color (rgb/rgba string). */
  color: string;
  /** Computed background-color (rgb/rgba string). */
  background: string;
  /** Computed top border color and width (a visible border implies a real edge). */
  borderColor: string;
  borderWidth: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Line height in px, or 0 when `normal`. */
  lineHeight: number;
  /** Letter spacing as authored (e.g. `0`, `-0.02em`). */
  letterSpacing: string;
  radius: number;
  /** box-shadow string, or empty when `none`. */
  shadow: string;
  paddingTop: number;
  paddingLeft: number;
  marginTop: number;
  gap: number;
  /** background-image value, or empty; gradients here carry accent colors. */
  backgroundImage: string;
  /** Element has a direct, non-empty text node. */
  hasText: boolean;
  /** Element is interactive (a/button/input/[role=button]); accent colors live here. */
  interactive: boolean;
}

export type Mode = 'light' | 'dark';

/** A resolved color, kept as hex plus its parsed channels for math. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The semantic color roles for one color mode. */
export interface ColorTokens {
  background: string;
  surface: string;
  text1: string;
  text2: string;
  accent: string;
  border: string;
}

export interface TypographyRole {
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing: string;
}

export interface Typography {
  display: TypographyRole;
  body: TypographyRole;
  mono?: TypographyRole;
  /** Every font family observed, most-used first. */
  families: string[];
  /** The recovered type size scale in px, ascending. */
  scale: number[];
  /** Distinct font weights observed, ascending. */
  weights: number[];
}

/** Snapshots for brand extraction: one per forced color scheme, plus the site's
 * un-forced default background so the primary mode can be identified. */
export interface BrandInput {
  light: StyleSnapshot[];
  dark: StyleSnapshot[];
  defaultBackground: string;
}

/** The measured brand model. `colors` carries one or both modes depending on
 * whether the site actually themes. */
export interface BrandModel {
  /** The site's primary (default) mode. */
  mode: Mode;
  colors: Partial<Record<Mode, ColorTokens>>;
  typography: Typography;
  /** Spacing scale in px, ascending, starting at 0. */
  spacing: number[];
  /** Radius scale in px, ascending. */
  radii: number[];
  /** Distinct box-shadows, most-used first. */
  shadows: string[];
  /** How many elements informed this model. */
  sampled: number;
  /** 0..1 confidence in the extraction (sample size, palette coherence). */
  confidence: number;
}
