/**
 * The motion-block validator (§8). Extends Hue's validate.mjs conventions: it
 * accumulates findings with a level, and any ERROR means the block is invalid
 * (the wrapper exits 1, exactly as Hue does). Downstream agents treat these
 * tokens as authoritative, so a malformed block must never pass silently.
 *
 * Checks (§8):
 *   - YAML parses.
 *   - Every `semantic` reference resolves to an existing `primitives` key.
 *   - No raw numeric literals in semantic timing fields or choreography tokens.
 *   - `meta.confidence` present and in [0, 1].
 *   - Durations within sane human bounds (reject 0ms, reject > 3000ms; flag).
 *   - No em-dashes in emitted prose fields.
 *   - Every token carries a provenance from the allowed set (shorthand => measured).
 *   - Orphan primitives are reported (WARN; the §5 example intentionally ships
 *     unreferenced scale levels, so this is informational, not fatal).
 *   - CSS inputs: no undefined `var(--token)` usages.
 */

import { parse } from 'yaml';
import { parseColor } from './brand/color.js';

export type Level = 'ERROR' | 'WARN' | 'SKIP';

export interface Finding {
  level: Level;
  check: string;
  detail: string;
}

export interface ValidateOptions {
  /** Upper bound for interaction durations in ms; over this is flagged, not clamped. */
  maxDurationMs?: number;
}

const PROVENANCE = new Set(['measured', 'documented', 'reconciled', 'inferred']);
const EM_DASH = /[—―]/;
const EM_DASH_ENTITY = /&(?:mdash|#8212|#x2014);/i;
const TIMING_FIELDS = ['duration', 'easing', 'stagger'] as const;

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate a standalone motion block or a design-model.yaml that contains one. */
export function validateMotionBlock(text: string, options: ValidateOptions = {}): Finding[] {
  const maxDurationMs = options.maxDurationMs ?? 3000;
  const findings: Finding[] = [];

  let root: unknown;
  try {
    root = parse(text);
  } catch (err) {
    return [{ level: 'ERROR', check: 'yaml-parse', detail: (err as Error).message }];
  }

  if (!isDict(root)) {
    return [{ level: 'ERROR', check: 'structure', detail: 'top level is not a mapping' }];
  }

  const motion = isDict(root.motion) ? root.motion : root;
  if (!isDict(motion.primitives) && !isDict(motion.meta)) {
    return [{ level: 'ERROR', check: 'structure', detail: 'no motion block found (expected a `motion:` key or a block with `primitives`/`meta`)' }];
  }

  checkConfidence(motion, findings);
  const primitiveKeys = collectPrimitiveKeys(motion, findings);
  checkProvenance(motion, findings);
  checkDurations(motion, maxDurationMs, findings);
  const referenced = checkSemantic(motion, primitiveKeys, findings);
  checkChoreography(motion, findings);
  checkOrphans(primitiveKeys, referenced, findings);
  checkEmDashes(text, motion, findings);

  return findings;
}

/**
 * Validate a full design-model (brand dimensions + motion) or a motion-only
 * block. Brand checks run when a brand section is present; the motion block is
 * validated by the existing motion checks. This is what `understudy validate`
 * and the CLI self-check call.
 */
export function validateDesignModel(text: string, options: ValidateOptions = {}): Finding[] {
  let root: unknown;
  try {
    root = parse(text);
  } catch (err) {
    return [{ level: 'ERROR', check: 'yaml-parse', detail: (err as Error).message }];
  }
  if (!isDict(root)) {
    return [{ level: 'ERROR', check: 'structure', detail: 'top level is not a mapping' }];
  }

  const findings: Finding[] = [];
  const looksBrand = root.colors !== undefined || root.primary_mode !== undefined || root.typography !== undefined;
  if (looksBrand) validateBrand(root, findings);

  const hasMotion = isDict(root.motion);
  const isMotionOnly = !looksBrand && (isDict(root.primitives) || isDict(root.meta));
  if (hasMotion || isMotionOnly) findings.push(...validateMotionBlock(text, options));

  return findings;
}

function validateBrand(root: Dict, findings: Finding[]): void {
  const mode = root.primary_mode;
  if (mode !== undefined && mode !== 'light' && mode !== 'dark') {
    findings.push({ level: 'WARN', check: 'brand', detail: `primary_mode "${String(mode)}" should be light or dark` });
  }

  if (root.colors !== undefined) {
    if (!isDict(root.colors)) {
      findings.push({ level: 'ERROR', check: 'brand', detail: 'colors must be a mapping keyed by mode' });
    } else {
      for (const [modeName, roles] of Object.entries(root.colors)) {
        if (!isDict(roles)) {
          findings.push({ level: 'ERROR', check: 'brand', detail: `colors.${modeName} must be a mapping` });
          continue;
        }
        for (const required of ['background', 'text1', 'accent']) {
          if (roles[required] === undefined) {
            findings.push({ level: 'WARN', check: 'brand', detail: `colors.${modeName} is missing the ${required} role` });
          }
        }
        for (const [role, value] of Object.entries(roles)) {
          if (typeof value !== 'string' || parseColor(value) === null) {
            findings.push({ level: 'ERROR', check: 'brand', detail: `colors.${modeName}.${role} is not a valid color: ${String(value)}` });
          }
        }
      }
    }
  }

  if (Array.isArray(root.accents)) {
    root.accents.forEach((v, i) => {
      if (typeof v !== 'string' || parseColor(v) === null) {
        findings.push({ level: 'ERROR', check: 'brand', detail: `accents[${i}] is not a valid color: ${String(v)}` });
      }
    });
  }

  if (isDict(root.states)) {
    for (const [role, v] of Object.entries(root.states)) {
      if (typeof v !== 'string' || parseColor(v) === null) {
        findings.push({ level: 'ERROR', check: 'brand', detail: `states.${role} is not a valid color: ${String(v)}` });
      }
    }
  }

  const confidence = isDict(root.confidence) ? root.confidence.brand : undefined;
  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
    findings.push({ level: 'ERROR', check: 'brand', detail: `confidence.brand must be a number in [0, 1]` });
  }
}

