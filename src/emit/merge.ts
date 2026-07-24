/**
 * Splice a measured motion block into an existing Hue `design-model.yaml`,
 * preserving everything else in the file (including comments and key order).
 *
 * The whole project is designed so this is a non-event: understudy's `motion`
 * block is exactly the shape Hue already reserves under a top-level `motion:`
 * key, so merging is a single set, not a transform. Keeping design-model.yaml
 * compatibility is a hard constraint (§15).
 */

import { parseDocument } from 'yaml';
import type { MotionModel } from '../analyze/model.js';
import { spliceMotion } from './motion-yaml.js';

/**
 * Return the target YAML with `motion:` set to the analyzed model. If the target
 * already had a `motion:` key it is replaced; all other content is preserved.
 * Throws if the target does not parse, so we never clobber a broken file.
 */
export function mergeIntoDesignModel(targetYaml: string, model: MotionModel): string {
  const doc = parseDocument(targetYaml);
  if (doc.errors.length > 0) {
    throw new Error(`target design-model.yaml did not parse: ${doc.errors[0].message}`);
  }
  spliceMotion(doc, model);
  return doc.toString({ lineWidth: 0 });
}
