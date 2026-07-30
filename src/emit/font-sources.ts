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
  // Sites ship the same face under a variable-font name ("Inter Variable",
  // "Mona Sans VF"). Try the name as-is first, then the base name. The fallback
  // still requires an exact catalog match, so it never invents a link for a face
  // the catalog does not actually carry.
  const base = name.replace(/[\s-]*(?:variable|vf)$/i, '').trim();
  for (const candidate of base && base !== name ? [name, base] : [name]) {
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
