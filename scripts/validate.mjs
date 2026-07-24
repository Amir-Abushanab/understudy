#!/usr/bin/env node
/**
 * Thin wrapper around the compiled validator so the invocation matches Hue's:
 *
 *   node scripts/validate.mjs <path-to-generated-motion-block>
 *
 * Exit codes match Hue exactly: 1 on any ERROR, 2 on bad arguments / usage, 0
 * otherwise. YAML files are validated as motion blocks; .css files are validated
 * for undefined var(--token) usages.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const distUrl = new URL('../dist/validate.js', import.meta.url);
if (!existsSync(fileURLToPath(distUrl))) {
  console.error('understudy: build output missing. Run `pnpm build` (or `npm run build`) first.');
  process.exit(2);
}

const { validateDesignModel, validateCss, hasErrors, formatReport } = await import(distUrl.href);

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/validate.mjs <path-to-motion-block.yaml | tokens.css>');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`understudy: no such file: ${file}`);
  process.exit(2);
}

const text = readFileSync(file, 'utf8');
const isCss = /\.css$/i.test(file);
const findings = isCss ? validateCss(text) : validateDesignModel(text);

console.log(formatReport(findings, file));
process.exit(hasErrors(findings) ? 1 : 0);
