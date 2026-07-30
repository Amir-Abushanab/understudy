/**
 * Analysis orchestrator: CaptureResult -> MotionModel.
 *
 * This is where the individual recovery steps compose into the §5 structure.
 * The mappings from measured motion to semantic names and choreography are
 * deliberately simple, documented heuristics; when a mapping is unsure it is
 * omitted rather than guessed, and the uncertainty is pushed into
 * meta.confidence (§6, §15). The recovery math (cluster/bezier/spring/quantize)
 * is the rigorous part; this file is the honest-glue part.
 */

import type { CaptureResult, MotionEvent, ScrollSample, CapturePassName } from '../capture/types.js';
import type {
  MotionModel,
  EasingToken,
  DurationToken,
  StaggerToken,
  SemanticEntry,
  Choreography,
} from './model.js';
import { recoverStagger, type StaggerCluster } from './cluster.js';
import {
  fitCubicBezier,
  evalCubicBezier,
  roundControl,
  isSaneEasing,
  bezierResidual,
  controlDistance,
  type BezierControl,
} from './bezier.js';
import { fitSpring, type SpringFit } from './spring.js';
import { parseDeclaredEasing, durationsAgree } from './declared.js';
import { quantizeScale, assignToken, DURATION_ANCHORS, STAGGER_ANCHORS } from './quantize.js';
import { classifyPersonality, type PersonalitySignals } from './personality.js';

export * from './model.js';

/** Named canonical easing curves (spec vocabulary); a fitted curve borrows the
 * nearest name. A plain ease-out is closest to `standard`, a strong decelerate
 * to `entrance`, an accelerate-out to `exit`. */
const EASING_ANCHORS: Record<string, BezierControl> = {
  standard: [0.4, 0, 0.2, 1],
  entrance: [0.16, 1, 0.3, 1],
  exit: [0.7, 0, 0.84, 0],
};

const NO_MOTION_NOTE = 'no truncation or reduced-motion suppression noted';

interface EventFit {
  event: MotionEvent;
  durationMs: number;
  easing: EasingToken;
  residual: number;
  spring: SpringFit | null;
  /** Where the easing came from: the page declared it, or we fit the samples. */
  easingSource: 'declared' | 'fitted';
  /** The declared duration agreed with the measured span. */
  durationVerified: boolean;
  /** The fitted curve agreed with the declared curve (two channels concur). */
  easingVerified: boolean;
}

/** Durations above this are ambient (loops, long scroll intros), not interaction
 * motion; matches the validator's duration bound so emitted models validate. */
const MAX_INTERACTION_MS = 3000;

