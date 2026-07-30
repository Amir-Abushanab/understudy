# understudy

**Drive a real browser to measure a site's whole brand identity, color,
typography, spacing, radii, and motion, and emit a `design-model.yaml`.**

Point understudy at a URL. It loads the page in a real, instrumented browser and
reads the brand off the rendered result: the color palette with roles and
light/dark modes, the type families and scale, the spacing and radius scales, and,
uniquely, the **motion** — measured, not guessed.

Reading the *computed* values (rather than inferring them from a screenshot) is
more accurate, especially for CSS-in-JS with hashed class names. And motion is the
part nobody else measures: static analysis cannot see the stagger intervals, scroll
choreography, spring parameters, and requestAnimationFrame sequences where premium
motion lives. understudy instruments the animation APIs and recovers them.

The output is a `design-model.yaml` that also splices into
[Hue](https://github.com/dominikmartn/hue)'s schema (`--merge`), so understudy can
stand alone or fill Hue's `motion` slot.

## On the name

An understudy learns a performance by watching it closely, then performs the part
as themselves. That is the relationship this tool has to a page it captures: it
studies the technique, the timing and pacing and choreography, not the artifact. It
recovers the timing discipline underneath a page, not the page. Apprentices in a
Renaissance workshop copied the master's drawings before composing anything of
their own; imitation was the curriculum. That is the reading here.

Concretely, that framing obligates a few things, and they are load-bearing:

- understudy extracts only from URLs **you** supply. It ships no library of
  pre-extracted brand packs and hosts no corpus.
- The repo contains no brand-named artifacts. The bundled examples are invented
  brands with authored motion languages, never extracted ones.
- Measured timings are uncopyrightable facts. This tool measures and learns; it
  does not clone or reproduce.

## Why this is hard (and didn't exist)

- Chrome DevTools' Animations panel does not support `requestAnimationFrame`
  animations. GSAP, Lenis, and Framer Motion's imperative API all run on rAF. That
  is exactly where distinctive brand motion lives.
- The web has no native concept of a grouped animation. Choreography is emergent
  from many independently scheduled animations. Stagger has to be recovered
  statistically, not read off.
- Production sites ship CSS-in-JS with hashed class names, so the source
  `@keyframes` are often gone. The computed, observed values are the only reliable
  source.

understudy's answer to all three: **measure the result, not the mechanism.** It
samples the moving properties frame by frame and reconstructs the timing from the
samples, so rAF motion is as visible as a CSS transition.

## Install

Requires Node 20+. Clone and run; there is no account, no API key, no hosted
service.

```bash
git clone <this-repo> understudy && cd understudy
pnpm install                       # or: npm install
pnpm exec playwright install chromium
```

No build step is needed to use it: `pnpm dev` runs straight from the TypeScript
source. Run `pnpm build` only when you want the compiled `dist/` and the
`understudy` binary on your PATH.

## Quickstart

```bash
# capture a site, write a standalone motion block
pnpm capture https://linear.app -o motion.yaml

# splice directly into an existing Hue design system
pnpm capture https://linear.app --merge ./skills/mybrand/design-model.yaml

# scroll-heavy site: scroll pass only, longer window
pnpm capture https://example.com --passes scroll --window 12000

# also emit CSS custom properties
pnpm capture https://example.com -o motion.yaml --css tokens.css

# any other subcommand or flag: pnpm dev <args>
pnpm dev validate ./motion.yaml

# validate a block (exit code 1 on any error, matching Hue)
node scripts/validate.mjs ./motion.yaml
```

`pnpm capture ...` is shorthand for `pnpm dev capture ...`. After `pnpm build`
(or a global install / `npm link`) the same commands are available as
`understudy capture ...`.

## Use it from your coding agent

understudy is one canonical `SKILL.md` plus a plain-Node CLI. The CLI measures
the ground truth; your agent learns the feel on top and reconciles it against the
measurement (`understudy context`). The same skill rides several agents through
thin, generated entry points:

| Agent           | Entry point                                     | Invoke                                                            |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Claude Code     | `.claude-plugin/plugin.json` + `commands/`      | `/understudy <url>`                                               |
| Codex (skill)   | `.agents/skills/understudy/`                    | `$understudy <url>`                                              |
| Codex (plugin)  | `plugins/understudy/` + `.agents/plugins/`      | `codex plugin marketplace add .` then `codex plugin add understudy@understudy` |
| OpenCode        | `.agents/skills/understudy/`                    | auto-discovered; ask it to learn a URL's brand                   |
| Kilo Code       | `.agents/skills/understudy/`                    | auto-discovered by default; ask it to learn a URL's brand       |
| Goose           | `recipes/understudy.yaml`                       | `goose run --recipe recipes/understudy.yaml --params url=<url>`  |

The workflow, the rationale contract, and the never-quantize-a-vibe rule live in
exactly one place: the root `SKILL.md`. Every discovery copy is generated from it
by `pnpm sync-skill` and guarded against drift by the test suite. The copies are
real files, not symlinks, because Codex skips symlinked skill files.

Re-verify all the wiring at once (skill sync, manifest validity, and live
discovery for whichever agent CLIs are installed, without mutating global state):

```bash
pnpm verify-agents
```

## What it emits

A `design-model.yaml`: the brand dimensions plus the `motion` block. Real output,
abbreviated (from stripe.com and react.dev):

```yaml
name: Stripe
source: "https://stripe.com"
primary_mode: light
confidence: { brand: 0.9, motion: 0.71 }
colors:
  light:                       # both `light` and `dark` when a site themes
    background: "#ffffff"
    surface: "#e5edf5"
    text1: "#061b31"           # primary, by contrast; text2 is the muted secondary
    text2: "#50617a"
    accent: "#533afd"          # from buttons, links, and gradients
    border: "#e5edf5"
typography:
  families: [ sohne-var, SourceCodePro ]
  scale: [ 8, 12, 14, 16, 18, 22, 26, 32, 48 ]
  weights: [ 300, 400, 500 ]
  display: { family: sohne-var, size: 48px, weight: 300, line_height: 1.15 }
  body:    { family: sohne-var, size: 16px, weight: 300, line_height: 1.4 }
spacing: [ 0, 8, 16, 24, 32, 40, 64, 80, 96 ]   # snapped to the detected base grid
radii: [ 0, 2, 4, 6, 8, 16 ]
shadows: [ "rgba(50, 50, 93, 0.12) 0px 16px 32px 0px", ... ]
motion:
  meta: { confidence: 0.71, passes: [scroll] }
  primitives:
    duration: { fast: 160, base: 240, slow: 420 }
    easing:
      standard: [0, 0, 0.58, 1]              # declared value, cross-verified
      spring-soft: { stiffness: 200, damping: 12, mass: 1 }
    stagger: { loose: 120 }
  semantic:
    list-reveal:     { duration: base, easing: standard, stagger: loose }
    scroll-parallax: { coupling: scroll, ratio: 0.35 }
  personality: { archetype: premium, evidence: [ ... ] }
  observed:
    notes: "cross-verified 19 of 33 motions against declared CSS or WAAPI timing"
```

Colors are hex when opaque and `rgba(...)` when translucent (so hairline borders
keep their alpha). Motion tokens carry provenance: `measured` values use the scalar
shorthand shown; any other provenance uses the long form
`{ value: 240, provenance: reconciled }`, and the parser accepts both. Use
`--motion-only` to emit just the `motion:` block. The motion contract is detailed
in [`understudy-spec.md`](./understudy-spec.md) section 5.

## How it works

1. **Instrument** (`src/capture/instrument.ts`), injected before any page script.
   It patches `Element.animate`, watches transition and animation events, and, most
   importantly, runs a per-frame sampling loop that records the computed transform
   and opacity of any element whose style is changing. That sampling loop is what
   sees rAF, GSAP, and Lenis motion.
2. **Passes** (`src/capture/passes/*`): stepped scroll, hover, and safe clicks, with
   a settle delay between steps.
3. **Snapshot** (`src/capture/snapshot.ts`): once motion is frozen, force each
   color scheme (`emulateMedia`) and read the computed styles of every visible
   element, so the brand is captured in light and dark.
4. **Recover** (`src/analyze/*`, `src/brand/*`): cluster start times into staggers,
   prefer declared easings and fit rAF ones, detect springs; and resolve the color
   palette by role, the type/spacing/radius scales, weighted by rendered area.
5. **Emit** (`src/emit/*`): the full `design-model.yaml`, motion CSS custom
   properties, or an in-place merge of the motion block into an existing model.

## Confidence

`meta.confidence` is mandatory and reports real uncertainty. It is lowered for thin
sampling, high within-cluster variance, poor bezier fit residuals, rAF sequences
truncated by the capture window, and pages where motion was suppressed by
`prefers-reduced-motion`. An honest 0.4 is more useful than a confident 0.9 that is
wrong, because downstream agents treat these tokens as authoritative. If you see a
low number, the measurement was genuinely uncertain; do not paper over it.

## The rAF caveat, stated plainly

understudy measures the observed result of motion, not the code that produced it.
That has limits worth knowing:

- Motion shorter than a couple of frames may be missed by the sampler.
- Motion that never runs during capture (off-screen, behind auth, or gated on an
  interaction the safe passes will not perform) is not measured. Such limits are
  recorded in `observed.notes`.
- The recovered easing is a best fit to what was sampled, reported with a residual.
  When the residual is poor and the motion overshoots, a spring is fit instead; when
  it overshoots but fits nothing well, confidence drops rather than a shape being
  invented.

## Capture safety

The passes drive a real browser against a real site, so they are constrained
(`src/capture/safety.ts`):

- **Never submit forms.** Anything inside a `<form>`, and submit or reset controls,
  is skipped.
- **Never click destructive or transactional text** (buy, delete, checkout,
  subscribe, sign up, confirm, and similar).
- **Never authenticate.** No credential entry, ever. If a page needs login,
  understudy captures what is public and records the limitation.
- **Stay on-origin.** Top-level navigations away from the target origin are
  cancelled.
- **Respect `robots.txt`** and send a truthful, identifiable user-agent.
- **One page at a time**, with a settle delay between passes.
- **`prefers-reduced-motion` is forced to `no-preference` during capture.** This is
  a deliberate choice: the goal is to measure the brand's real motion. It is
  disclosed here because it is the one place understudy asks the page to behave as
  if the visitor had not opted out.

The extraction is user-initiated against a URL you name. There is no crawler and no
pre-indexed corpus, by design.

## Scope

In scope for this version: instrumented capture of `Element.animate`,
requestAnimationFrame, CSS transitions and animations; scroll, hover, and click
passes; stagger recovery; easing and spring fitting; the `motion` block and its
validator.

Out of scope: generating or applying components (downstream skills do that), and
video, Lottie, or WebGL/canvas motion. Deferred to later versions: capturing stated
design rationale from published guidelines and reconciling it against measurement,
and shadcn registry distribution. Both are specified so this version does not
foreclose them.

## Validate

```bash
node scripts/validate.mjs ./motion.yaml    # or a tokens.css file
```

Exit code 1 on any error, 0 otherwise, matching Hue's convention. Checks include
semantic references resolving to real primitives, no raw numbers where a token name
belongs, `meta.confidence` present and in range, durations within human bounds, no
em-dashes in prose, provenance on every token, and no undefined `var(--token)`
usages in generated CSS.

## A note on the name's availability

The bare npm name `understudy` is already taken by an unrelated package, so a
published build would ship scoped (for example `@yourorg/understudy`) while keeping
the `understudy` command name. Nothing here is published; this is a clone-and-run
tool. Confirm a domain (`.motion` is not a public TLD; `understudy.dev` or
`understudy.design` are the realistic targets) and search USPTO/EUIPO for live marks
before putting the name on anything commercial.

## License

MIT. Chosen for upstream compatibility with Hue.
