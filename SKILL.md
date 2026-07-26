---
name: understudy
description: >-
  Measure a website's whole brand identity from a live, rendered page and emit a
  design-model.yaml: color palette with roles and light/dark modes, typography,
  spacing and radius scales, and measured motion (durations, easings, springs,
  stagger, choreography). Then learn its feel: read the brand's design writing and
  synthesize a cited rationale reconciled against the measurement. The tool
  measures ground truth deterministically; the assistant adds the qualitative
  layer, under a never-quantize-a-vibe rule. No account or API key.
license: MIT
---

# understudy

understudy drives a real, instrumented browser and reads a site's brand off the
rendered result: the color palette (with semantic roles and light/dark modes),
type families and scale, spacing and radius scales, and the motion. It emits a
`design-model.yaml` that stands alone or splices into
[Hue](https://github.com/dominikmartn/hue)'s schema.

Reading the *computed* values beats inferring them from a screenshot, especially
for CSS-in-JS with hashed class names. And motion is the part nobody else
measures: static analysis cannot see `requestAnimationFrame` motion (GSAP, Lenis,
Framer Motion's imperative API), where distinctive brand motion lives. understudy
sees it by sampling the moving properties frame by frame and reconstructing the
timing, then cross-verifying against the page's declared CSS/WAAPI values.

## When to use this

- A Hue design system needs its `motion` slot filled with measured values.
- Someone wants the duration scale, easing curves, spring parameters, stagger
  rhythm, or load choreography of a specific site they name.
- Motion tokens should reflect what a site really does, with a confidence score,
  rather than plausible-looking guesses.

Do not use this to clone a site or to build a library of competitor motion. It
extracts only from URLs the user supplies, one at a time.

## How to run it

```bash
pnpm install && pnpm exec playwright install chromium

# standalone motion block (pnpm capture runs from source; no build needed)
pnpm capture https://example.com -o motion.yaml

# splice into an existing Hue design system, in place
pnpm capture https://example.com --merge ./skills/mybrand/design-model.yaml

# scroll-heavy site: scroll pass only, longer window
pnpm capture https://example.com --passes scroll --window 12000

# validate (exit 1 on any error, matching Hue)
node scripts/validate.mjs ./motion.yaml
```

After `pnpm build` (or a global install) the same commands work as
`understudy capture ...`.

## What comes back

A `motion` block with `meta` (including a mandatory `confidence`), `primitives`
(duration, easing, stagger), `semantic` entries that reference primitives by
name, `choreography` sequences, a `personality` archetype with evidence, and an
`observed` audit section. Every token carries provenance; measured values use a
scalar shorthand. The full contract is in `understudy-spec.md` section 5.

## Reading the output

- **`meta.confidence` is authoritative.** It reports real uncertainty. A low
  number means the measurement was genuinely uncertain (thin sampling, poor fit,
  truncation, or reduced-motion suppression). Do not smooth it over.
- **`observed` is for humans, not generators.** It records why tokens got their
  values and what capture could not see.
- **Springs appear only when overshoot was measured.** Absence of a spring means
  no bounce was observed, not that the site is boring.

## Safety posture

Capture never submits forms, never clicks destructive or transactional controls,
never authenticates, stays on the target origin, respects robots.txt, and sends a
truthful user-agent. It forces `prefers-reduced-motion: no-preference` during
capture so the real motion is measurable, which is disclosed in the README.
