# Understudy — Project Scaffold Spec

You are scaffolding a new open-source project called **understudy**. Read this
document fully before writing any code. Do not deviate from the file layout or
the output contract without flagging it first.

---

## 1. What this is

[Hue](https://github.com/dominikmartn/hue) is an MIT-licensed agent skill that
points an AI coding assistant at a URL or screenshot and generates a complete
design system as a `SKILL.md` folder — color tokens, typography, spacing, radii,
components, light/dark mode. It writes a `design-model.yaml` as the canonical
artifact and gates every generated skill through `scripts/validate.mjs`.

Hue's schema nominally includes a `motion` dimension, but it is inferred from
static analysis (screenshots, stylesheets). It cannot capture what actually
makes a brand's motion recognizable: stagger intervals, scroll choreography,
spring parameters, and rAF-driven sequences.

**understudy is an extractor that fills that slot with measured data.**

It drives a real browser, instruments the animation APIs, records what actually
moves and when, and emits a `motion` block that drops into Hue's existing
`design-model.yaml` contract.

### Why this is hard (and why it doesn't exist yet)

- Chrome DevTools' Animations panel does not support `requestAnimationFrame`
  animations. GSAP, Lenis, and Framer Motion's imperative API all run on rAF.
  That is exactly where premium brand motion lives.
- The web has no native concept of a grouped animation. Choreography is an
  emergent property of many independently-scheduled animations. DevTools
  *guesses* at grouping by start time. Stagger must be **recovered
  statistically**, not read off.
- Production sites ship CSS-in-JS with hashed class names
  (`animation-name: css-1a2b3c`), so the source `@keyframes` is often gone.
  Computed values are the only reliable source.

The consequence: static CSS scraping is insufficient. This must be a scripted,
instrumented browser session. That is the entire technical bet of this project.

### On the name

**Understudy.** An understudy learns a performance by watching it closely, then
performs the part as themselves. That is precisely the relationship this tool
has to a captured site: it studies the technique, not the artifact.

The distinction matters and should be visible in every piece of copy. An
understudy studies *how a performance is executed* — the timing, the pacing, the
choreography. It does not reproduce the performance and pass it off as the
original. Concretely: this tool recovers the timing discipline underneath a
page, not the page.

That framing carries a Renaissance-workshop reading as well — apprentices copied
the master's drawings before composing anything of their own, and imitation was
the curriculum rather than the shortcut. Lead with the apprenticeship reading in
any README or landing copy, never with the copying reading.

The name is doing positioning work, so it obligates:

- The tool extracts from URLs the **user** supplies. It never ships or hosts a
  library of pre-extracted brand packs. (§7, §14)
- The repo contains **no** brand-named artifacts. Demo capability with a README
  recording, not with a checked-in `airbnb-motion.json`.
- Original motion languages shipped as examples must be authored, not
  extracted — the Hue model, where the bundled examples are invented brands.
- Copy describes *measuring* and *learning*, not *cloning* or *ripping*. The
  name buys goodwill that cloning-flavored language would spend.

### Naming collision check

`Understudy` is unusual in dev tooling, but verify before registering anything:

- Confirm npm availability; plan for a scoped package (`@yourorg/understudy`)
  if the bare name is taken.
- Confirm the domain. `.motion` is not a public TLD, so any `understudy.motion`
  idea is a non-starter — `understudy.dev` or `understudy.design` are the
  realistic targets.
- Search USPTO/EUIPO for live marks in software/design tooling before putting
  the name on anything commercial.

---

## 2. Scope

### In scope (v0.1)

- Instrumented capture of `Element.animate`, `requestAnimationFrame`, CSS
  transitions, and CSS animations.
- Scripted interaction passes: scroll, hover, click.
- Stagger recovery via start-time clustering.
- Easing recovery via cubic-bezier curve fitting against sampled progress.
- Emission of a `motion` block conforming to the output contract in §5.
- A validator extending Hue's exit-code-1-on-error convention.

### Deferred to later versions

- **Documented-rationale extraction** (§13, v0.3) — capturing stated design
  philosophy from published guidelines, engineering blogs, and talks, then
  reconciling it against measurement.
- **shadcn registry distribution** (§14, v0.4) — emitting `registry-item.json`
  so a captured motion pack installs via `npx shadcn add <url>`.

Both are specified below so the v0.1 architecture doesn't foreclose them.
Specifically: keep `emit/` free of assumptions that the only consumer is Hue,
and keep provenance on every token from day one.

### Out of scope entirely

- Generating components or applying the tokens. Downstream skills already do
  this — `motion-design` (LottieFiles), `ui-animation` (mblode), and the
  Framer Motion / GSAP skills consume tokens, they don't produce them.
- Video, Lottie, or WebGL/canvas motion.
- Any hosted service, account system, or API key. Match Hue: clone and run.

---

## 3. Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (ESM, Node 20+) | Hue is JS; stay forkable and upstreamable |
| Browser | Playwright + raw CDP session | Need `Page.addInitScript` and CDP for rAF hooks |
| Remote execution | Cloudflare Browser Rendering | Optional adapter, not required for local runs |
| Curve fitting | `fmin` or a hand-rolled Nelder–Mead | Small dep surface; avoid pulling in a math giant |
| Schema | YAML via `yaml` | Matches Hue's `design-model.yaml` |
| Tests | `node:test` + fixture pages | Zero-dep test runner; fixtures are ground truth |
| License | MIT | Required for upstream compatibility with Hue |

Keep the dependency list short. Hue has near-zero runtime deps and that is part
of why people trust it.

---

## 4. Repository layout

```
understudy/
├── SKILL.md                       # agent-facing manifest (frontmatter contract)
├── README.md
├── LICENSE                        # MIT
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   # CLI entrypoint
│   ├── capture/
│   │   ├── session.ts             # Playwright lifecycle, CDP attach
│   │   ├── instrument.ts          # the init script, injected pre-load
│   │   ├── passes/
│   │   │   ├── scroll.ts          # stepped scroll, settle-wait between steps
│   │   │   ├── hover.ts           # hover every interactive element, record delta
│   │   │   └── click.ts           # click safe targets only (see §7 safety)
│   │   └── types.ts               # MotionEvent, RawSample, CapturePass
│   ├── analyze/
│   │   ├── cluster.ts             # start-time clustering → stagger recovery
│   │   ├── bezier.ts              # sampled progress → cubic-bezier fit
│   │   ├── spring.ts              # detect overshoot, fit stiffness/damping
│   │   ├── quantize.ts            # raw ms → a small, opinionated token scale
│   │   └── personality.ts         # map measurements → archetype label
│   ├── context/                   # v0.3 — see §13
│   │   ├── sources.ts             # user-supplied source list, fetch + cache
│   │   ├── extract.ts             # LLM stage: prose → claims, with citations
│   │   └── reconcile.ts           # measured vs. documented, three-case merge
│   ├── registry/                  # v0.4 — see §14
│   │   ├── item.ts                # registry-item.json emitter
│   │   └── naming.ts              # token → CSS custom property convention
│   ├── emit/
│   │   ├── motion-yaml.ts         # the §5 output contract
│   │   ├── tokens-css.ts          # custom properties, Hue-compatible naming
│   │   └── merge.ts               # splice into an existing design-model.yaml
│   └── validate.ts                # extends Hue's validate.mjs conventions
├── scripts/
│   └── validate.mjs               # thin wrapper so it matches Hue's invocation
├── fixtures/
│   ├── stagger-120ms/             # known-good ground truth pages
│   ├── spring-overshoot/
│   ├── scroll-parallax/
│   └── raf-imperative/
└── examples/
    └── README.md                  # how to add a captured brand example
```

---

## 5. Output contract — `motion` block

This is the most important part of the spec. Everything else serves it.

The block must be splice-able into Hue's `design-model.yaml` under a top-level
`motion:` key, and must reference only tokens it defines (Hue's validator
enforces this property for color and spacing; we extend it to motion).

```yaml
motion:
  meta:
    source: "https://example.com"
    captured_at: "2026-07-23T14:02:11Z"
    confidence: 0.82          # see §6 — never omit this
    passes: [scroll, hover, click]

  primitives:
    duration:
      instant: 80
      fast: 160
      base: 240
      slow: 420
      deliberate: 700
    easing:
      standard:  [0.32, 0.72, 0, 1]
      entrance:  [0.16, 1, 0.3, 1]
      exit:      [0.7, 0, 0.84, 0]
      spring-soft:
        stiffness: 180
        damping: 24
        mass: 1
    stagger:
      tight: 40
      base: 80
      loose: 120

  semantic:
    hover-lift:      { duration: fast,  easing: standard }
    modal-enter:     { duration: base,  easing: entrance }
    list-reveal:     { duration: base,  easing: entrance, stagger: base }
    scroll-parallax: { coupling: scroll, ratio: 0.35 }

  choreography:
    - name: hero-sequence
      trigger: load
      steps:
        - { target: eyebrow,  delay: 0,   token: modal-enter }
        - { target: headline, delay: 80,  token: modal-enter }
        - { target: subhead,  delay: 160, token: modal-enter }
        - { target: cta,      delay: 280, token: modal-enter }

  personality:
    archetype: premium        # playful | premium | corporate | energetic
    evidence:
      - "median duration 240ms, above the 180ms corporate median"
      - "consistent ease-out bias; no bounce or overshoot detected"

  observed:                   # raw, unquantized — kept for auditability
    samples: 1847
    rejected: 96
    notes: "3 rAF sequences exceeded the 5s capture window; truncated"
```

### Provenance

Every token carries a `provenance` field from v0.1 onward, even while
`measured` is the only possible value. This is what makes §13 additive rather
than a schema break.

```yaml
  primitives:
    duration:
      base:
        value: 240
        provenance: measured        # measured | documented | reconciled | inferred
```

For v0.1, emit the scalar shorthand (`base: 240`) when provenance is `measured`
and the long form only when it is anything else. The parser must accept both.

### Contract rules

1. `semantic` entries reference `primitives` keys by name. Never inline a raw
   number in `semantic`. The validator enforces this.
2. `meta.confidence` is mandatory. Downstream agents must be able to tell a
   measured value from a guess.
3. `observed` is never consumed by generators. It exists so a human can audit
   why a token got the value it did.
4. Emit `spring` parameters only when overshoot is actually detected. Do not
   fabricate a spring to look sophisticated.

---

## 6. Analysis requirements

### Stagger recovery

Cluster animation start timestamps. Within a cluster, if inter-arrival deltas
have low variance, that is a stagger interval — emit it. If variance is high,
the animations are coincidental, not choreographed; do not emit.

Set a floor. Deltas under ~16ms are frame-boundary noise, not intent.

### Easing recovery

Sample each animation's progress over its lifetime, then fit a cubic-bezier by
minimizing squared error against the samples. Report fit residual. If the
residual is poor, check for overshoot (progress exceeding 1.0) and try a spring
fit instead.

### Quantization

Raw measurements will be messy — 237ms, 241ms, 238ms. Snap to a small scale.
The scale is the deliverable; the raw numbers are not. Record the pre-snap
values in `observed`.

### Confidence scoring

Confidence must reflect real uncertainty. Lower it for:

- Few samples for a given token.
- High variance within a cluster.
- Poor bezier fit residuals.
- rAF sequences truncated by the capture window.
- Pages where a large share of motion was `prefers-reduced-motion`-suppressed.

An honest 0.4 is more useful than a confident 0.9 that is wrong. Downstream
agents will treat these as authoritative.

---

## 7. Capture safety

The scripted passes drive a real browser against a real site. Constrain them.

- **Never submit forms.** Skip `<form>` descendants, `type=submit`,
  `role=button` inside forms.
- **Never click** anything matching destructive or transactional text patterns
  (buy, delete, subscribe, checkout, sign up, confirm).
- **Never authenticate.** No credential entry, ever. If a page requires login,
  capture what is public and record the limitation in `observed.notes`.
- **Stay on-origin.** Cancel navigations away from the target origin.
- **Respect `robots.txt`** and send a truthful, identifiable user-agent.
- **Rate limit.** One page at a time, with a settle delay between passes.
- **`prefers-reduced-motion`** must be set to `no-preference` during capture,
  and this must be disclosed in the README as an explicit choice.

The extraction is user-initiated against a URL the user supplies. That is the
same posture Hue and Refero already established, and it is what keeps this
clean. Do not add a crawler, a pre-indexed brand corpus, or anything that
captures sites the user did not explicitly name.

---

## 8. Validator

`scripts/validate.mjs <path-to-generated-motion-block>` — exit code 1 on any
error, matching Hue's convention exactly.

Checks:

- YAML parses.
- Every `semantic` entry resolves to an existing `primitives` key.
- No orphan tokens (defined in `primitives`, referenced nowhere).
- No raw numeric literals in `semantic` or `choreography.steps[].token`.
- `meta.confidence` present and in `[0, 1]`.
- Durations within sane human bounds (reject 0ms, reject > 3000ms for
  interaction motion — flag, don't silently clamp).
- No em-dashes in emitted prose fields. Hue's validator checks this; match it.
- Generated CSS custom properties have no undefined `var(--token)` usages.
- Every token has a `provenance` value from the allowed set.

Added in v0.3 (§13):

- Every `rationale.principles[].source` resolves to a `rationale.sources` index.
- Any principle with `quantified: false` has **not** produced a numeric token.
  This is the machine check on the never-quantize-a-vibe rule; treat a violation
  as a hard error.
- Every `divergences` entry has both `documented` and `measured` present.

Added in v0.4 (§14):

- Emitted `registry-item.json` validates against shadcn's published JSON Schema.
- No motion tokens in `cssVars.light` or `cssVars.dark`.
- Every `var(--token)` in the `css` block resolves to a key in `cssVars.theme`.

---

## 9. CLI

```bash
# capture a site, write a standalone motion block
npx understudy capture https://linear.app -o motion.yaml

# splice into an existing Hue design system
npx understudy capture https://linear.app --merge ./skills/mybrand/design-model.yaml

# validate
node scripts/validate.mjs ./motion.yaml

# capture with a longer window for scroll-heavy sites
npx understudy capture https://example.com --passes scroll --window 12000
```

---

## 10. Build order

Do these in sequence. Each step should be independently testable.

1. **Fixtures first.** Build the four `fixtures/` pages with *known* motion
   values before writing any extractor. These are the ground truth. A stagger
   of exactly 120ms in `fixtures/stagger-120ms/` means the analyzer is correct
   only if it recovers 120.
2. **Instrumentation.** `capture/instrument.ts` injected via
   `Page.addInitScript`, monkey-patching `requestAnimationFrame` and
   `Element.animate` before any page script runs. Verify against fixtures that
   every animation is seen.
3. **Scroll pass.** Stepped scroll with settle-waits. This is where the most
   brand-distinctive motion lives, so get it right before hover/click.
4. **Clustering.** Recover stagger from the fixtures. Do not proceed until
   `stagger-120ms` yields 120.
5. **Bezier fitting.** Recover easing from fixtures with known curves.
6. **Emission + validator.** The §5 contract and §8 checks.
7. **Hover and click passes.** Lower value than scroll; add once the pipeline
   is proven.
8. **Merge into Hue.** `emit/merge.ts` and an end-to-end run against a real
   site.

Ship step 6 as v0.1. Steps 7–8 are v0.2.

**v0.3** — §13. Source fetching and caching, then the LLM claim extractor with
the never-quantize-a-vibe rule enforced in the prompt *and* checked in the
validator, then `reconcile.ts`. Test the three cases against fixtures where you
control both the docs and the measured page.

**v0.4** — §14. `registry/item.ts` emitter, validate the output against
shadcn's published JSON Schema in CI, then an end-to-end install test into a
scratch shadcn project.

---

## 11. Definition of done for v0.1

- `npx understudy capture <url> -o motion.yaml` produces a valid block for at
  least three real, motion-heavy sites.
- All four fixtures recover their known values within tolerance.
- `scripts/validate.mjs` exits 1 on every malformed case in the test suite.
- README documents the rAF limitation, the confidence semantics, and the
  capture safety posture.
- MIT license, no API key, no account, `git clone` and run.

---

## 13. Documented rationale (v0.3)

Instrumentation captures *what* a brand does. It cannot capture *why*, and it
cannot capture negative rules — the things a brand deliberately refuses to
animate. Those live in published guidelines, engineering blogs, and talks.

This stage adds a second input channel and reconciles it against measurement.

### Source tiers

Ranked by signal density. The extractor should record which tier a claim came
from, because tier correlates with reliability.

| Tier | Source | Yield |
|---|---|---|
| 1 | Published motion specs (Material, Carbon, Polaris, HIG, Atlassian) | Prose *with numbers* — ideal shape |
| 2 | Design-system repos with commented tokens or ADRs | Values plus stated reasoning |
| 3 | Engineering/design blog posts | Intent behind a curve; rarely numeric |
| 4 | Conference talks, podcasts, course material | Where tacit taste gets articulated; needs transcription |

Coverage is wildly uneven and inversely correlated with how much you want it.
Material and Carbon give you a feast. The brands whose motion is most
distinctive publish least, because the motion *is* the moat. Design the stage
to degrade gracefully to zero sources.

### Hard rule: never quantize a vibe

The LLM extraction stage emits a `duration`, `easing`, or `stagger` value **only
when the source contains an actual number or an explicit comparative claim**
("faster than our previous 300ms default").

Everything else becomes a `principle` — a short paraphrase with a citation, never
a token. "We wanted it to feel effortless" is a principle. It must not become
`duration-base: 240`.

This is the same discipline as `confidence` in §6. The failure mode that kills
this stage is an LLM inventing plausible numbers from adjectives.

### Rationale block

```yaml
rationale:
  sources:
    - url: "https://m3.material.io/styles/motion/overview"
      tier: 1
      fetched_at: "2026-07-23T14:02:11Z"
    - url: "https://example.com/blog/how-we-animate"
      tier: 3
      fetched_at: "2026-07-23T14:02:19Z"

  principles:
    - claim: "Motion is used to establish spatial relationships, not decoration"
      source: 0
      quantified: false
    - claim: "Longer distances get proportionally longer durations"
      source: 0
      quantified: true
      implies: { scale: distance-proportional }

  constraints:                 # negative rules — instrumentation cannot see these
    - "Never animates data tables or dense tabular content"
    - "No motion on any element inside a form during validation"
      
  divergences:
    - token: duration-base
      documented: 200
      measured: 240
      note: "Docs may be aspirational or stale; measurement is from the live site"
      resolution: unresolved   # unresolved | prefer-measured | prefer-documented
```

### Reconciliation — three cases

1. **Agreement.** Documented value matches measurement within tolerance. Set
   `provenance: reconciled` and *raise* `meta.confidence` for that token. Two
   independent channels agreeing is the strongest signal available.
2. **Documented-only.** A stated rule with no observable instance in the captured
   pages. Emit under `constraints`, not `primitives`. Constraints are more
   valuable than tokens — they encode refusals, and no amount of instrumentation
   recovers a negative rule.
3. **Conflict.** Emit both under `divergences` with `resolution: unresolved`.
   Do not silently pick a winner. Divergence is usually informative (stale docs,
   aspirational docs, or a redesign in flight) and the human should decide.

Case 3 is a feature, not an error state. It is only possible because this
project has both channels, and nothing else does.

### Sourcing posture

- **User-named sources only.** Same rule as §7. The user supplies a source list;
  the stage does not go looking. No crawler, no pre-indexed corpus of design
  blogs.
- **Store paraphrase and citation, never verbatim excerpts.** Measured values
  are uncopyrightable facts. Prose from someone's blog or talk is protected
  expressive work — this stage carries *more* copyright exposure than the
  instrumentation stage, not less. Keep claims short, reworded, and attributed
  to a URL.
- **Cache fetched sources locally** so a re-run doesn't re-hit the origin.

---

## 14. shadcn registry distribution (v0.4)

The skill format reaches people already using Claude Code or Codex. The shadcn
registry reaches everyone using shadcn, which is a much larger surface. Same
artifact, second distribution channel.

### Emitter target

Produce a `registry-item.json` of `type: "registry:style"`. Do **not** use
`registry:base`, and do **not** set `extends: none`. A motion pack is a layer
added on top of someone's existing design system, not a replacement for it —
the default merge behavior is exactly right.

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry-item.json",
  "name": "acme-motion",
  "type": "registry:style",
  "title": "Acme Motion",
  "description": "Measured motion tokens and choreography.",
  "dependencies": ["motion"],
  "devDependencies": ["tw-animate-css"],
  "cssVars": {
    "theme": {
      "duration-instant": "80ms",
      "duration-fast": "160ms",
      "duration-base": "240ms",
      "duration-slow": "420ms",
      "ease-standard": "cubic-bezier(0.32, 0.72, 0, 1)",
      "ease-entrance": "cubic-bezier(0.16, 1, 0.3, 1)",
      "ease-exit": "cubic-bezier(0.7, 0, 0.84, 0)",
      "stagger-tight": "40ms",
      "stagger-base": "80ms"
    }
  },
  "css": {
    "@keyframes reveal-up": {
      "from": { "opacity": "0", "transform": "translateY(12px)" },
      "to": { "opacity": "1", "transform": "translateY(0)" }
    },
    "@utility animate-reveal-up": {
      "animation": "reveal-up var(--duration-base) var(--ease-entrance) both"
    }
  }
}
```

### Mapping rules

- **All motion tokens are `theme`-scoped.** Durations and easings do not change
  with color mode. Never emit motion into `cssVars.light` or `cssVars.dark`.
- **`motion.primitives` → `cssVars.theme`**, flattened with the naming
  convention below.
- **`motion.semantic` and `motion.choreography` → `css`**, as `@keyframes` plus
  `@utility` rules that reference the theme vars. This is what makes the pack
  usable rather than just declarative.
- **`motion.personality`, `rationale`, `observed`** have no registry
  representation. They stay in `design-model.yaml`. The registry item is the
  consumable subset.

### Naming convention

`--{category}-{scale}` — `duration-base`, `ease-entrance`, `stagger-tight`.
Flat, no nesting, no brand prefix. A brand prefix would collide across packs and
defeats the point of installing more than one.

### Build and install

```bash
npx understudy emit-registry ./motion.yaml -o registry/acme-motion.json
npx shadcn build                    # resolves into the public registry output
```

Consumer side:

```bash
npx shadcn@latest add https://your-registry.dev/r/acme-motion.json
```

Other registries can depend on a pack by URL via `registryDependencies`, which
is the compounding-reach mechanism.

### The corpus question — decide before building the endpoint

A hosted registry serving named brand packs is precisely the pre-indexed corpus
that §7 forbids. Retrofitting this is painful, so resolve it now.

**Required posture:** the registry serves packs that users generated from sites
they named — their own properties, their own captures. It is a hosting and
sharing surface for user output, not a gallery of extracted competitor motion.

Concretely:
- Ship **no** brand-named packs in this repo.
- Any hosted registry accepts user-submitted packs and attributes them to the
  submitter, with the source URL recorded.
- Provide a self-host path (static JSON on any origin) as the default, so the
  hosted service is a convenience and never a chokepoint.

This keeps the same user-initiated posture that has kept the whole category out
of trouble, while still getting the distribution.

---

## 15. Notes for the agent

- Do not invent a hosted component. The value here is that it runs locally
  against the user's own model, same as Hue.
- Do not skip the fixtures. An extractor without ground truth is unfalsifiable,
  and this project's entire claim is that it *measures* rather than *guesses*.
- When the analysis is uncertain, say so in `confidence` rather than smoothing
  it over. The failure mode that kills this project is plausible-looking tokens
  that are actually noise.
- Prefer upstreaming to Hue over diverging. Keep `design-model.yaml`
  compatibility as a hard constraint in every design decision.