/** Validate that generated CSS has no `var(--token)` without a matching definition (§8). */
export function validateCss(text: string): Finding[] {
  const findings: Finding[] = [];
  const defined = new Set<string>();
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
  const seen = new Set<string>();
  for (const m of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*[),]/gi)) {
    const name = m[1];
    if (!defined.has(name) && !seen.has(name)) {
      seen.add(name);
      findings.push({ level: 'ERROR', check: 'css-vars', detail: `var(${name}) has no definition` });
    }
  }
  if (EM_DASH.test(text) || EM_DASH_ENTITY.test(text)) {
    findings.push({ level: 'ERROR', check: 'em-dash', detail: 'em-dash found in generated CSS' });
  }
  return findings;
}

// --------------------------------------------------------------------------

function checkConfidence(motion: Dict, findings: Finding[]): void {
  const meta = isDict(motion.meta) ? motion.meta : undefined;
  const confidence = meta?.confidence;
  if (confidence === undefined) {
    findings.push({ level: 'ERROR', check: 'confidence', detail: 'meta.confidence is required and missing' });
    return;
  }
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    findings.push({ level: 'ERROR', check: 'confidence', detail: `meta.confidence must be a number in [0, 1], got ${String(confidence)}` });
  }
}

interface PrimitiveKeys {
  duration: Set<string>;
  easing: Set<string>;
  stagger: Set<string>;
}

function collectPrimitiveKeys(motion: Dict, findings: Finding[]): PrimitiveKeys {
  const primitives = isDict(motion.primitives) ? motion.primitives : {};
  const keys: PrimitiveKeys = { duration: new Set(), easing: new Set(), stagger: new Set() };
  for (const field of TIMING_FIELDS) {
    const group = primitives[field];
    if (group === undefined) continue;
    if (!isDict(group)) {
      findings.push({ level: 'ERROR', check: 'structure', detail: `primitives.${field} must be a mapping` });
      continue;
    }
    for (const name of Object.keys(group)) keys[field].add(name);
  }
  return keys;
}

