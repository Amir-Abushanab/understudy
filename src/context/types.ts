/**
 * Documented-rationale contract (spec §13). The deterministic tool never fills
 * this in; an LLM (the plugin's skill, or any assistant) reads user-named or
 * discovered sources and produces a Rationale that conforms to these types.
 *
 * The load-bearing rule is "never quantize a vibe": a numeric token may only come
 * from measurement or from an actual stated number in a source. Everything
 * qualitative is a `principle` (a short, reworded, cited claim) or a `constraint`
 * (a negative rule), never a fabricated number. Copyright posture: store
 * paraphrase + citation, never verbatim excerpts.
 */

/** Source reliability tier: 1 published motion/brand specs (prose with numbers),
 * 2 design-system repos/ADRs, 3 eng/design blogs, 4 talks/podcasts/courses. */
export type SourceTier = 1 | 2 | 3 | 4;

export interface RationaleSource {
  url: string;
  title?: string;
  tier: SourceTier;
  fetchedAt?: string;
}

/** A qualitative claim, reworded, attributed to a source by index. */
export interface Principle {
  claim: string;
  source: number;
  /** True only when the source stated an actual number or explicit comparative. */
  quantified: boolean;
  /** Optional non-numeric implication (e.g. "distance-proportional"). Must not be
   * a number when quantified is false. */
  implies?: string;
}

/** A documented numeric claim, for reconciliation against measurement. */
export interface DocumentedToken {
  /** Token path, e.g. `duration.base`, `spacing.2`, `font.body.size`. */
  token: string;
  value: number;
  source: number;
}

/** A measured-vs-documented conflict, left for a human to resolve. */
export interface Divergence {
  token: string;
  documented: number | string;
  measured: number | string;
  note: string;
  resolution: 'unresolved' | 'prefer-measured' | 'prefer-documented';
}

/** The rationale an assistant produces from the sources. */
export interface Rationale {
  /** The qualitative feel: what the brand is going for, in a few honest sentences. */
  summary: string;
  /** One-word feel, optional (e.g. "precise", "warm", "playful"). */
  archetype?: string;
  /** Tone of voice, optional. */
  voice?: string;
  sources: RationaleSource[];
  principles: Principle[];
  /** Negative rules: what the brand deliberately refuses to do. */
  constraints: string[];
  /** Documented numeric claims, reconciled against measurement. */
  documented?: DocumentedToken[];
  /** Conflicts, filled by reconcile (or provided directly). */
  divergences?: Divergence[];
  /** Token paths whose documented value agreed with measurement (set by reconcile). */
  reconciled?: string[];
}
