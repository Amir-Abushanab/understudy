---
description: Measure a site's brand (color, type, spacing, motion) and synthesize its feel from sources.
argument-hint: <url> [source urls...]
---

Run the **understudy** skill on `$ARGUMENTS`.

The full recipe, the rationale contract, and the never-quantize-a-vibe rule live
in the skill's `SKILL.md` (the single source of truth, shared with every agent).
Follow it end to end: ready the tool, `capture` the URL to measure ground truth,
read the brand's own design writing to learn the feel, write `rationale.json`,
`context`-reconcile it against the measurement, and hand back `model.yaml` +
`report.html` + `tokens.css`.

The division of labor is the point: the tool measures the objective ground truth;
you learn the qualitative layer on top. Measurement keeps you honest — do not
restate measured values as if you guessed them, and never turn an adjective into
a token.
