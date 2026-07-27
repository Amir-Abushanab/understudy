---
name: understudy
description: >-
  Learn any website's brand identity from its live, rendered page. A bundled Node
  CLI measures the ground truth deterministically (color palette with roles and
  light/dark modes, typography, spacing and radius scales, and motion: durations,
  easings, springs, stagger, choreography) and emits a design-model.yaml. Then you
  learn its feel: read the brand's own design writing and synthesize a cited
  rationale, reconciled against the measurement, under a never-quantize-a-vibe
  rule. Use when a design system needs real, measured brand tokens plus an honest
  account of the feel, rather than values guessed from a screenshot. Runs locally
  against a URL the user supplies; no account or API key.
license: MIT
---

# understudy

understudy learns a site's brand identity in two channels that keep each other
honest:

1. **The tool measures.** A bundled Node CLI drives a real, instrumented browser
   and reads the brand off the *rendered* result: the color palette (semantic
   roles, light/dark modes), type families and scale, spacing and radius scales,
   and the motion. It is deterministic and needs no model or API key. Reading the
   computed values beats inferring them from a screenshot, especially for
   CSS-in-JS with hashed class names. Motion is the part nobody else measures:
   static analysis cannot see `requestAnimationFrame` motion (GSAP, Lenis, Framer
   Motion's imperative API), where distinctive brand motion lives. understudy
   sees it by sampling the moving properties frame by frame, then cross-verifying
   against the page's declared CSS/WAAPI values.

2. **You learn the feel.** Tokens cannot convey what a brand is *going for*. You
   read the brand's own design writing and synthesize a cited rationale, which the
   tool reconciles against the measurement so numbers only ever come from a
   measurement or a stated number.

This is an **agent-agnostic skill**: the recipe below is plain shell plus reading
the web, so any coding agent that can do those (Claude Code, Codex, ...) runs it
the same way. The CLI itself is just Node.

## When to use this

- A design system needs its brand tokens (color, type, spacing, motion) measured
  from a real site the user names, with a confidence score, rather than guessed.
- Someone wants not just the tokens but an honest description of the *feel* a
  brand is going for, grounded in the brand's own words and reconciled against
  what the page actually does.

Extract only from URLs the user supplies, one at a time. Capture respects
robots.txt, stays on the target origin, and never authenticates or submits forms.

## The recipe

### 1. Ready the tool

From the understudy repo, if `dist/` is missing:

```bash
pnpm install && pnpm exec playwright install chromium && pnpm build
```

(`pnpm capture ...` runs straight from source with no build if you prefer.)

### 2. Measure (deterministic, no guessing)

```bash
node dist/index.js capture <url> -o model.yaml --report report.html --css tokens.css
```

Read `model.yaml`: the measured palette (per light/dark), typography (families,
scale, weights, label role, measure), spacing/radii, gradients, shadows, motion
(durations, easings, springs, choreography), the logo, the accessibility audit,
and `confidence`. These are ground truth. Do not restate them as if you guessed
them.

### 3. Learn the feel (your job)

- Find sources on the brand's design philosophy: any URLs the user supplied,
  otherwise search for the brand's design principles, its engineering/design blog,
  brand guidelines, and recent talks. Prefer the brand's own writing (tier 1-2)
  over third-party (tier 3-4).
- Read them (WebFetch or equivalent).
- Write `rationale.json` conforming to the contract below.

### 4. Reconcile and merge

```bash
node dist/index.js context model.yaml rationale.json -o model.yaml
```

This compares any documented numbers to the measured tokens (agreement is
reconciled; a real conflict becomes a `divergence` left unresolved; documented-only
stays a constraint) and splices in the `rationale:` block. It re-validates.

### 5. Regenerate the report

Re-run step 2's `capture` (or just reopen `report.html`) so the report opens with
the feel, then hand back `model.yaml` + `report.html` + `tokens.css`.

## The rationale contract (rationale.json)

```json
{
  "summary": "the feel in a few honest sentences: what it is going for",
  "archetype": "optional one-word feel",
  "voice": "optional tone",
  "sources": [{ "url": "...", "title": "...", "tier": 1 }],
  "principles": [{ "claim": "short reworded claim", "source": 0, "quantified": false }],
  "constraints": ["a negative rule the brand refuses to break"],
  "documented": [{ "token": "duration.base", "value": 200, "source": 0 }]
}
```

## The one rule: never quantize a vibe

Emit a `documented` number ONLY when a source states an actual number or an
explicit comparative ("faster than our previous 300ms default"). Everything
qualitative is a `principle` (a short, reworded, cited claim) or a `constraint`
(a negative rule) — never a fabricated token. The failure mode that kills this
stage is inventing plausible numbers from adjectives. Paraphrase, never quote
verbatim; attribute every claim to a source by index. No em-dashes in emitted
prose. The validator enforces these.

## Reading the measured output

- **`confidence` is authoritative.** It reports real uncertainty. A low number
  means the measurement was genuinely uncertain (thin sampling, poor fit,
  truncation, or reduced-motion suppression). Do not smooth it over.
- **`observed` is for humans, not generators.** It records why tokens got their
  values and what capture could not see.
- **Springs appear only when overshoot was measured.** Absence of a spring means
  no bounce was observed, not that the site is boring.

## Emit targets

Besides `design-model.yaml` (standalone or spliced into
[Hue](https://github.com/dominikmartn/hue)'s schema), capture can emit CSS custom
properties (`--css`), a Tailwind `theme.extend` (`--tailwind`), W3C DTCG tokens
(`--dtcg`), and a visual HTML report (`--report`). `node scripts/validate.mjs
model.yaml` exits 1 on any error, matching Hue.

## Safety posture

Capture never submits forms, never clicks destructive or transactional controls,
never authenticates, stays on the target origin, respects robots.txt, and sends a
truthful user-agent. It forces `prefers-reduced-motion: no-preference` during
capture so the real motion is measurable, which is disclosed in the README.