export function analyze(capture: CaptureResult): MotionModel {
  const fits = capture.events.map(fitEvent);
  // Motion that merely tracks scroll position (Lenis smooth scroll, parallax) is
  // coupling, not a timed animation; left in, it inflates the duration scale with
  // second-long "motions". Exclude those targets from the timed-token analysis;
  // they still inform the scroll-parallax ratio below.
  const coupled = scrollCoupledTargets(capture.scrollSamples);
  const timedFits = fits.filter((f) => !coupled.has(f.event.targetId));

  // --- primitives.duration -------------------------------------------------
  // A duration over the interaction ceiling (matching the validator's bound) is
  // ambient motion (a looping hero, a long scroll intro), not an interaction
  // primitive; left in the scale it mints spurious, orphaned, over-bound tokens
  // like `epic: 6290` that nothing references and that fail validation. Keep the
  // interaction-scale durations for the vocabulary; the ambient ones are noted
  // in the observed audit below.
  const allDurations = timedFits.map((f) => f.durationMs).filter((d) => d > 0);
  const durations = allDurations.filter((d) => d <= MAX_INTERACTION_MS);
  const ambientDurations = allDurations.filter((d) => d > MAX_INTERACTION_MS);
  const durationScale = quantizeScale(durations, DURATION_ANCHORS);
  const duration = toDurationTokens(durationScale.scale);

  // --- primitives.easing ---------------------------------------------------
  const { easing, tokenOf: easingTokenOf } = buildEasingTokens(timedFits);

  // --- primitives.stagger --------------------------------------------------
  // Staggers appear on load (hero sequences) and during scroll (reveals firing in
  // quick succession); cluster both, and the time-gap grouping keeps them apart.
  const staggerEvents = timedFits.map((f) => f.event).filter((e) => e.trigger === 'load' || e.trigger === 'scroll');
  const allClusters = recoverStagger(staggerEvents);
  const confidentClusters = allClusters.filter((c) => c.confident);
  const staggerScale = quantizeScale(confidentClusters.map((c) => c.intervalMs), STAGGER_ANCHORS);
  const stagger = toStaggerTokens(staggerScale.scale);

  // --- semantic ------------------------------------------------------------
  const semantic: Record<string, SemanticEntry> = {};
  const durTokenFor = (ms: number): string | null => assignToken(ms, durationScale.scale);
  const staggerTokenFor = (ms: number): string | null => assignToken(ms, staggerScale.scale);

  addSemanticForTrigger(semantic, 'hover', 'hover-lift', timedFits, easingTokenOf, durTokenFor);
  addSemanticForTrigger(semantic, 'click', 'press', timedFits, easingTokenOf, durTokenFor);

  const loadFits = timedFits.filter((f) => f.event.trigger === 'load');
  if (loadFits.length > 0) {
    const entry = buildTimingSemantic(loadFits, easingTokenOf, durTokenFor);
    if (entry) semantic['modal-enter'] = entry;
  }

  const staggerCluster = confidentClusters[0];
  if (staggerCluster) {
    const base = semantic['modal-enter'] ?? buildTimingSemantic(loadFits, easingTokenOf, durTokenFor);
    const staggerToken = staggerTokenFor(staggerCluster.intervalMs);
    if (base && staggerToken) {
      semantic['list-reveal'] = { ...base, stagger: staggerToken };
    }
  }

  const ratio = dominantParallaxRatio(capture.scrollSamples);
  if (ratio !== null) {
    semantic['scroll-parallax'] = { coupling: 'scroll', ratio: round(ratio, 3) };
  }

  // Reveal-on-scroll-enter: the common pattern where elements fade/rise in as
  // they enter the viewport. This is a real, measurable signature even when it is
  // not a single time-clustered stagger (which many sites, e.g. Linear, are not).
  const scrollReveal = buildScrollReveal(timedFits, easingTokenOf, durTokenFor);
  if (scrollReveal) semantic['scroll-reveal'] = scrollReveal.entry;

  // --- choreography --------------------------------------------------------
  const choreography = buildChoreography(staggerCluster, capture.events, semantic);

  // --- personality ---------------------------------------------------------
  const personality = classifyPersonality(buildSignals(timedFits, confidentClusters, durations));

  // --- observed + meta -----------------------------------------------------
  const verifiable = timedFits.filter((f) => f.event.declaredDuration !== undefined || f.event.declaredEasing !== undefined).length;
  const verified = timedFits.filter((f) => f.durationVerified || f.easingVerified).length;
  const crossNote = verifiable > 0 ? `cross-verified ${verified} of ${verifiable} motions against declared CSS or WAAPI timing` : null;
  const revealNote = scrollReveal ? `scroll-reveal on ${scrollReveal.count} elements` : null;
  const ambientNote =
    ambientDurations.length > 0
      ? `${ambientDurations.length} ambient motion(s) over ${MAX_INTERACTION_MS}ms kept out of the duration scale (max ${Math.round(Math.max(...ambientDurations))}ms)`
      : null;
  const extraNote = [crossNote, revealNote, ambientNote].filter((n): n is string => n !== null).join('; ') || null;
  const observed = {
    samples: capture.totalSamples,
    rejected: capture.rejected,
    notes: buildNotes(capture, extraNote),
  };
  const confidence = scoreConfidence(capture, timedFits, allClusters);

  return {
    meta: {
      source: capture.source,
      capturedAt: capture.capturedAt,
      confidence,
      passes: capture.passes,
    },
    primitives: { duration, easing, stagger },
    semantic,
    choreography,
    personality: { archetype: personality.archetype, evidence: personality.evidence },
    observed,
  };
}

