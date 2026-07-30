// Capture-hardening harness: run `capture` across a diverse batch of sites, then
// flag anomalies (crashes/timeouts, malformed or missing logos, mode/font misses,
// values that don't validate). Usage: pnpm stress [outDir]
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateDesignModel, hasErrors } from '../dist/validate.js';

const OUT = process.argv[2] || join(tmpdir(), 'understudy-stress');
mkdirSync(OUT, { recursive: true });
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const sites = {
  stripe: 'https://stripe.com', vercel: 'https://vercel.com', github: 'https://github.com',
  linear: 'https://linear.app', tailwind: 'https://tailwindcss.com', anthropic: 'https://www.anthropic.com',
  apple: 'https://www.apple.com', spotify: 'https://open.spotify.com', airbnb: 'https://www.airbnb.com',
  figma: 'https://www.figma.com', framer: 'https://www.framer.com', raycast: 'https://www.raycast.com',
  nytimes: 'https://www.nytimes.com', discord: 'https://discord.com',
};

const capture = (name, url) => new Promise((res) => {
  const start = Date.now();
  const p = spawn('node', [CLI, 'capture', url, '-o', `${OUT}/${name}.yaml`], { timeout: 175000 });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code, signal) => res({ name, url, code, signal, ms: Date.now() - start, errTail: err.trim().split('\n').at(-1) || '' }));
  p.on('error', (e) => res({ name, url, code: -1, signal: null, ms: Date.now() - start, errTail: e.message }));
});

async function pool(items, n, fn) {
  const out = []; let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } };
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

const SYS = new Set(['system-ui', 'sans-serif', '-apple-system', 'serif', 'monospace', 'ui-sans-serif']);

function analyze(run) {
  const f = `${OUT}/${run.name}.yaml`;
  const row = { name: run.name, ms: (run.ms / 1000).toFixed(0) + 's', flags: [] };
  if (run.signal) { row.flags.push('TIMEOUT'); return row; }
  if (run.code !== 0) row.flags.push(`EXIT_${run.code}`);
  if (!existsSync(f)) { row.flags.push('NO_OUTPUT'); return row; }
  let raw, m;
  try { raw = readFileSync(f, 'utf8'); m = parse(raw); } catch { row.flags.push('UNPARSEABLE'); return row; }
  row.conf = m.confidence?.brand;
  row.mode = m.primary_mode + (Object.keys(m.colors || {}).length > 1 ? '+' : '');
  row.font = (m.typography?.families || [])[0] || '-';
  row.logo = m.logo?.kind || 'none';
  row.sampled = m.observed?.sampled_elements;
  if (m.observed?.challenge_page) row.flags.push('CHALLENGE');
  else {
    if (row.conf != null && row.conf < 0.3) row.flags.push('LOW_CONF');
    if (SYS.has(String(row.font))) row.flags.push('SYSTEM_FONT');
  }
  if (m.logo?.kind === 'svg' && !/<\/svg>\s*$/.test(String(m.logo.svg).trim())) row.flags.push('LOGO_MALFORMED');
  else if (!m.logo) row.flags.push('NO_LOGO');
  if ((m.radii || []).some((r) => r > 100000)) row.flags.push('RADIUS_OUTLIER');
  try { if (hasErrors(validateDesignModel(raw))) row.flags.push('VALIDATE_ERR'); } catch { row.flags.push('VALIDATE_THREW'); }
  if (run.errTail && /error|throw|unhandled|cannot/i.test(run.errTail)) row.flags.push('STDERR');
  return row;
}

console.error(`stress: capturing ${Object.keys(sites).length} sites -> ${OUT} (concurrency 4)...`);
const rows = (await pool(Object.entries(sites), 4, ([n, u]) => capture(n, u))).map(analyze);
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log('\n' + ['site', 'time', 'conf', 'mode', 'font', 'logo', 'sampled', 'flags'].map((h, i) => pad(h, [10, 6, 6, 8, 18, 6, 9, 0][i])).join(''));
console.log('-'.repeat(96));
for (const r of rows) console.log(pad(r.name, 10) + pad(r.ms, 6) + pad(r.conf ?? '-', 6) + pad(r.mode ?? '-', 8) + pad(String(r.font).slice(0, 17), 18) + pad(r.logo ?? '-', 6) + pad(r.sampled ?? '-', 9) + (r.flags.length ? r.flags.join(' ') : 'ok'));
const flagged = rows.filter((r) => r.flags.length && !r.flags.includes('CHALLENGE'));
console.log(`\n${rows.length} sites | ${rows.filter((r) => r.flags.includes('CHALLENGE')).length} challenged | ${flagged.length} need attention`);
if (flagged.length) { console.log('NEEDS ATTENTION:', flagged.map((r) => `${r.name}[${r.flags.join(',')}]`).join('  ')); process.exitCode = 1; }
