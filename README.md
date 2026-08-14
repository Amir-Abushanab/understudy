<p align="center">
  <img src="https://raw.githubusercontent.com/Amir-Abushanab/understudy/master/docs/logo.svg" width="440" alt="understudy">
</p>

<p align="center">Measure a website's brand from the live page, then learn its feel.</p>

<p align="center">
  <a href="https://github.com/Amir-Abushanab/understudy/actions/workflows/ci.yml"><img src="https://github.com/Amir-Abushanab/understudy/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

Point it at a URL. understudy opens the page in a real browser, reads the brand off what actually rendered, and writes out design tokens and an interactive report. Your coding agent adds the qualitative feel on top, cited and checked against the measurements.

<p align="center">
  <img src="https://raw.githubusercontent.com/Amir-Abushanab/understudy/master/docs/report.png" width="820" alt="An understudy brand report: OKLCH palette, light/dark switch, and a color-format switcher.">
</p>

## What you get

- The palette (roles, light and dark), type families and scale, spacing, and radii, read from computed styles rather than guessed off a screenshot.
- Motion, which most tools skip: durations, easings, springs, stagger, and scroll choreography, including the `requestAnimationFrame` animations (GSAP, Lenis, Framer Motion) that browser dev tools can't see.
- Output as `design-model.yaml`, CSS variables, a Tailwind config, W3C DTCG tokens, or a standalone HTML report with an OKLCH palette, a hex/rgb/hsl switch, a light/dark toggle, playable easing curves, and click-to-copy.

## Install

Node 22+.

```bash
git clone https://github.com/Amir-Abushanab/understudy && cd understudy
pnpm install && pnpm exec playwright install chromium
```

## Use it

```bash
pnpm capture https://linear.app -o model.yaml                                    # tokens
pnpm capture https://linear.app --report report.html                             # + HTML report
pnpm capture https://linear.app --css t.css --tailwind t.config.js --dtcg t.json # + token formats
pnpm capture https://linear.app --rationale feel.json --report report.html       # + an authored feel
```

A slice of what a capture writes (stripe.com):

```yaml
primary_mode: light
confidence: { brand: 0.9, motion: 0.71 }
colors:
  light:                       # light and dark both appear when a site themes
    background: "#ffffff"
    text1: "#061b31"           # primary by contrast; text2 is the muted secondary
    accent: "#533afd"
typography:
  families: [ sohne-var, SourceCodePro ]
  display: { family: sohne-var, size: 48px, weight: 300, line_height: 1.15 }
spacing: [ 0, 8, 16, 24, 32, 48, 64 ]   # snapped to the detected base grid
motion:
  primitives:
    duration: { fast: 160, base: 240, slow: 420 }
    easing: { standard: [0, 0, 0.58, 1] }   # declared, cross-verified
  personality: { archetype: premium }
```

Colors are hex when opaque, `rgba(...)` when translucent. `--motion-only` writes just the motion block. Validate any output with `node scripts/validate.mjs model.yaml`. The full contract lives in [`understudy-spec.md`](./understudy-spec.md).

## From a coding agent

understudy is one `SKILL.md` that every agent reads the same way:

| Agent                | Invoke                                                          |
| -------------------- | -------------------------------------------------------------- |
| Claude Code          | `/understudy <url>`                                            |
| Codex                | `$understudy <url>`, or install the bundled plugin             |
| OpenCode / Kilo Code | auto-discovered; ask it to learn a URL's brand                 |
| Goose                | `goose run --recipe recipes/understudy.yaml --params url=<url>` |

Install it as a plugin straight from this repo:

```bash
# Claude Code
/plugin marketplace add Amir-Abushanab/understudy
/plugin install understudy@understudy

# Codex
codex plugin marketplace add Amir-Abushanab/understudy
codex plugin add understudy@understudy
```

The measuring is deterministic and costs no model tokens. The feel is the only token-heavy step: roughly **100K–300K tokens** of web research per site (`SKILL.md` has the breakdown). `pnpm verify-agents` checks the wiring for every agent at once.

## Confidence

Every capture reports how sure it is. A low `confidence` means the measurement was genuinely shaky: thin sampling, a poor curve fit, or motion that never ran during the capture window. Trust the number instead of smoothing it over.

## Name and license

An understudy learns a performance by watching, then plays the part as themselves. That's the idea here: it studies a page's timing, not its artifact, and only from URLs you supply. MIT.

Thanks to [Hue](https://github.com/dominikmartn/hue), whose schema this builds on.
