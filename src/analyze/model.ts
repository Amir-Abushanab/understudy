/**
 * The analyzed motion model: a typed mirror of the §5 YAML contract, produced by
 * `analyze()` and consumed by the emitters. Keeping it as typed data (rather than
 * building YAML directly) means the emit layer makes no assumptions about who the
 * consumer is (§2: keep emit/ free of Hue-only assumptions), and every token
 * carries provenance from v0.1 onward so the v0.3 rationale work is additive.
 */

import type { CapturePassName } from '../capture/types.js';
import type { BezierControl } from './bezier.js';
import type { Archetype } from './personality.js';

/** Where a token's value came from. In v0.1 only `measured` is produced, but the
 * field exists from day one so §13 can add the others without a schema break. */
export type Provenance = 'measured' | 'documented' | 'reconciled' | 'inferred';

export interface DurationToken {
  value: number;
  provenance: Provenance;
}

export interface StaggerToken {
  value: number;
  provenance: Provenance;
}

export interface BezierEasing {
  kind: 'bezier';
  control: BezierControl;
  provenance: Provenance;
}

export interface SpringEasing {
  kind: 'spring';
  stiffness: number;
  damping: number;
  mass: number;
  provenance: Provenance;
}

export type EasingToken = BezierEasing | SpringEasing;

export interface MotionPrimitives {
  duration: Record<string, DurationToken>;
  easing: Record<string, EasingToken>;
  stagger: Record<string, StaggerToken>;
}

/** A semantic entry references primitive tokens by name. The only numeric field
 * permitted inline is `ratio` (a scroll coupling coefficient, which has no token
 * scale); duration/easing/stagger are always name references (§5 rule 1). */
export interface SemanticEntry {
  duration?: string;
  easing?: string;
  stagger?: string;
  coupling?: 'scroll';
  ratio?: number;
}

export interface ChoreographyStep {
  target: string;
  delay: number;
  token: string;
}

export interface Choreography {
  name: string;
  trigger: CapturePassName;
  steps: ChoreographyStep[];
}

export interface MotionMeta {
  source: string;
  capturedAt: string;
  confidence: number;
  passes: CapturePassName[];
}

export interface Personality {
  archetype: Archetype;
  evidence: string[];
}

export interface Observed {
  samples: number;
  rejected: number;
  notes: string;
}

export interface MotionModel {
  meta: MotionMeta;
  primitives: MotionPrimitives;
  semantic: Record<string, SemanticEntry>;
  choreography: Choreography[];
  personality: Personality;
  observed: Observed;
}
