import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// understudy has ONE canonical skill body: the root SKILL.md. Agents that
// discover skills under `.agents/skills/` (Codex, OpenCode, Goose) read the copy
// at `.agents/skills/understudy/SKILL.md`. That copy is a REAL FILE, not a
// symlink, because Codex silently skips symlinked SKILL.md files during skill
// discovery (verified against codex-cli 0.142.3). This guard fails if the copy
// drifts from the canonical root — run `pnpm sync-skill` to regenerate it.
const canonical = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
const skillCopy = readFileSync(
  new URL('../.agents/skills/understudy/SKILL.md', import.meta.url),
  'utf8',
);

test('.agents/skills/understudy/SKILL.md stays byte-identical to canonical SKILL.md', () => {
  assert.equal(
    skillCopy,
    canonical,
    'The Codex/OpenCode/Goose skill copy drifted from root SKILL.md. Run `pnpm sync-skill`.',
  );
});
