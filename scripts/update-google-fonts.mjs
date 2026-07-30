#!/usr/bin/env node
/**
 * Regenerates src/emit/google-fonts-list.ts from Google Fonts' keyless metadata
 * endpoint, so the report can link any measured family to its specimen page
 * without a network call at render time.
 *
 *   node scripts/update-google-fonts.mjs
 */
import { writeFileSync } from 'node:fs';

const ENDPOINT = 'https://fonts.google.com/metadata/fonts';

const res = await fetch(ENDPOINT);
if (!res.ok) throw new Error(`metadata fetch failed: ${res.status}`);
const text = (await res.text()).replace(/^\)\]\}'/, ''); // strip the anti-JSON-hijack prefix
const list = JSON.parse(text).familyMetadataList;
const names = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b));

const out = `/**
 * Google Fonts family catalog (names only) — GENERATED, do not edit by hand.
 * Lets the report link a measured family to its specimen with no network call.
 * Regenerate: node scripts/update-google-fonts.mjs
 * Source: ${ENDPOINT} (keyless). Snapshot: ${names.length} families.
 */

export const GOOGLE_FONTS: readonly string[] = ${JSON.stringify(names)};
`;

writeFileSync(new URL('../src/emit/google-fonts-list.ts', import.meta.url), out);
console.log(`wrote src/emit/google-fonts-list.ts with ${names.length} families`);
