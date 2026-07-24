/**
 * Personality mapping (§5). Reduce the aggregate measurements to one archetype
 * label plus the evidence that justifies it. The evidence strings are the point:
 * a downstream human should be able to see *why* the label was chosen, and the
 * label should never contradict the numbers.
 *
 * Evidence strings are emitted prose, so they must contain no em-dashes (§8).
 */

export type Archetype = 'playful' | 'premium' | 'corporate' | 'energetic';

export interface PersonalitySignals {
  /** Median measured duration in ms across all motions. */
  medianDurationMs: number;
  /** Whether any motion was fit as a spring (overshoot detected). */
  hasSprings: boolean;
  /** Largest overshoot fraction observed (0 when none). */
  maxOvershoot: number;
  /** Dominant easing shape across fitted curves. */
  easeBias: 'ease-out' | 'ease-in' | 'ease-in-out' | 'linear' | 'mixed';
  /** Whether a confident stagger cluster was recovered. */
  staggerPresent: boolean;
  /** How many motions informed these signals. */
  sampleCount: number;
}

export interface PersonalityResult {
  archetype: Archetype;
  evidence: string[];
  scores: Record<Archetype, number>;
}

/** Empirical median duration of "corporate" motion, used as a comparison line. */
const CORPORATE_MEDIAN_MS = 180;

const TIE_ORDER: Archetype[] = ['premium', 'energetic', 'playful', 'corporate'];

export function classifyPersonality(signals: PersonalitySignals): PersonalityResult {
  const scores: Record<Archetype, number> = { playful: 0, premium: 0, corporate: 0, energetic: 0 };
  const evidence: string[] = [];
  const md = Math.round(signals.medianDurationMs);

  // Bounce is the strongest single tell.
  if (signals.hasSprings && signals.maxOvershoot > 0.15) {
    scores.playful += 2;
    scores.energetic += 1;
    scores.premium -= 1;
    scores.corporate -= 2;
    evidence.push(`spring overshoot up to ${Math.round(signals.maxOvershoot * 100)} percent past the mark`);
  } else {
    scores.premium += 1;
    scores.corporate += 1;
    evidence.push('consistent settling with no bounce or overshoot detected');
  }

  // Duration band.
  if (md < CORPORATE_MEDIAN_MS) {
    scores.energetic += 2;
    scores.corporate += 1;
    evidence.push(`median duration ${md}ms, at or below the ${CORPORATE_MEDIAN_MS}ms corporate median`);
  } else if (md <= 360) {
    scores.premium += 2;
    evidence.push(`median duration ${md}ms, above the ${CORPORATE_MEDIAN_MS}ms corporate median`);
  } else {
    scores.premium += 1;
    evidence.push(`median duration ${md}ms, a deliberate, unhurried pace`);
  }

  // Easing bias.
  switch (signals.easeBias) {
    case 'ease-out':
      scores.premium += 1;
      evidence.push('consistent ease-out bias, motion that decelerates into place');
      break;
    case 'ease-in-out':
      scores.premium += 1;
      evidence.push('symmetric ease-in-out bias, smooth on both ends');
      break;
    case 'linear':
      scores.corporate += 1;
      evidence.push('largely linear timing, mechanical rather than expressive');
      break;
    case 'ease-in':
      scores.energetic += 1;
      evidence.push('ease-in bias, motion that accelerates away');
      break;
    default:
      break;
  }

  // Stagger reads as choreographed intent.
  if (signals.staggerPresent) {
    scores.premium += 1;
    scores.energetic += 1;
    evidence.push('choreographed stagger recovered, motions arrive on a deliberate rhythm');
  }

  const archetype = pickArchetype(scores);
  return { archetype, evidence, scores };
}

function pickArchetype(scores: Record<Archetype, number>): Archetype {
  let best: Archetype = TIE_ORDER[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of TIE_ORDER) {
    if (scores[candidate] > bestScore) {
      bestScore = scores[candidate];
      best = candidate;
    }
  }
  return best;
}
