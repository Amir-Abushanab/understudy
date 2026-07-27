import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// understudy has ONE canonical skill body: the root SKILL.md. Every other copy
// is a generated artifact kept byte-identical to it by `pnpm sync-skill`. They
// are REAL FILES, not symlinks, because Codex silently skips symlinked SKILL.md
// files during skill discovery (verified against codex-cli 0.142.3). This guard
// fails if any copy drifts from the canonical root.
//
//   .agents/skills/understudy/SKILL.md          project-local skill discovery
//                                               (Codex/OpenCode/Goose, in-repo)
//   plugins/understudy/skills/understudy/SKILL.md  the Codex marketplace plugin's
//                                               bundled skill (installed globally)
const canonical = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
const copies = {
  'project-local skill': '../.agents/skills/understudy/SKILL.md',
  'Codex plugin skill': '../plugins/understudy/skills/understudy/SKILL.md',
};

for (const [label, rel] of Object.entries(copies)) {
  test(`${label} stays byte-identical to canonical SKILL.md`, () => {
    const copy = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(
      copy,
      canonical,
      `${rel} drifted from root SKILL.md. Run \`pnpm sync-skill\`.`,
    );
  });
}
