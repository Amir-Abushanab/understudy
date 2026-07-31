/**
 * Font-source resolution: a measured family maps to its Google Fonts specimen
 * when the catalog confirms it, and to nothing (never a guessed URL) otherwise.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontSource } from './font-sources.js';

test('font-sources: a Google Font resolves to its specimen page', () => {
  assert.equal(fontSource('Inter')?.url, 'https://fonts.google.com/specimen/Inter');
  assert.equal(fontSource('Open Sans')?.url, 'https://fonts.google.com/specimen/Open+Sans');
  assert.equal(fontSource('Inter')?.repo, 'Google Fonts');
});

test('font-sources: matching is case-insensitive and strips quotes', () => {
  assert.equal(fontSource('roboto mono')?.url, 'https://fonts.google.com/specimen/Roboto+Mono');
  assert.equal(fontSource('"Playfair Display"')?.url, 'https://fonts.google.com/specimen/Playfair+Display');
});

test('font-sources: a variable-font name falls back to the base family', () => {
  // Sites commonly ship these; the base is what is on the catalog.
  assert.equal(fontSource('Inter Variable')?.url, 'https://fonts.google.com/specimen/Inter');
  assert.equal(fontSource('Mona Sans VF')?.url, 'https://fonts.google.com/specimen/Mona+Sans');
  // A genuinely distinct family is matched exactly, not stripped to a base.
  assert.equal(fontSource('Inter Tight')?.url, 'https://fonts.google.com/specimen/Inter+Tight');
  // Stripping to a non-catalog base falls through to the Fontsource search.
  assert.equal(fontSource('Acme Custom VF')?.repo, 'Fontsource');
});

test('font-sources: camelCase and style-suffixed names resolve to their Google Fonts base', () => {
  assert.equal(fontSource('SourceCodePro')?.url, 'https://fonts.google.com/specimen/Source+Code+Pro');
  assert.equal(fontSource('GeistSans')?.url, 'https://fonts.google.com/specimen/Geist');
  assert.equal(fontSource('Geist Mono')?.url, 'https://fonts.google.com/specimen/Geist+Mono');
  // A deliberately-spaced non-catalog name is never over-stripped to a catalog word.
  assert.equal(fontSource('Anthropic Sans')?.repo, 'Fontsource');
  // A real catalog name ending in a style word is matched exactly, never stripped.
  assert.equal(fontSource('Open Sans')?.url, 'https://fonts.google.com/specimen/Open+Sans');
  assert.equal(fontSource('DM Sans')?.url, 'https://fonts.google.com/specimen/DM+Sans');
});

test('font-sources: an off-catalog family falls back to a Fontsource search, honestly labeled', () => {
  const r = fontSource('SF Pro Text'); // Apple system font, not on Google Fonts
  assert.equal(r?.repo, 'Fontsource');
  assert.equal(r?.kind, 'search');
  assert.equal(r?.url, 'https://fontsource.org/?query=SF%20Pro%20Text');
  // A Google Fonts hit stays a direct specimen (never downgraded to a search).
  assert.equal(fontSource('Inter')?.kind, 'specimen');
  // An empty family still yields nothing at all.
  assert.equal(fontSource(''), null);
});