// --------------------------------------------------------------------------
// per-event fitting
// --------------------------------------------------------------------------

function fitEvent(event: MotionEvent): EventFit {
  const measuredSpan = event.endT - event.startT;
  const durationMs = Math.round(event.declaredDuration ?? measuredSpan);
  const durationVerified =
    event.declaredDuration !== undefined && durationsAgree(event.declaredDuration, measuredSpan);

  // Springs are imperative rAF motion with no declared easing; detect from the
  // overshoot in the samples first.
  const spring = fitSpring(event.samples);
  if (spring) {
    return {
      event,
      durationMs,
      easing: { kind: 'spring', stiffness: spring.stiffness, damping: spring.damping, mass: spring.mass, provenance: 'measured' },
      residual: spring.residual,
      spring,
      easingSource: 'fitted',
      durationVerified,
      easingVerified: false,
    };
  }

  // When the page declared a cubic-bezier (CSS transition/animation or WAAPI),
  // that curve is authoritative. Use it, and cross-check it against the samples
  // and against an independent fit so agreement can raise confidence.
  const declared = parseDeclaredEasing(event.declaredEasing);
  if (declared.kind === 'bezier' && isSaneEasing(declared.control)) {
    const residual = bezierResidual(declared.control, event.samples);
    const fitted = fitCubicBezier(event.samples);
    const easingVerified = fitted.sampleCount >= 4 && controlDistance(declared.control, fitted.control) < 0.25;
    return {
      event,
      durationMs,
      easing: { kind: 'bezier', control: roundControl(declared.control), provenance: 'measured' },
      residual,
      spring: null,
      easingSource: 'declared',
      durationVerified,
      easingVerified,
    };
  }

  // Pure rAF (or a declared steps()/linear() we do not model as a bezier):
  // fitting the sampled progress is the only way to recover the shape.
  const bez = fitCubicBezier(event.samples);
  return {
    event,
    durationMs,
    easing: { kind: 'bezier', control: roundControl(bez.control), provenance: 'measured' },
    residual: bez.residual,
    spring: null,
    easingSource: 'fitted',
    durationVerified,
    easingVerified: false,
  };
}

// --------------------------------------------------------------------------
// primitives assembly
// --------------------------------------------------------------------------

function toDurationTokens(scale: Record<string, number>): Record<string, DurationToken> {
  const out: Record<string, DurationToken> = {};
  for (const [name, value] of Object.entries(scale)) out[name] = { value, provenance: 'measured' };
  return out;
}

function toStaggerTokens(scale: Record<string, number>): Record<string, StaggerToken> {
  const out: Record<string, StaggerToken> = {};
  for (const [name, value] of Object.entries(scale)) out[name] = { value, provenance: 'measured' };
  return out;
}

/** Name each fitted easing by its nearest canonical curve (beziers) or by
 * stiffness tier (springs), and return both the token table and a per-fit lookup. */
function buildEasingTokens(fits: EventFit[]): {
  easing: Record<string, EasingToken>;
  tokenOf: (fit: EventFit) => string | null;
} {
  const easing: Record<string, EasingToken> = {};
  const nameByFit = new Map<EventFit, string>();
  const bestResidual: Record<string, number> = {};

  // Springs first; distinct springs get soft/firm names by order of appearance.
  let springTier = 0;
  for (const fit of fits) {
    if (fit.easing.kind !== 'spring') continue;
    const name = springTier === 0 ? 'spring-soft' : `spring-${springTier}`;
    if (!easing[name]) {
      easing[name] = fit.easing;
      springTier++;
    }
    nameByFit.set(fit, name);
  }

  // Only sane bezier fits define the curve vocabulary, and the lowest-residual
  // fit wins each name, so one noisy motion cannot poison a token.
  for (const fit of fits) {
    if (fit.easing.kind !== 'bezier' || !isSaneEasing(fit.easing.control)) continue;
    const name = nearestEasingName(fit.easing.control);
    if (easing[name] === undefined || fit.residual < bestResidual[name]) {
      easing[name] = { kind: 'bezier', control: roundControl(fit.easing.control), provenance: 'measured' };
      bestResidual[name] = fit.residual;
    }
    nameByFit.set(fit, name);
  }

  // A fallback so bezier fits too noisy to trust still resolve to a real named
  // curve rather than emitting a numerical artifact as an easing.
  let fallback = easing.standard !== undefined ? 'standard' : firstBezierName(easing);
  if (fallback === null && fits.some((f) => f.easing.kind === 'bezier')) {
    easing.standard = { kind: 'bezier', control: roundControl(EASING_ANCHORS.standard), provenance: 'measured' };
    fallback = 'standard';
  }
  if (fallback !== null) {
    for (const fit of fits) {
      if (fit.easing.kind === 'bezier' && !nameByFit.has(fit)) nameByFit.set(fit, fallback);
    }
  }

  return { easing, tokenOf: (fit) => nameByFit.get(fit) ?? null };
}

