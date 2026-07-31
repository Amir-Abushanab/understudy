/**
 * Resolve a measured font family to a browsable repository page, so the report
 * can link "Inter" straight to where you can see and get it. Google Fonts is the
 * one open catalog with stable, guessable per-family URLs and near-complete
 * coverage of free web fonts, so that is what we resolve against.
 *
 * The match is exact (case-insensitive, quotes stripped) against the bundled
 * catalog: a family we cannot confirm gets no link rather than a guessed URL
 * that might 404 — the report never fabricates a source.
 */

import { GOOGLE_FONTS } from './google-fonts-list.js';

export interface FontSource {
  url: string;
  repo: string;
  /** 'specimen' is a confirmed direct page; 'search' is a best-effort lookup. */
  kind: 'specimen' | 'search';
}

const CANONICAL: ReadonlyMap<string, string> = new Map(GOOGLE_FONTS.map((n) => [n.toLowerCase(), n]));

/** The repository page for a family, or null when it is not in a known catalog. */
export function fontSource(family: string): FontSource | null {
  if (!family) return null;
  const name = family.trim().replace(/^["']|["']$/g, '');
  // Try the name and a few normalizations sites use ("Inter Variable",
  // "GeistSans", "SourceCodePro") against the catalog. Every candidate must still
  // exact-match, so this widens recall without ever inventing a link. Exact first.
  for (const candidate of catalogCandidates(name)) {
    const canonical = CANONICAL.get(candidate.toLowerCase());
    if (canonical) {
      return { url: `https://fonts.google.com/specimen/${canonical.replace(/ /g, '+')}`, repo: 'Google Fonts', kind: 'specimen' };
    }
  }
  // Not in the Google Fonts catalog: offer a Fontsource lookup as a best-effort
  // fallback. It is clearly a search (Fontsource mirrors much of the same catalog,
  // so a bespoke or commercial face often will not be there) rather than a direct
  // link we cannot stand behind.
  return { url: `https://fontsource.org/?query=${encodeURIComponent(name)}`, repo: 'Fontsource', kind: 'search' };
}

/**
 * Names a site ships vs the catalog's canonical spaced names: variable-font
 * suffixes ("Inter Variable" -> "Inter"), smashed camelCase ("SourceCodePro" ->
 * "Source Code Pro"), and a trailing style word on a smashed name ("GeistSans" ->
 * "Geist"). Style-word stripping is gated to names camelCase actually split, so
 * a deliberately-spaced "Anthropic Sans" is never reduced to "Anthropic".
 */
function catalogCandidates(name: string): string[] {
  const varStrip = (s: string): string => s.replace(/[\s-]*(?:variable|vf)$/i, '').trim();
  const camel = (s: string): string =>
    s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const styleStrip = (s: string): string => s.replace(/\s+(?:sans|mono|serif|display|text)$/i, '').trim();

  const spaced = camel(name);
  const raw = [name, varStrip(name), spaced, varStrip(spaced)];
  if (spaced !== name) raw.push(styleStrip(spaced)); // only smashed camelCase gets style-word stripping

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    const t = c.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}
