#!/usr/bin/env node
/**
 * understudy CLI.
 *
 *   understudy capture <url> -o motion.yaml
 *   understudy capture <url> --merge ./skills/mybrand/design-model.yaml
 *   understudy capture <url> --passes scroll --window 12000
 *   understudy validate ./motion.yaml
 *
 * Runs locally against a URL the user supplies. No account, no API key, no
 * hosted service (§2, §15).
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import type { CapturePassName } from './capture/types.js';
import { captureSite } from './capture/session.js';
import { analyze } from './analyze/index.js';
import { assembleBrand } from './brand/index.js';
import { emitMotionYaml } from './emit/motion-yaml.js';
import { toBrandCss, toTailwindConfig, toDesignTokens } from './emit/tokens.js';
import { emitDesignModel, buildRationaleBlock, nameFromUrl, type DesignModel } from './emit/design-model.js';
import { toBrandReport } from './emit/report.js';
import { collectReportAssets } from './emit/inline-assets.js';
import { mergeIntoDesignModel } from './emit/merge.js';
import { reconcile, measuredFromYaml } from './context/reconcile.js';
import { validateDesignModel, hasErrors, formatReport } from './validate.js';

const ALLOWED_PASSES: CapturePassName[] = ['scroll', 'hover', 'click'];

const HELP = `understudy - measure a site's brand identity (color, type, spacing, motion).

usage:
  understudy capture <url> [options]
  understudy context <design-model.yaml> <rationale.json> [-o out.yaml]
  understudy validate <path-to-design-model.yaml>

capture options:
  -o, --output <file>     write the design-model to <file> (default: stdout)
      --motion-only       emit just the motion block, not the full brand model
      --merge <file>      splice the motion block into an existing design-model.yaml, in place
      --css <file>        also write brand + motion CSS custom properties to <file>
      --tailwind <file>   also write a Tailwind theme.extend config to <file>
      --dtcg <file>       also write W3C Design Tokens (DTCG) JSON to <file>
      --report <file>     also write a visual brand report (standalone HTML) to <file>
      --passes <list>     comma-separated subset of: scroll,hover,click (default: all)
      --window <ms>       capture window budget in ms (default: 8000)
      --settle <ms>       settle delay between steps in ms (default: 350)
      --no-headless       run with a visible browser window
      --ignore-robots     capture even if robots.txt disallows it (default: respect robots.txt)
  -h, --help              show this help
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'motion-only': { type: 'boolean', default: false },
      merge: { type: 'string' },
      css: { type: 'string' },
      tailwind: { type: 'string' },
      dtcg: { type: 'string' },
      report: { type: 'string' },
      passes: { type: 'string' },
      window: { type: 'string' },
      settle: { type: 'string' },
      headless: { type: 'boolean', default: true },
      'ignore-robots': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }

  if (command === 'validate') {
    const file = positionals[1];
    if (!file) fail('validate needs a path: understudy validate ./motion.yaml');
    const findings = validateDesignModel(readFileSync(file, 'utf8'));
    console.log(formatReport(findings, file));
    process.exitCode = hasErrors(findings) ? 1 : 0;
    return;
  }

  if (command === 'context') {
    const modelPath = positionals[1];
    const rationalePath = positionals[2];
    if (!modelPath || !rationalePath) fail('usage: understudy context <design-model.yaml> <rationale.json> [-o out.yaml]');
    const doc = parseDocument(readFileSync(modelPath, 'utf8'));
    if (doc.errors.length > 0) fail(`design-model.yaml did not parse: ${doc.errors[0].message}`);
    const parsed = doc.toJS() as Record<string, unknown>;
    let rationale;
    try {
      rationale = JSON.parse(readFileSync(rationalePath, 'utf8'));
    } catch (err) {
      fail(`rationale.json did not parse: ${(err as Error).message}`);
    }
    const { divergences, reconciled } = reconcile((p) => measuredFromYaml(parsed as Record<string, any>, p), rationale);
    doc.set('rationale', doc.createNode(buildRationaleBlock({ ...rationale, divergences, reconciled })));
    const outYaml = doc.toString({ lineWidth: 0 });
    if (values.output) {
      writeFileSync(values.output, outYaml);
      console.error(`understudy: wrote ${values.output}`);
    } else {
      process.stdout.write(outYaml);
    }
    console.error(`understudy: reconciled ${reconciled.length} token(s), ${divergences.length} divergence(s)`);
    const findings = validateDesignModel(outYaml);
    if (hasErrors(findings)) {
      console.error(formatReport(findings, values.output ?? 'design-model.yaml'));
      process.exitCode = 1;
    }
    return;
  }

  if (command !== 'capture') fail(`unknown command "${command}". Try: understudy --help`);

  const url = positionals[1];
  if (!url) fail('capture needs a url: understudy capture https://example.com -o motion.yaml');

  const passes = parsePasses(values.passes);
  const capture = await captureSite({
    url,
    passes,
    windowMs: parseMs(values.window),
    settleMs: parseMs(values.settle),
    headless: values.headless,
    ignoreRobots: values['ignore-robots'],
  });

  const model = analyze(capture.motion);
  const brand = assembleBrand(capture.styles);
  const design: DesignModel = {
    name: nameFromUrl(url),
    source: url,
    capturedAt: capture.motion.capturedAt,
    brand,
    motion: model,
  };

  const motionYaml = emitMotionYaml(model);
  const outputYaml = values['motion-only'] ? motionYaml : emitDesignModel(design);

  const modeNote = Object.keys(brand.colors).length > 1 ? 'light+dark' : brand.mode;
  console.error(
    `understudy: ${modeNote} brand from ${url} - ${brand.typography.families[0] ?? 'unknown'} type, ` +
      `accent ${brand.colors[brand.mode]?.accent ?? 'n/a'}, ${capture.motion.events.length} motions ` +
      `(brand confidence ${brand.confidence}, motion confidence ${model.meta.confidence}, archetype ${model.personality.archetype})`,
  );

  if (values.merge) {
    const merged = mergeIntoDesignModel(readFileSync(values.merge, 'utf8'), model);
    writeFileSync(values.merge, merged);
    console.error(`understudy: spliced motion into ${values.merge}`);
  } else if (values.output) {
    writeFileSync(values.output, outputYaml);
    console.error(`understudy: wrote ${values.output}`);
  } else {
    process.stdout.write(outputYaml);
  }

  if (values.css) {
    writeFileSync(values.css, toBrandCss(design));
    console.error(`understudy: wrote ${values.css}`);
  }
  if (values.tailwind) {
    writeFileSync(values.tailwind, toTailwindConfig(design));
    console.error(`understudy: wrote ${values.tailwind}`);
  }
  if (values.dtcg) {
    writeFileSync(values.dtcg, JSON.stringify(toDesignTokens(design), null, 2) + '\n');
    console.error(`understudy: wrote ${values.dtcg}`);
  }
  if (values.report) {
    // Fetch the fonts + a raster logo and embed them, so the report is a
    // self-contained, CSP-safe page (best-effort; unreachable assets stay URLs).
    const assets = await collectReportAssets(design);
    const inner = toBrandReport(design, { assets });
    const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${nameFromUrl(url)} - brand report</title></head><body>\n${inner}\n</body></html>\n`;
    writeFileSync(values.report, html);
    const inlined = assets.size ? ` (${assets.size} asset${assets.size === 1 ? '' : 's'} inlined)` : '';
    console.error(`understudy: wrote ${values.report}${inlined}`);
  }

  // Validate the motion block within our own output; never let a malformed block out silently.
  const findings = validateDesignModel(outputYaml);
  if (hasErrors(findings)) {
    console.error(formatReport(findings, values.output ?? 'motion.yaml'));
    process.exitCode = 1;
  }
}

function parsePasses(raw: string | undefined): CapturePassName[] | undefined {
  if (!raw) return undefined;
  const requested = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const invalid = requested.filter((p) => !ALLOWED_PASSES.includes(p as CapturePassName));
  if (invalid.length > 0) fail(`unknown pass(es): ${invalid.join(', ')}. Allowed: ${ALLOWED_PASSES.join(', ')}`);
  return requested as CapturePassName[];
}

function parseMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) fail(`expected a positive number of milliseconds, got "${raw}"`);
  return n;
}

function fail(message: string): never {
  console.error(`understudy: ${message}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(`understudy: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
