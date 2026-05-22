## Context

Source: `~/projects/zdpos_dev/.claude/` (13 agents, 70 commands, 54 skills, 8 hooks, statusline, harness scripts) and `~/projects/zdpos_dev/.codex/` (Codex CLI mirror, 35-skill subset). Roughly 65% is generic; 35% is zdpos-specific (PHP/Yii knowledge, sentinel agent names with `-zdpos_dev` suffix, docker container names `pos_php`/`pos_mysql`, `ZDPOS_HOOK_PROFILE` env, hook path triggers like `protected/` / `infrastructure/`).

Destination: `~/projects/dhpk` previously scaffolded with `.claude/{commands/opsx, skills/openspec-*}` (10 skills + 10 commands) and `openspec/{config.yaml, changes/archive, specs}`.

Constraints from Claude Code plugin reference:

- Plugin manifest at `.claude-plugin/plugin.json`; marketplace manifest at `.claude-plugin/marketplace.json`. Components live at plugin root (`agents/`, `commands/`, `skills/`, `hooks/`, `scripts/`). Hooks reference scripts via `${CLAUDE_PLUGIN_ROOT}`. `userConfig` values exported as `CLAUDE_PLUGIN_OPTION_<KEY>` to hook subprocesses.
- Path traversal forbidden after install; paths inside plugin must be relative `./...`.
- `skills:` manifest field extends the default `skills/` dir; `commands:`, `agents:` replace the default if specified.
- Marketplace `source` field must be a relative path starting with `./` and pointing at a plugin subdirectory (NOT the marketplace root itself).
- **Plugin spec has NO `rules` component**. The `InstructionsLoaded` event only fires for project-local `.claude/rules/*.md` and `CLAUDE.md`, never for plugin-shipped files. Plugin-root `CLAUDE.md` is explicitly NOT loaded.

## Goals / Non-Goals

**Goals**

- One installable artifact (`claude plugin install dhpk@dhpk`) gives a brand-new project a working, opinionated harness.
- All zdpos-coupling parameterised via `userConfig` so projects override without forking.
- Existing zdpos_dev harness can be replicated by the plugin + 3 `userConfig` overrides (`review_agents`, `docker_containers`, `modules=php-5.6,yii-1.1,phpunit-5.7`).
- Stack modules are independently activatable per version. Adding `php-8.2` is a sibling module, not a fork.
- Codex CLI users get parity content without polluting Claude Code's load path.

**Non-Goals**

- Migrating `zdpos_dev` to consume the plugin (separate follow-up change).
- Publishing to a public marketplace (local marketplace only at v0.1.0).
- Modules beyond `php-5.6`, `yii-1.1`, `phpunit-5.7` in v0.1.0; pattern is demonstrated for `node-*`, `python-*`, etc.
- LSP servers, MCP servers, themes, monitors — out of scope for v0.1.0.
- Replacing user-global `~/.claude/` content; plugin coexists.
- Per-module hooks (e.g. yii-1.1-specific PreToolUse) — deferred to v0.2.

## Decisions

### D1 — Marketplace + plugin in one repo via subdirectory layout

Plugin lives at `plugins/dhpk/`; marketplace manifest at repo root references it as `"source": "./plugins/dhpk"`. The marketplace spec rejects `"source": "."` (must be a subdirectory).

**Rationale**: Single-plugin marketplace matches user's stated preference. Subdirectory layout follows the documented marketplace pattern, leaves room for future `plugins/dhpk-experimental/` siblings.

### D2 — Layered architecture: core + review + modules (logical, not physical separation)

Core / review / modules separation is documented in README and enforced via `userConfig.modules`, not via separate plugin manifests. All three layers ship in one plugin.

**Rationale**: Plugin spec has no "optional component group" primitive. Splitting into three plugins would triple manifest surface and force cross-plugin dependency declarations.

**Trade-off accepted**: Module skills always ship on disk and contribute to always-on listing tokens (kept short to minimise cost).

### D3 — Hook parameterisation via `_lib/payload.sh` reading exported `userConfig` env vars

`_lib/payload.sh` defines `SENTINEL_NAMES` (fixed), `SENTINEL_LABELS` (fixed), `SENTINEL_AGENTS` (from `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS` with three-element default). Sentinel file names stay hardcoded (state-file names); only agent names vary per project.

### D4 — Genericise agent names by stripping `-zdpos_dev` suffix

Plugin ships agents under generic role names. Projects override via `userConfig.review_agents` pointing at their own `code-reviewer-<proj>.md`.

### D5 — Hook trigger paths: file-extension defaults + module triggers + project extras

