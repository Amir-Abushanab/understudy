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

test('font-sources: an unknown family gets no link, never a guessed URL', () => {
  assert.equal(fontSource('SF Pro Text'), null); // Apple system font
  assert.equal(fontSource('Helvetica Neue'), null);
  assert.equal(fontSource('Totally Made Up Face 9000'), null);
  assert.equal(fontSource(''), null);
});
