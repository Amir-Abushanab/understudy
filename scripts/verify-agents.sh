#!/usr/bin/env bash
# Re-verify understudy's cross-agent wiring in one shot.
#
# Deterministic checks (skill sync, manifest validity) always run and are hard
# failures. Live discovery checks run only for the agent CLIs that happen to be
# installed, and never mutate global state. Exit non-zero if any hard invariant
# is broken.
set -u
cd "$(dirname "$0")/.."

fail=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; }
skip() { printf '  --    %s\n' "$1"; }

echo "understudy: cross-agent verification"
echo

echo "[1] one canonical SKILL.md, every copy in sync"
for c in .agents/skills/understudy/SKILL.md plugins/understudy/skills/understudy/SKILL.md; do
  if cmp -s SKILL.md "$c"; then ok "$c"; else bad "$c drifted from root (run: pnpm sync-skill)"; fi
done

echo "[2] agent manifests are valid JSON"
for j in .claude-plugin/plugin.json plugins/understudy/.codex-plugin/plugin.json .agents/plugins/marketplace.json; do
  if node -e "JSON.parse(require('fs').readFileSync('$j','utf8'))" 2>/dev/null; then ok "$j"; else bad "$j is not valid JSON"; fi
done

echo "[3] Codex plugin + marketplace entry agree (structural)"
if node -e "const p=require('./plugins/understudy/.codex-plugin/plugin.json'),m=require('./.agents/plugins/marketplace.json');process.exit(p.name==='understudy'&&Array.isArray(m.plugins)&&m.plugins.some(x=>x.name==='understudy'&&x.source&&x.source.path==='./plugins/understudy')?0:1)" 2>/dev/null; then
  ok "plugin.json name + marketplace source path consistent"
else bad "plugin.json / marketplace.json mismatch"; fi

echo "[4] Goose recipe validates"
if command -v goose >/dev/null 2>&1; then
  if goose recipe validate recipes/understudy.yaml >/dev/null 2>&1; then ok "goose recipe validate"; else bad "goose recipe validate failed"; fi
else skip "goose not installed"; fi

echo "[5] OpenCode discovers the skill (clean isolated home)"
if command -v opencode >/dev/null 2>&1; then
  tmp="$(mktemp -d)"; mkdir -p "$tmp"/{d,s,c,h}
  # Redirect to a file, not a pipe: opencode's skill dump is >64KB and a pipe
  # truncates it (understudy sorts near the tail). Isolated XDG home dodges the
  # stale-DB "no such column: name" bug without touching the user's real state.
  XDG_DATA_HOME="$tmp/d" XDG_STATE_HOME="$tmp/s" XDG_CONFIG_HOME="$tmp/c" XDG_CACHE_HOME="$tmp/h" \
    opencode debug skill >"$tmp/skills.json" 2>/dev/null
  if grep -q 'agents/skills/understudy/SKILL.md' "$tmp/skills.json"; then
    ok "opencode debug skill lists understudy"
  else warn "opencode did not list understudy (env/DB dependent)"; fi
  rm -rf "$tmp"
else skip "opencode not installed"; fi

echo "[6] Codex registers the in-repo skill"
if command -v codex >/dev/null 2>&1; then
  if codex debug prompt-input "verify understudy" 2>/dev/null | grep -q 'understudy: Learn any website'; then
    ok "codex debug prompt-input lists understudy skill"
  else warn "codex did not register the in-repo skill (env dependent; try: codex plugin marketplace add .)"; fi
else skip "codex not installed"; fi

echo "[7] Kilo Code discovers the skill (clean isolated home)"
# Kilo's CLI is an OpenCode derivative, so it shares `debug skill` and scans
# `.agents/skills/` by default. It installs to ~/.kilo/bin and may not be on PATH.
kilo_bin="$(command -v kilo 2>/dev/null || { [ -x "$HOME/.kilo/bin/kilo" ] && echo "$HOME/.kilo/bin/kilo"; })"
if [ -n "$kilo_bin" ]; then
  tmp="$(mktemp -d)"; mkdir -p "$tmp"/{d,s,c,h}
  XDG_DATA_HOME="$tmp/d" XDG_STATE_HOME="$tmp/s" XDG_CONFIG_HOME="$tmp/c" XDG_CACHE_HOME="$tmp/h" \
    "$kilo_bin" debug skill >"$tmp/skills.json" 2>/dev/null
  if grep -q 'agents/skills/understudy/SKILL.md' "$tmp/skills.json"; then
    ok "kilo debug skill lists understudy"
  else warn "kilo did not list understudy (env dependent)"; fi
  rm -rf "$tmp"
else skip "kilo not installed"; fi

echo
if [ "$fail" -eq 0 ]; then echo "all hard checks passed"; else echo "hard-check FAILURES above"; fi
exit "$fail"