`post-edit-remind.sh` matches on language-agnostic extensions by default; module `triggers:` (in each module's `module.yaml`) add per-stack paths; `userConfig.review_trigger_extra_paths` adds slot-prefixed (`code:`, `db:`, `sec:`) entries.

### D6 — Codex dual-track via separate `codex/` tree + sync script

`codex/` at plugin root mirrors plugin content in Codex CLI format. Claude Code does not load it. `scripts/hooks/install-codex-skills.sh` symlinks (default) or copies (`--copy`) into the project's `.codex/`, with `.codex/.dhpk-installed.json` tracking version for idempotency.

### D7 — Statusline ships as plugin script, NOT auto-wired

Plugin spec has no statusline component. `scripts/statusline/statusline.sh` ships; projects opt in by adding 3 lines to their `settings.json` referencing `${CLAUDE_PLUGIN_ROOT}/scripts/statusline/statusline.sh`.

### D8 — Plugin rules don't auto-load → ship as skills

Discovered after first plan: plugin manifest has no `rules` component. All former `rules/tool-routing.md` and `rules/dhpk-execution-policy.md` content moves into `skills/tool-routing/SKILL.md` and `skills/dhpk-execution-policy/SKILL.md`. Each has a long, trigger-keyword-rich `description:` so Claude auto-invokes when relevant. Detailed prose moves into `references/<topic>.md` referenced from SKILL.md body.

### D9 — Modules are version-tagged (`<stack>-<version>`)

Module identifier convention: `<stack>-<version>` (kebab-case). Examples: `php-5.6`, `yii-1.1`, `phpunit-5.7`, `php-8.2` (future), `nextjs-14` (future).

**Rationale**: User explicitly requested per-language separability + per-version separability. Putting the version in the module name makes alternatives (`php-5.6` vs `php-8.2`) obvious siblings rather than something nested. `requires:` chains let a `yii-1.1` module declare it needs a PHP baseline without specifying which one.

### D10 — `module.yaml` schema (flat, parseable by minimal Python)

```yaml
name: php-5.6
display_name: "PHP 5.6 Language Baseline"
version: 0.1.0
description: "..."
requires: []                       # other module names
triggers:
  code: { extensions: [".php"], paths: [] }
  db:   { extensions: [],       paths: [] }
  sec:  { extensions: [],       paths: [] }
provides:
  skills: [php-pro]
  references: [coding-style.md]
```

The hook scripts use a minimal Python YAML parser (since the shell ecosystem has no portable YAML tool and we already require Python for jq fallback). Schema is intentionally flat and shallow so the parser stays under 30 lines.

### D11 — Frontmatter strict-mode requires single-quoted description values

`claude plugin validate --strict` rejects YAML frontmatter values containing unquoted colons, brackets, or angle brackets. All copied agent/skill/command files must have their `description:`, `allowed-tools:`, and `argument-hint:` values wrapped in single quotes. A Python pass during build wraps these mechanically.

## Risks / Trade-offs

- **[Risk]** Module skills always pay token cost in always-on listing → **Mitigation**: keep `description:` fields short; documented in README.
- **[Risk]** Plugin trigger globs are coarser than zdpos's curated path list → **Mitigation**: README documents the override; yii-1.1 module ships `protected/` / `infrastructure/` triggers that replicate zdpos behaviour.
- **[Risk]** Codex content drifts from Claude content since both maintained side-by-side → **Mitigation**: future `scripts/sync-codex.sh` (v0.2); for now, manual sync at release.
- **[Risk]** Marketplace install copies plugin to `~/.claude/plugins/cache/`; local edits don't apply until `claude plugin update` → **Mitigation**: README's "Development" section says use `--plugin-dir` during iteration.
- **[Risk]** `userConfig` env-var arrays serialise to comma-joined strings; agent names containing commas would break → **Mitigation**: documented constraint; payload.sh pads short arrays to length 3 with defaults.
- **[Risk]** Some agent/command bodies still carry PHP/Yii examples from zdpos source → **Mitigation**: documented in CHANGELOG known-limitations; doesn't affect correctness, just confusion for non-PHP users; cleaned in v0.2.
- **[Trade-off]** Plugin ships ~150 files at v0.1.0 — accepted because the alternative (incremental shipping) leaves consumers in a half-working state.

## Open Questions

- Should a `scripts/sync-codex.sh` build-time helper exist now or wait until Codex content drifts? Initial recommendation: defer to v0.2.
- Should `dhpk-execution-policy` skill be auto-loaded somehow (e.g. via an agent that references it)? For v0.1.0 it relies on Claude picking up the skill from the description. Revisit if real usage shows it's missed.
- Per-module hooks (yii-1.1 contributes a PreToolUse?) — currently rejected for v0.1.0 in favour of trigger-only contribution. Reconsider when first real need surfaces.