/** Extract a numeric token value from shorthand (number) or long form ({value}). */
function tokenNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (isDict(value) && typeof value.value === 'number') return value.value;
  return null;
}

function checkProvenance(motion: Dict, findings: Finding[]): void {
  const primitives = isDict(motion.primitives) ? motion.primitives : {};

  for (const field of ['duration', 'stagger'] as const) {
    const group = isDict(primitives[field]) ? (primitives[field] as Dict) : {};
    for (const [name, value] of Object.entries(group)) {
      if (typeof value === 'number') continue; // shorthand => measured
      if (isDict(value)) {
        validateExplicitProvenance(`${field}.${name}`, value, findings);
      } else {
        findings.push({ level: 'ERROR', check: 'provenance', detail: `${field}.${name} is neither a number nor a token object` });
      }
    }
  }

  const easing = isDict(primitives.easing) ? (primitives.easing as Dict) : {};
  for (const [name, value] of Object.entries(easing)) {
    if (Array.isArray(value)) continue; // bezier shorthand => measured
    if (isDict(value)) {
      const isSpring = 'stiffness' in value || 'damping' in value || 'mass' in value;
      if (isSpring) {
        if ('provenance' in value) validateExplicitProvenance(`easing.${name}`, value, findings);
        // else: spring shorthand => measured
      } else {
        validateExplicitProvenance(`easing.${name}`, value, findings);
      }
    } else {
      findings.push({ level: 'ERROR', check: 'provenance', detail: `easing.${name} is neither an array nor a token object` });
    }
  }
}

function validateExplicitProvenance(path: string, value: Dict, findings: Finding[]): void {
  const provenance = value.provenance;
  if (provenance === undefined) {
    findings.push({ level: 'ERROR', check: 'provenance', detail: `${path} is in long form but has no provenance` });
    return;
  }
  if (typeof provenance !== 'string' || !PROVENANCE.has(provenance)) {
    findings.push({ level: 'ERROR', check: 'provenance', detail: `${path} has invalid provenance "${String(provenance)}"` });
  }
}

function checkDurations(motion: Dict, maxDurationMs: number, findings: Finding[]): void {
  const primitives = isDict(motion.primitives) ? motion.primitives : {};
  const durations = isDict(primitives.duration) ? (primitives.duration as Dict) : {};
  for (const [name, value] of Object.entries(durations)) {
    const ms = tokenNumber(value);
    if (ms === null) continue;
    if (ms <= 0) {
      findings.push({ level: 'ERROR', check: 'duration-bounds', detail: `duration.${name} is ${ms}ms; must be greater than 0` });
    } else if (ms > maxDurationMs) {
      findings.push({ level: 'ERROR', check: 'duration-bounds', detail: `duration.${name} is ${ms}ms; over ${maxDurationMs}ms for interaction motion (flagged, not clamped)` });
    }
  }
}

