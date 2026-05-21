# Changelog

## 0.1.0 — 2026-05-21 — Initial release

First public release of `dhpk` — a generic, install-and-go Claude Code harness with an opt-in stack-module system and a parallel Codex CLI tree.

### Added

- **Plugin manifest** (`.claude-plugin/plugin.json`) with five `userConfig` knobs (see below).
- **Marketplace manifest** (`.claude-plugin/marketplace.json`) — single-entry catalog pointing at the repo root.
- **13 agents** under the `dhpk:` namespace (12 role-based + 1 `INDEX.md`): `architect`, `code-reviewer`, `database-reviewer`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `tdd-guide`, etc. Frontmatter descriptions are framework-agnostic; each notes the matching dhpk module for stack-specific traps.
- **74 commands** including `opsx/*` (10 OpenSpec workflow wrappers), `codex-*`, `code-review`, `create-pr`, `smart-commit`, `precommit`, `harness-audit`, `pr-review`, `feature-dev`, `feature-verify`, etc.
- **59 core skills + 5 module skills** (across 3 stack modules). Two new rules-as-skills: `tool-routing` and `dhpk-execution-policy`.
- **3 opt-in stack modules** with `module.yaml` metadata, skills, and references:
  - `php-5.6` — PHP 5.6 language baseline.
  - `yii-1.1` — Yii 1.1 framework (requires `php-5.6`).
  - `phpunit-5.7` — PHPUnit 5.7 patterns (requires `php-5.6`).
- **Sentinel-driven review hooks** (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`) with parameterised agent names, trigger paths, docker checks, and hook profile. Explicit `[hook-name] WARN: …` lines when modules are enabled but `python3` is missing.
- **8 hook scripts** under `scripts/hooks/`, including `_lib/payload.sh` (sentinel-array override via `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS`), `post-edit-remind.sh`, `post-write-crlf-fix.sh` (with `python3` JSON-parse fallback when `jq` is absent), and `install-codex-skills.sh` for dual-track Codex CLI sync (symlink default, `--copy`, `--update`, `--force`; advisory `note:` when Codex CLI binary is missing from PATH).
- **Harness scripts**: `harness-audit.js`, `precommit-runner.js`, `verify-runner.js`, `gemini-adapt-agents.js`, `dep-audit.sh`, `codemaps/generate.ts`, `validate/validate-harness.sh`, `opsx-apply-resume/*.sh`.
- **Statusline script** (`scripts/statusline/statusline.sh`) — opt-in via project `settings.json`. Renders branch, staged/modified counts, docker status, profile, active modules, pending sentinels.
- **24 codex skills + 5 codex agents** under `codex/` for dual-assistant projects.
- **`manifests/install-profiles.json`** — curated module bundles (`minimal`, `legacy-php-yii`, `php-only`, `full`).
- **`codex/AGENTS.md`** — dual-harness expectations document.
- **`docs/subagent-prompt-template.md`** — source-reading and DB-access boilerplate to paste into sub-agent prompts.

### `userConfig`

| Key | Default | Purpose |
|-----|---------|---------|
| `hook_profile` | `"standard"` | Verbosity of hook output: `minimal` \| `standard` \| `strict` |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer"]` | Three agents invoked by sentinel reminders (code, database, security) |
| `docker_containers` | `[]` | Container names checked at `SessionStart`; empty disables the check |
| `modules` | `[]` | Stack modules to enable; `requires:` validated at `SessionStart` (warning only) |
| `review_trigger_extra_paths` | `[]` | Extra path prefixes per reviewer slot, format `<slot>:<prefix>` where slot ∈ `code\|db\|sec` |

### Verification

- `claude plugin validate ~/projects/dhpk --strict` passes.
- Hook smoke tests:
  - `post-edit-remind.sh` writes `.pending-review` for a `.php` edit even with `python3` PATH-masked (extension default still fires).
  - `post-write-crlf-fix.sh` normalises CRLF with `jq` missing (`python3` fallback works).
- End-to-end install round-trip in a scratch project succeeded: `claude plugin marketplace add ~/projects/dhpk` → `claude plugin install dhpk@dhpk` → `claude plugin details dhpk` reports 127 skill+command entries, 13 agents, 4 hook events.
- `install-codex-skills.sh` populated `.codex/skills/` + `.codex/agents/` with symlinks; re-run printed `already up-to-date for dhpk v0.1.0`.

### Known limitations

- Some skill bodies and command bodies inside `skills/`, `modules/`, `codex/skills/` still reference PHP/Yii-flavored examples (e.g. `protected/`, AR patterns) without explicit "this is just an example" framing. These do not affect functionality on non-PHP projects but may confuse first-time readers. Deeper rewrites planned for v0.2.
