/**
 * End-to-end pipeline test: a synthetic capture that exercises all four fixture
 * archetypes at once (staggered reveal, spring, rAF easing, hover, parallax) is
 * run through analyze -> emit -> validate. The emitted block must satisfy the
 * §8 validator with zero errors, and the CSS and merge outputs must too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

import type { CaptureResult, MotionEvent, ProgressSample, ScrollSample } from '../capture/types.js';
import { analyze, dominantParallaxRatio } from '../analyze/index.js';
import { evalCubicBezier, type BezierControl } from '../analyze/bezier.js';
import { springStepResponse } from '../analyze/spring.js';
import { emitMotionYaml } from './motion-yaml.js';
import { emitTokensCss, toThemeVars } from './tokens-css.js';
import { mergeIntoDesignModel } from './merge.js';
import { validateMotionBlock, validateCss, hasErrors } from '../validate.js';

function easeSamples(control: BezierControl, durationMs: number, dt = 16): ProgressSample[] {
  const out: ProgressSample[] = [];
  for (let t = 0; t <= durationMs; t += dt) out.push({ t, p: evalCubicBezier(control, t / durationMs) });
  return out;
}

function springSamples(k: number, c: number, m: number, durationMs: number, dt = 16): ProgressSample[] {
  const w = Math.sqrt(k / m);
  const z = c / (2 * Math.sqrt(k * m));
  const out: ProgressSample[] = [];
  for (let t = 0; t <= durationMs; t += dt) out.push({ t, p: springStepResponse(w, z, t / 1000) });
  return out;
}

function ev(partial: Partial<MotionEvent> & { id: string; startT: number; endT: number; samples: ProgressSample[] }): MotionEvent {
  return {
    targetId: partial.id,
    targetLabel: 'item',
    property: 'translateY',
    from: 12,
    to: 0,
    source: 'waapi',
    trigger: 'load',
    ...partial,
  };
}

function syntheticCapture(): CaptureResult {
  const events: MotionEvent[] = [];

  // Staggered list reveal: 5 items, 120ms apart, 240ms ease-out each.
  for (let i = 0; i < 5; i++) {
    const startT = i * 120;
    events.push(ev({ id: `item${i}`, targetLabel: 'item', startT, endT: startT + 240, samples: easeSamples([0, 0, 0.58, 1], 240) }));
  }
  // Spring card (overshoot), a separate group well after the stagger.
  events.push(ev({ id: 'card', targetLabel: 'card', startT: 1200, endT: 1900, from: 40, to: 0, source: 'raf', samples: springSamples(200, 12, 1, 900) }));
  // rAF easeOutCubic hero, another separate group.
  events.push(ev({ id: 'hero', targetLabel: 'hero', startT: 2000, endT: 2420, from: 24, to: 0, source: 'raf', samples: easeSamples([0.33, 1, 0.68, 1], 420) }));
  // Two hover lifts.
  events.push(ev({ id: 'btn1', targetLabel: 'button', startT: 3000, endT: 3160, from: 0, to: -4, source: 'css-transition', trigger: 'hover', samples: easeSamples([0, 0, 0.58, 1], 160) }));
  events.push(ev({ id: 'btn2', targetLabel: 'button', startT: 3200, endT: 3360, from: 0, to: -4, source: 'css-transition', trigger: 'hover', samples: easeSamples([0, 0, 0.58, 1], 160) }));

  const scrollSamples: ScrollSample[] = [];
  for (let y = 0; y <= 1000; y += 50) {
    scrollSamples.push({ t: y, targetId: 'layer', targetLabel: 'layer', property: 'translateY', scrollY: y, value: y * 0.35 });
  }

  return {
    source: 'https://example.com',
    capturedAt: '2026-07-24T10:00:00Z',
    passes: ['scroll', 'hover', 'click'],
    events,
    scrollSamples,
    rejected: 40,
    totalSamples: 1200,
    limitations: [],
  };
}

test('pipeline: analyze -> emit -> validate yields a block with zero errors', () => {
  const model = analyze(syntheticCapture());
  const yaml = emitMotionYaml(model);
  const findings = validateMotionBlock(yaml);
  assert.equal(hasErrors(findings), false, `unexpected errors:\n${JSON.stringify(findings, null, 2)}`);
});

test('pipeline: emitted block has the expected shape', () => {
  const model = analyze(syntheticCapture());
  const yaml = emitMotionYaml(model);
  const parsed = parse(yaml) as any;
  const motion = parsed.motion;

  assert.ok(typeof motion.meta.confidence === 'number' && motion.meta.confidence >= 0 && motion.meta.confidence <= 1);
  assert.equal(motion.meta.source, 'https://example.com');

  // Provenance shorthand: a measured duration is a bare number, not an object.
  assert.equal(typeof motion.primitives.duration.base, 'number');
  assert.equal(motion.primitives.duration.base, 240);
  // Bezier easing is emitted as a flow array.
  assert.ok(Array.isArray(motion.primitives.easing.standard));

  // The stagger got wired into list-reveal, referencing tokens by name.
  assert.equal(motion.semantic['list-reveal'].stagger, 'loose');
  assert.equal(typeof motion.semantic['list-reveal'].duration, 'string');

  // Scroll coupling recovered as a ratio literal (the one permitted number in semantic).
  assert.ok(Math.abs(motion.semantic['scroll-parallax'].ratio - 0.35) < 0.03);

  // Choreography reconstructed the 5-step sequence.
  assert.equal(motion.choreography[0].steps.length, 5);
  assert.equal(motion.choreography[0].steps[0].delay, 0);

  assert.ok(['playful', 'premium', 'corporate', 'energetic'].includes(motion.personality.archetype));
});

test('pipeline: a measured spring becomes a usable linear() easing in CSS', () => {
  const model = analyze(syntheticCapture());
  const css = emitTokensCss(model);
  assert.equal(hasErrors(validateCss(css)), false);
  assert.match(css, /--duration-base:\s*240ms/);
  assert.match(css, /--ease-standard:\s*cubic-bezier/);
  const vars = toThemeVars(model);
  const springKey = Object.keys(vars).find((k) => k.startsWith('ease-spring'));
  assert.ok(springKey, 'a spring easing var should exist');
  assert.match(vars[springKey!], /^linear\(/);
});

test('merge: splices motion into an existing design-model.yaml, preserving the rest', () => {
  const existing = [
    '# brand palette',
    'color:',
    '  bg: "#0b0b0f"',
    '  fg: "#e8e8ef"',
    'type:',
    '  scale: [12, 14, 16, 20, 28]',
    '',
  ].join('\n');
  const model = analyze(syntheticCapture());
  const merged = mergeIntoDesignModel(existing, model);

  assert.match(merged, /# brand palette/, 'existing comment preserved');
  const parsed = parse(merged) as any;
  assert.equal(parsed.color.bg, '#0b0b0f', 'existing color tokens preserved');
  assert.ok(parsed.motion.primitives.duration, 'motion spliced in');
  assert.equal(hasErrors(validateMotionBlock(merged)), false, 'merged file still validates');
});

test('cross-verify: a declared easing is preferred over the fitted curve', () => {
  // Four CSS transitions that declare cubic-bezier(0.65, 0, 0.35, 1), sampled from
  // that same curve. The emitted easing must be the declared curve (exact), and
  // observed must report the cross-verification.
  const control: BezierControl = [0.65, 0, 0.35, 1];
  const events: MotionEvent[] = [];
  for (let i = 0; i < 4; i++) {
    events.push(
      ev({
        id: `d${i}`,
        targetLabel: 'card',
        startT: i * 900,
        endT: i * 900 + 300,
        from: 20,
        to: 0,
        source: 'css-transition',
        samples: easeSamples(control, 300),
        declaredDuration: 300,
        declaredEasing: 'cubic-bezier(0.65, 0, 0.35, 1)',
      }),
    );
  }
  const capture: CaptureResult = {
    source: 'https://example.com',
    capturedAt: '2026-07-24T10:00:00Z',
    passes: ['scroll'],
    events,
    scrollSamples: [],
    rejected: 0,
    totalSamples: 900,
    limitations: [],
  };

  const model = analyze(capture);
  const parsed = parse(emitMotionYaml(model)) as any;
  const easings = Object.values(parsed.motion.primitives.easing);
  const usedDeclared = easings.some(
    (e: any) => Array.isArray(e) && Math.abs(e[0] - 0.65) < 0.02 && Math.abs(e[2] - 0.35) < 0.02,
  );
  assert.ok(usedDeclared, 'emitted easing should be the declared curve, not a fit');
  assert.match(parsed.motion.observed.notes, /cross-verified 4 of 4/);
});

test('parallax: recovers the 0.35 coupling ratio from scroll samples', () => {
  const ratio = dominantParallaxRatio(syntheticCapture().scrollSamples);
  assert.ok(ratio !== null && Math.abs(ratio - 0.35) < 0.02, `got ${ratio}`);
});