function checkSemantic(motion: Dict, keys: PrimitiveKeys, findings: Finding[]): PrimitiveKeys {
  const referenced: PrimitiveKeys = { duration: new Set(), easing: new Set(), stagger: new Set() };
  const semantic = isDict(motion.semantic) ? motion.semantic : {};

  for (const [name, entry] of Object.entries(semantic)) {
    if (!isDict(entry)) {
      findings.push({ level: 'ERROR', check: 'semantic', detail: `semantic.${name} must be a mapping` });
      continue;
    }
    for (const field of TIMING_FIELDS) {
      const ref = entry[field];
      if (ref === undefined) continue;
      if (typeof ref === 'number') {
        findings.push({ level: 'ERROR', check: 'no-raw-literals', detail: `semantic.${name}.${field} is a raw number ${ref}; must reference a ${field} token` });
      } else if (typeof ref === 'string') {
        if (!keys[field].has(ref)) {
          findings.push({ level: 'ERROR', check: 'semantic', detail: `semantic.${name}.${field} references unknown ${field} token "${ref}"` });
        } else {
          referenced[field].add(ref);
        }
      } else {
        findings.push({ level: 'ERROR', check: 'semantic', detail: `semantic.${name}.${field} must be a token name` });
      }
    }
    if (entry.coupling !== undefined && entry.coupling !== 'scroll') {
      findings.push({ level: 'WARN', check: 'semantic', detail: `semantic.${name}.coupling is "${String(entry.coupling)}"; only "scroll" is understood` });
    }
    if (entry.ratio !== undefined && typeof entry.ratio !== 'number') {
      findings.push({ level: 'ERROR', check: 'semantic', detail: `semantic.${name}.ratio must be a number` });
    }
  }
  return referenced;
}

function checkChoreography(motion: Dict, findings: Finding[]): void {
  const choreography = motion.choreography;
  if (choreography === undefined) return;
  if (!Array.isArray(choreography)) {
    findings.push({ level: 'ERROR', check: 'choreography', detail: 'choreography must be a list' });
    return;
  }
  const semKeys = new Set(Object.keys(isDict(motion.semantic) ? motion.semantic : {}));
  choreography.forEach((seq, i) => {
    if (!isDict(seq) || !Array.isArray(seq.steps)) return;
    seq.steps.forEach((step: unknown, j) => {
      if (!isDict(step)) return;
      const token = step.token;
      if (typeof token === 'number') {
        findings.push({ level: 'ERROR', check: 'no-raw-literals', detail: `choreography[${i}].steps[${j}].token is a raw number; must reference a semantic token` });
      } else if (typeof token === 'string') {
        if (!semKeys.has(token)) {
          findings.push({ level: 'ERROR', check: 'choreography', detail: `choreography[${i}].steps[${j}].token references unknown semantic token "${token}"` });
        }
      } else {
        findings.push({ level: 'ERROR', check: 'choreography', detail: `choreography[${i}].steps[${j}].token must be a semantic token name` });
      }
    });
  });
}

function checkOrphans(keys: PrimitiveKeys, referenced: PrimitiveKeys, findings: Finding[]): void {
  for (const field of TIMING_FIELDS) {
    for (const name of keys[field]) {
      if (!referenced[field].has(name)) {
        findings.push({ level: 'WARN', check: 'orphan-token', detail: `primitives.${field}.${name} is defined but not referenced by any semantic entry` });
      }
    }
  }
}

function checkEmDashes(rawText: string, motion: Dict, findings: Finding[]): void {
  if (EM_DASH_ENTITY.test(rawText)) {
    findings.push({ level: 'ERROR', check: 'em-dash', detail: 'em-dash HTML entity found in block' });
  }
  const offenders: string[] = [];
  walkStrings(motion, '', (path, value) => {
    if (EM_DASH.test(value)) offenders.push(path);
  });
  for (const path of offenders) {
    findings.push({ level: 'ERROR', check: 'em-dash', detail: `em-dash in prose field ${path}` });
  }
}

function walkStrings(value: unknown, path: string, visit: (path: string, value: string) => void): void {
  if (typeof value === 'string') {
    visit(path || '(root)', value);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  } else if (isDict(value)) {
    for (const [k, v] of Object.entries(value)) walkStrings(v, path ? `${path}.${k}` : k, visit);
  }
}

// --------------------------------------------------------------------------

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.level === 'ERROR');
}

export function formatReport(findings: Finding[], file: string): string {
  if (findings.length === 0) return `understudy: ${file} OK (0 findings)`;
  const lines = findings.map((f) => `  ${f.level.padEnd(5)} [${f.check}] ${f.detail}`);
  const errors = findings.filter((f) => f.level === 'ERROR').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  return [`understudy: ${file}`, ...lines, `  ${errors} error(s), ${warns} warning(s)`].join('\n');
}
