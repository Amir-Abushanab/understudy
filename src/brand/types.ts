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
  /** Rendered width in px, and computed max-width (0 when `none`); for container tokens. */
  width: number;
  maxWidth: number;
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
  /** The modular-scale ratio between adjacent sizes, when the scale is regular. */
  scaleRatio?: number;
  /** Roles whose size changed across viewports (fluid/responsive), min..max px. */
  responsive?: Record<string, { min: number; max: number }>;
  /** The actual @font-face assets (family, src URL, weight, style) from
   * readable (same-origin) stylesheets. */
  fontFaces: FontFaceRule[];
  /** Font file URLs the page actually loaded (works cross-origin, unlike CSSOM). */
  fontFiles?: string[];
}

/** An @font-face rule read from the page stylesheets: the actual brand font asset. */
export interface FontFaceRule {
  family: string;
  weight: string;
  style: string;
  /** First source URL, absolute, or empty. */
  src: string;
}

/** Cheap page-health signals used to detect bot/challenge or stripped pages. */
export interface PageSignals {
  elementCount: number;
  title: string;
  textLength: number;
}

/** Snapshots for brand extraction: one per forced color scheme, plus the site's
 * un-forced default background, the @font-face assets, and health signals. */
export interface BrandInput {
  light: StyleSnapshot[];
  dark: StyleSnapshot[];
  /** Light-scheme snapshot at a mobile viewport, for fluid/responsive type. */
  mobile: StyleSnapshot[];
  defaultBackground: string;
  fontFaces: FontFaceRule[];
  fontFiles: string[];
  /** Chromatic colors observed when hovering interactive elements. */
  hoverAccents: string[];
  signals: PageSignals;
}

export type StateRole = 'success' | 'warning' | 'error' | 'info';

/** The measured brand model. `colors` carries one or both modes depending on
 * whether the site actually themes. */
export interface BrandModel {
  /** The site's primary (default) mode. */
  mode: Mode;
  colors: Partial<Record<Mode, ColorTokens>>;
  /** The broader chromatic brand palette (top distinct accent-worthy colors). */
  accents: string[];
  /** Inferred semantic state colors, where present in the palette. */
  states: Partial<Record<StateRole, string>>;
  /** Hover accent variant, when a hover shift was observed. */
  accentHover?: string;
  typography: Typography;
  /** Spacing scale in px, ascending, starting at 0. */
  spacing: number[];
  /** Radius scale in px, ascending. */
  radii: number[];
  /** Distinct border widths in px, ascending. */
  borderWidths: number[];
  /** Content container max-widths in px, ascending. */
  containers: number[];
  /** Distinct box-shadows, most-used first. */
  shadows: string[];
  /** Signature gradient background-images, most-used first. */
  gradients: string[];
  /** How many elements informed this model. */
  sampled: number;
  /** True when the captured page looked like a bot/challenge or stripped page. */
  challenged: boolean;
  /** 0..1 confidence in the extraction (sample size, palette coherence). */
  confidence: number;
}
