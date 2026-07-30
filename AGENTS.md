# understudy — for coding agents

understudy learns a website's brand identity: a bundled Node CLI **measures** the
ground truth (color, typography, spacing, motion) from the live page, and the
agent **learns** the feel on top from the brand's own design writing, reconciled
against the measurement.

The full workflow is one skill, shared by every agent: read **`SKILL.md`** at the
repo root and follow it. It is the single source of truth for the recipe, the
rationale contract, and the never-quantize-a-vibe rule.

- **Codex:** the skill is discovered at `.agents/skills/understudy/SKILL.md` (a
  real copy of the canonical root `SKILL.md`, kept in sync by `pnpm sync-skill`;
  it is not a symlink because Codex skips symlinked skill files). Invoke it
  explicitly with `$understudy <url>`, or Codex may select it implicitly when a
  task matches its description. It also ships as an installable Codex plugin
  (`.agents/plugins/marketplace.json` + `plugins/understudy/`): `codex plugin
  marketplace add <repo>` then `codex plugin add understudy@understudy`.
- **Claude Code:** the same skill ships as a plugin
  (`.claude-plugin/plugin.json`), invoked as `/understudy <url>`.
- **Goose:** run `goose run --recipe recipes/understudy.yaml --params
  url=<url>`. The recipe defers to this same `SKILL.md` (no duplicated workflow)
  and uses the builtin `developer` extension for shell access.
- **OpenCode and Kilo Code:** both scan `.agents/skills/` by default and
  discover the skill with no extra wiring; ask the agent to learn a URL's brand.

The CLI itself is plain Node and agent-agnostic — `node dist/index.js capture
<url>` runs anywhere, with or without an agent. Build it once with `pnpm install
&& pnpm exec playwright install chromium && pnpm build`.
