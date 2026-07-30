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
}

const CANONICAL: ReadonlyMap<string, string> = new Map(GOOGLE_FONTS.map((n) => [n.toLowerCase(), n]));

/** The repository page for a family, or null when it is not in a known catalog. */
export function fontSource(family: string): FontSource | null {
  if (!family) return null;
  const name = family.trim().replace(/^["']|["']$/g, '');
  const canonical = CANONICAL.get(name.toLowerCase());
  if (!canonical) return null;
  return {
    url: `https://fonts.google.com/specimen/${canonical.replace(/ /g, '+')}`,
    repo: 'Google Fonts',
  };
}