function firstBezierName(easing: Record<string, EasingToken>): string | null {
  for (const [name, token] of Object.entries(easing)) if (token.kind === 'bezier') return name;
  return null;
}

function nearestEasingName(control: BezierControl): string {
  let best = 'standard';
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [name, anchor] of Object.entries(EASING_ANCHORS)) {
    const dist = controlDistance(control, anchor);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// semantic assembly
// --------------------------------------------------------------------------

function addSemanticForTrigger(
  semantic: Record<string, SemanticEntry>,
  trigger: MotionEvent['trigger'],
  name: string,
  fits: EventFit[],
  easingTokenOf: (fit: EventFit) => string | null,
  durTokenFor: (ms: number) => string | null,
): void {
  const group = fits.filter((f) => f.event.trigger === trigger);
  const entry = buildTimingSemantic(group, easingTokenOf, durTokenFor);
  if (entry) semantic[name] = entry;
}

/** Build a {duration, easing} semantic from a group of fits, or null if the
 * group has no usable timing. Uses the median duration and the most common easing. */
function buildTimingSemantic(
  fits: EventFit[],
  easingTokenOf: (fit: EventFit) => string | null,
  durTokenFor: (ms: number) => string | null,
): SemanticEntry | null {
  if (fits.length === 0) return null;
  const durs = fits.map((f) => f.durationMs).filter((d) => d > 0);
  if (durs.length === 0) return null;
  const durToken = durTokenFor(median(durs));
  const easingToken = modeBy(fits.map((f) => easingTokenOf(f)).filter((n): n is string => n !== null));
  if (!durToken || !easingToken) return null;
  return { duration: durToken, easing: easingToken };
}

function buildChoreography(
  cluster: StaggerCluster | undefined,
  events: MotionEvent[],
  semantic: Record<string, SemanticEntry>,
): Choreography[] {
  if (!cluster) return [];
  const stepToken = semantic['modal-enter'] ? 'modal-enter' : firstTimingSemantic(semantic);
  if (!stepToken) return [];

  const byId = new Map(events.map((e) => [e.id, e]));
  // One element can animate several channels at once (translateY + opacity); those
  // are one beat, not several. Keep the earliest motion per element so the sequence
  // has one step per element.
  const byTarget = new Map<string, MotionEvent>();
  for (const id of cluster.memberIds) {
    const e = byId.get(id);
    if (!e) continue;
    const prev = byTarget.get(e.targetId);
    if (!prev || e.startT < prev.startT) byTarget.set(e.targetId, e);
  }
  const members = [...byTarget.values()].sort((a, b) => a.startT - b.startT);
  if (members.length < 2) return [];

  const t0 = members[0].startT;
  const seen = new Map<string, number>();
  const steps = members.map((e) => {
    const n = seen.get(e.targetLabel) ?? 0;
    seen.set(e.targetLabel, n + 1);
    const target = n === 0 ? e.targetLabel : `${e.targetLabel}-${n + 1}`;
    return { target, delay: Math.round(e.startT - t0), token: stepToken };
  });

  const trigger = majorityTrigger(members);
  return [{ name: trigger === 'load' ? 'load-sequence' : `${trigger}-sequence`, trigger, steps }];
}

/** Detect the reveal-on-scroll-enter pattern and characterize it: the median
 * duration and dominant easing (as token references) and the median enter
 * distance. Emitted like scroll-parallax, so it is honest about being a coupling
 * signature rather than a fabricated time-stagger. */
function buildScrollReveal(
  fits: EventFit[],
  easingTokenOf: (fit: EventFit) => string | null,
  durTokenFor: (ms: number) => string | null,
): { entry: SemanticEntry; count: number } | null {
  const reveals = fits.filter((f) => f.event.trigger === 'scroll' && isReveal(f.event));
  if (reveals.length < 3) return null;
  const durToken = durTokenFor(median(reveals.map((f) => f.durationMs)));
  const easingToken = modeBy(reveals.map((f) => easingTokenOf(f)).filter((n): n is string => n !== null));
  if (!durToken || !easingToken) return null;
  const entry: SemanticEntry = { duration: durToken, easing: easingToken };
  const distances = reveals.filter((f) => f.event.property === 'translateY').map((f) => Math.abs(f.event.from - f.event.to));
  if (distances.length > 0) entry.distance = Math.round(median(distances));
  return { entry, count: reveals.length };
}

/** An entrance from hidden/offset to visible/rest: a fade-in or a rise-in. */
function isReveal(e: MotionEvent): boolean {
  if (e.property === 'opacity') return e.from < 0.4 && e.to > 0.6;
  if (e.property === 'translateY') return Math.abs(e.from) > 4 && Math.abs(e.to) < 4;
  return false;
}

/** The first semantic that carries timing (a real entrance, not scroll coupling). */
function firstTimingSemantic(semantic: Record<string, SemanticEntry>): string | null {
  for (const [name, entry] of Object.entries(semantic)) if (entry.duration !== undefined) return name;
  return null;
}

function majorityTrigger(members: MotionEvent[]): CapturePassName {
  const counts = new Map<CapturePassName, number>();
  for (const m of members) counts.set(m.trigger, (counts.get(m.trigger) ?? 0) + 1);
  let best: CapturePassName = 'load';
  let bestCount = -1;
  for (const [trigger, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = trigger;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// scroll coupling
// --------------------------------------------------------------------------

/** Linear-regress each tracked element's value against scrollY and return the
 * dominant coupling slope, or null when nothing is meaningfully scroll-coupled. */
export function dominantParallaxRatio(samples: ScrollSample[]): number | null {
  if (samples.length < 4) return null;
  const byTarget = new Map<string, ScrollSample[]>();
  for (const s of samples) {
    const arr = byTarget.get(s.targetId) ?? [];
    arr.push(s);
    byTarget.set(s.targetId, arr);
  }

  let best: { slope: number; strength: number } | null = null;
  for (const arr of byTarget.values()) {
    if (arr.length < 4) continue;
    const slope = regressSlope(arr.map((s) => s.scrollY), arr.map((s) => s.value));
    if (slope === null) continue;
    const strength = Math.abs(slope) * arr.length;
    if (Math.abs(slope) < 0.02) continue; // effectively uncoupled
    if (best === null || strength > best.strength) best = { slope, strength };
  }
  return best ? best.slope : null;
}

/** Targets whose value tracks scrollY almost perfectly: Lenis smooth scroll or
 * parallax. Their motion is coupling, not a timed animation, so the timed-token
 * analysis excludes them (they still drive the parallax ratio). */
export function scrollCoupledTargets(samples: ScrollSample[]): Set<string> {
  const byTarget = new Map<string, ScrollSample[]>();
  for (const s of samples) {
    const arr = byTarget.get(s.targetId) ?? [];
    arr.push(s);
    byTarget.set(s.targetId, arr);
  }
  const coupled = new Set<string>();
  for (const [id, arr] of byTarget) {
    if (arr.length < 6) continue;
    const r = pearson(arr.map((s) => s.scrollY), arr.map((s) => s.value));
    if (r !== null && Math.abs(r) > 0.85) coupled.add(id);
  }
  return coupled;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? null : sxy / denom;
}

function regressSlope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

// --------------------------------------------------------------------------
// personality + confidence
// --------------------------------------------------------------------------

function buildSignals(fits: EventFit[], clusters: StaggerCluster[], durations: number[]): PersonalitySignals {
  const springs = fits.filter((f) => f.spring !== null);
  const maxOvershoot = springs.reduce((m, f) => Math.max(m, f.spring?.overshoot ?? 0), 0);
  const beziers = fits.filter((f) => f.easing.kind === 'bezier');
  const shapes = beziers.map((f) =>
    f.easing.kind === 'bezier' ? classifyBezierShape(f.easing.control) : 'ease-out',
  );
  const easeBias = (modeBy(shapes) ?? 'mixed') as PersonalitySignals['easeBias'];

  return {
    medianDurationMs: durations.length ? median(durations) : 0,
    hasSprings: springs.length > 0,
    maxOvershoot,
    easeBias,
    staggerPresent: clusters.length > 0,
    sampleCount: fits.length,
  };
}

function classifyBezierShape(control: BezierControl): PersonalitySignals['easeBias'] {
  const y25 = evalCubicBezier(control, 0.25);
  const y50 = evalCubicBezier(control, 0.5);
  const y75 = evalCubicBezier(control, 0.75);
  if (Math.abs(y25 - 0.25) < 0.06 && Math.abs(y75 - 0.75) < 0.06) return 'linear';
  if (y50 > 0.62) return 'ease-out';
  if (y50 < 0.38) return 'ease-in';
  return 'ease-in-out';
}

/**
 * Confidence must reflect real uncertainty (§6). Start optimistic, then pay a
 * penalty for each source of doubt: thin sampling, poor fit residuals, high
 * within-cluster variance, truncated rAF sequences, and reduced-motion
 * suppression. An honest 0.4 beats a confident, wrong 0.9.
 */
export function scoreConfidence(capture: CaptureResult, fits: EventFit[], clusters: StaggerCluster[]): number {
  let c = 0.9;

  if (capture.totalSamples < 300) c -= 0.15;
  else if (capture.totalSamples < 800) c -= 0.05;

  if (fits.length < 5) c -= 0.1;

  const residuals = fits.map((f) => f.residual).filter((r) => Number.isFinite(r));
  const meanResidual = residuals.length ? residuals.reduce((a, b) => a + b, 0) / residuals.length : 0;
  if (meanResidual > 0.05) c -= 0.2;
  else if (meanResidual > 0.02) c -= 0.08;

  const noisyClusters = clusters.filter((cl) => !cl.confident && cl.size > 2).length;
  if (noisyClusters > 0) c -= Math.min(0.15, 0.05 * noisyClusters);

  if (capture.limitations.some((l) => l.kind === 'truncated-raf')) c -= 0.1;
  if (capture.limitations.some((l) => l.kind === 'reduced-motion')) c -= 0.15;
  if (capture.limitations.some((l) => l.kind === 'login-required')) c -= 0.05;

  // Cross-verification against declared CSS/WAAPI timing is the strongest signal
  // available: two independent channels concurring (§6, §13). Reward agreement.
  const verifiable = fits.filter((f) => f.event.declaredDuration !== undefined || f.event.declaredEasing !== undefined);
  if (verifiable.length >= 3) {
    const verified = verifiable.filter((f) => f.durationVerified || f.easingVerified).length;
    c += 0.1 * (verified / verifiable.length);
  }

  return round(Math.min(0.98, Math.max(0.05, c)), 2);
}

function buildNotes(capture: CaptureResult, extra: string | null = null): string {
  const parts = capture.limitations.map((l) => sanitizeProse(l.detail));
  if (extra) parts.push(sanitizeProse(extra));
  if (parts.length === 0) return NO_MOTION_NOTE;
  return parts.join('; ');
}

// --------------------------------------------------------------------------
// small utilities
// --------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function modeBy(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = -1;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = v;
    }
  }
  return best;
}

/** Strip em-dashes from emitted prose so the validator's §8 check passes. */
export function sanitizeProse(text: string): string {
  return text.replace(/—/g, ', ').replace(/–/g, '-');
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
