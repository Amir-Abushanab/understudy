/**
 * Reconcile documented rationale against measurement (spec §13). Three cases:
 *   1. Agreement  - documented value matches measurement within tolerance. The
 *      token is marked reconciled and its confidence should rise: two independent
 *      channels agreeing is the strongest signal available.
 *   2. Documented-only - a documented number with no measurable counterpart. It
 *      is not a divergence (it has no measured side); the assistant should have
 *      expressed it as a constraint or principle.
 *   3. Conflict - both sides present but disagree. Emitted as a divergence with
 *      resolution `unresolved`; never silently pick a winner. Divergence is a
 *      feature, not an error: stale/aspirational docs or a redesign in flight.
 */

import type { Rationale, Divergence } from './types.js';
import type { DesignModel } from '../emit/design-model.js';

export interface ReconcileResult {
  divergences: Divergence[];
  reconciled: string[];
}

/** Reconcile using an injected lookup, so the same logic serves both the
 * in-memory DesignModel and a parsed design-model.yaml. */
export function reconcile(
  getMeasured: (tokenPath: string) => number | null,
  rationale: Rationale,
  tolerance = 0.15,
): ReconcileResult {
  const divergences: Divergence[] = [...(rationale.divergences ?? [])];
  const reconciled: string[] = [];

  for (const doc of rationale.documented ?? []) {
    const measured = getMeasured(doc.token);
    if (measured === null) continue; // documented-only: belongs in constraints
    const denom = Math.abs(measured) || 1;
    if (Math.abs(doc.value - measured) / denom <= tolerance) {
      reconciled.push(doc.token);
    } else {
      divergences.push({
        token: doc.token,
        documented: doc.value,
        measured,
        note: 'documented value differs from the live measurement',
        resolution: 'unresolved',
      });
    }
  }

  return { divergences, reconciled };
}

/** Resolve a token path against a measured DesignModel. */
export function measuredFromModel(model: DesignModel, path: string): number | null {
  const dot = path.indexOf('.');
  const group = dot < 0 ? path : path.slice(0, dot);
  const name = dot < 0 ? '' : path.slice(dot + 1);
  const motion = model.motion.primitives;
  const type = model.brand.typography;

  if (group === 'duration') return motion.duration[name]?.value ?? null;
  if (group === 'stagger') return motion.stagger[name]?.value ?? null;
  if (path === 'font.body.size') return type.body.size;
  if (path === 'font.display.size') return type.display.size;
  if (group === 'spacing') return indexValue(model.brand.spacing, name);
  if (group === 'radius' || group === 'radii') return indexValue(model.brand.radii, name);
  return null;
}

function indexValue(scale: number[], name: string): number | null {
  const i = parseInt(name, 10);
  return Number.isInteger(i) && i >= 0 && i < scale.length ? scale[i] : null;
}

/** Resolve a token path against a parsed design-model.yaml (plain object), so the
 * `understudy context` command can reconcile against an emitted model. */
export function measuredFromYaml(root: Record<string, any>, path: string): number | null {
  const dot = path.indexOf('.');
  const group = dot < 0 ? path : path.slice(0, dot);
  const name = dot < 0 ? '' : path.slice(dot + 1);
  const num = (v: unknown): number | null =>
    typeof v === 'number' ? v : v && typeof v === 'object' && typeof (v as any).value === 'number' ? (v as any).value : typeof v === 'string' ? parseFloat(v) || null : null;

  const prim = root.motion?.primitives;
  if (group === 'duration') return num(prim?.duration?.[name]);
  if (group === 'stagger') return num(prim?.stagger?.[name]);
  if (path === 'font.body.size') return num(root.typography?.body?.size);
  if (path === 'font.display.size') return num(root.typography?.display?.size);
  if (group === 'spacing') return indexValue(root.spacing ?? [], name);
  if (group === 'radius' || group === 'radii') return indexValue(root.radii ?? [], name);
  return null;
}

/** Apply a reconciled Rationale onto the model (attaches it and records agreement). */
export function attachRationale(model: DesignModel, rationale: Rationale): DesignModel {
  const result = reconcile((p) => measuredFromModel(model, p), rationale);
  return {
    ...model,
    rationale: { ...rationale, divergences: result.divergences, reconciled: result.reconciled },
  };
}
