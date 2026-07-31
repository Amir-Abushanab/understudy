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

This is the qualitative half, and it deserves real depth. A Feel resting on two
pages is thin. Go wide across sources and tiers:

- **Official (tier 1-2).** The brand's own design-system docs, brand and voice
  guidelines, typography/color/motion pages, and design-engineering blog. These
  give the canonical principles and most of the stated numbers.
- **Design writing and interviews (tier 3-4).** The designers' own talks,
  podcasts, and interviews, plus the studio or foundry story behind a bespoke
  typeface. These carry the voice, the motion attitude, and the craft ethos the
  docs leave out.
- **Third-party breakdowns (tier 3-4).** Independent design-system teardowns and
  critiques. Do not skip these. Outside observers name the visual language
  plainly, and they are usually where the concrete numbers that become
  divergences surface (a documented accent color versus the one you measured).

Fan this out. If you have subagents, run several in parallel, each on a different
angle (official docs, philosophy and voice, third-party analysis), each returning
paraphrased, cited claims with a tier and a `quantified` flag. Then read what
comes back, cross-corroborate, and write one `rationale.json` conforming to the
contract below. Aim for breadth of source and tier, not a single canonical page.
Paraphrase; never quote.

**Cost.** This is the only token-heavy part. Everything else (capture,
reconciliation, the report, the token exports) is deterministic and spends no
model tokens. Almost all of the Feel's cost is the web research: a thorough
fan-out of roughly three parallel research agents, each reading ~20 pages, lands
around 100-150K tokens for one site (a worked example measured ~35K / ~51K / ~47K
across three agents, ~132K total, plus synthesis). Scale the fan-out to the depth
you want; a quick Feel off a couple of sources is far cheaper, and re-running the
report or exports afterward costs nothing.

### 4. Reconcile and merge

```bash
node dist/index.js context model.yaml rationale.json -o model.yaml
```

This compares any documented numbers to the measured tokens (agreement is
reconciled; a real conflict becomes a `divergence` left unresolved; documented-only
stays a constraint) and splices in the `rationale:` block. It re-validates.

### 5. Regenerate the report

Re-run `capture` with the rationale so the model and the report both open with the
feel, reconciled against the live measurement:

```bash
node dist/index.js capture <url> --rationale rationale.json -o model.yaml --report report.html --css tokens.css
```

Then hand back `model.yaml` + `report.html` + `tokens.css`. (Step 4's `context`
does the same merge without re-capturing when you only need the model, not a
re-rendered report; `--rationale` is the path when you want the Feel in the HTML.)

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
