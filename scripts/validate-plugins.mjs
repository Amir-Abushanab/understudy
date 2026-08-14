#!/usr/bin/env node
/**
 * Structural validation of the agent plugin manifests, dependency-free so it runs
 * in CI without installing any agent CLI (and never makes a model call). Checks
 * what would actually break install or a directory listing:
 *
 *   - each manifest is valid JSON with its required fields,
 *   - a plugin's local `source` resolves to a real plugin.json, and
 *   - the marketplace's plugin name matches that plugin.json's name, so
 *     `name@marketplace` resolves.
 *
 * Exit codes match the repo convention: 1 on any ERROR, 0 otherwise.
 * This complements `claude plugin validate` (authoritative, but needs the CLI);
 * keep them in sync when the manifest shape changes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const rel = (p) => fileURLToPath(new URL(p, root));

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

/** Parse a manifest, or record an error and return null. */
function load(path) {
  const abs = rel(path);
  if (!existsSync(abs)) {
    err(path, 'file is missing');
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    err(path, `invalid JSON: ${e.message}`);
    return null;
  }
}

const str = (v) => typeof v === 'string' && v.trim().length > 0;

// --- Claude Code plugin manifest --------------------------------------------
const pluginPath = '.claude-plugin/plugin.json';
const plugin = load(pluginPath);
if (plugin) {
  if (!str(plugin.name)) err(pluginPath, 'required field `name` is missing or empty');
  // These are what a directory/store listing renders; treat as errors since we ship them.
  if (!str(plugin.description)) err(pluginPath, 'required field `description` is missing or empty');
  if (!str(plugin.version)) err(pluginPath, 'required field `version` is missing or empty');
  if (!plugin.author) warn(pluginPath, 'no `author` (recommended for attribution in a listing)');
  if (!str(plugin.license)) warn(pluginPath, 'no `license`');
}

// --- Claude Code marketplace manifest ---------------------------------------
const marketPath = '.claude-plugin/marketplace.json';
const market = load(marketPath);
if (market) {
  if (!str(market.name)) err(marketPath, 'required field `name` is missing or empty');
  if (!market.owner || !str(market.owner.name)) err(marketPath, 'required `owner.name` is missing or empty');
  if (!Array.isArray(market.plugins) || market.plugins.length === 0) {
    err(marketPath, 'required `plugins` must be a non-empty array');
  } else {
    market.plugins.forEach((p, i) => {
      const at = `${marketPath} plugins[${i}]`;
      if (!str(p.name)) err(at, 'plugin `name` is missing or empty');
      if (p.source === undefined) err(at, 'plugin `source` is missing');
      // A local string source (e.g. "./") must resolve to a real plugin.json,
      // whose name must match this entry so `name@marketplace` resolves.
      if (str(p.source)) {
        const target = `${p.source.replace(/\/+$/, '')}/.claude-plugin/plugin.json`.replace(/^\.\//, '');
        if (!existsSync(rel(target))) {
          err(at, `source "${p.source}" does not resolve to ${target}`);
        } else if (plugin && str(p.name) && p.name !== plugin.name) {
          err(at, `name "${p.name}" != the target plugin.json name "${plugin.name}" (install would not resolve)`);
        }
      }
    });
  }
}

// --- Codex marketplace manifest ---------------------------------------------
const codexPath = '.agents/plugins/marketplace.json';
const codex = load(codexPath);
if (codex) {
  if (!str(codex.name)) err(codexPath, 'required field `name` is missing or empty');
  if (!Array.isArray(codex.plugins) || codex.plugins.length === 0) {
    err(codexPath, 'required `plugins` must be a non-empty array');
  } else {
    codex.plugins.forEach((p, i) => {
      const at = `${codexPath} plugins[${i}]`;
      if (!str(p.name)) err(at, 'plugin `name` is missing or empty');
      const path = p.source?.path;
      if (!str(path)) err(at, 'plugin `source.path` is missing or empty');
      else if (!existsSync(rel(path))) err(at, `source.path "${path}" does not exist`);
    });
  }
}

// --- report -----------------------------------------------------------------
for (const w of warnings) console.warn(`warning  ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR    ${e}`);
  console.error(`\nplugin manifests: ${errors.length} error(s)`);
  process.exit(1);
}
console.log(`plugin manifests: OK${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
