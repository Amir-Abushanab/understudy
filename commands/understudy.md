---
description: Measure a site's brand (color, type, spacing, motion) and synthesize its feel from sources.
argument-hint: <url> [source urls...]
---

Run understudy on `$ARGUMENTS` to produce a full brand model plus a synthesized "feel". The division of labor is the point: the **tool measures** the objective ground truth, and **you (the assistant) learn** the qualitative layer on top. Measurement keeps you honest; do not restate measured values as if you guessed them.

## Steps

1. **Ready the tool.** From the understudy repo: if `dist/` is missing, run `pnpm install && pnpm exec playwright install chromium && pnpm build`.

2. **Measure** (deterministic, no guessing):
   `node dist/index.js capture <url> -o model.yaml --report report.html --css tokens.css`
   Read `model.yaml`: the measured palette (per light/dark), typography (families, scale, weights, label role, measure), spacing/radii, gradients, shadows, motion (durations, easings, springs, choreography), the logo, the accessibility audit, and `confidence`. These are ground truth.

3. **Learn the feel** (your job):
   - Find sources on the brand's design philosophy: any URLs the user supplied, otherwise search for the brand's design principles, its engineering/design blog, brand guidelines, and recent talks. Prefer the brand's own writing (tier 1-2) over third-party (tier 3-4).
   - Read them with WebFetch.
   - Write `rationale.json` conforming to the contract below.

4. **Reconcile + merge:** `node dist/index.js context model.yaml rationale.json -o model.yaml`. This compares any documented numbers to the measured tokens (agreement is reconciled; a real conflict becomes a `divergence` left unresolved; documented-only stays a constraint) and splices in the `rationale:` block. It re-validates.

5. **Regenerate the report** so it opens with the feel, and hand back `model.yaml` + `report.html` + `tokens.css`.

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

Emit a `documented` number ONLY when a source states an actual number or an explicit comparative ("faster than our previous 300ms default"). Everything qualitative is a `principle` (a short, reworded, cited claim) or a `constraint` (a negative rule) — never a fabricated token. The failure mode that kills this stage is inventing plausible numbers from adjectives. Paraphrase, never quote verbatim; attribute every claim to a source by index. No em-dashes in emitted prose. The validator enforces these.
