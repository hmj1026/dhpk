## Why

The `zdpos_dev` project has accumulated a mature Claude Code harness (13 agents, 70 commands, 54 skills, 8 hooks, statusline, harness scripts) over many months. Roughly two-thirds is project-agnostic, but it is bolted to one repo, so new projects either start empty or copy-paste subsets that drift over time. We need that proven harness reusable across any project, distributable as a single installable artifact, with the previously zdpos-specific bits (sentinel agent names, docker container names, hook profile env, review trigger paths) exposed as configuration. Stack-specific knowledge (PHP 5.6, Yii 1.1, PHPUnit 5.7) needs to be **independently activatable per version**, so a project picks just the modules it needs and a `php-8.2` module can be added later without disturbing the rest.

## What Changes

- Introduce a new repo `~/projects/dhpk` as a Claude Code marketplace + plugin. Other projects install via `claude plugin marketplace add ~/projects/dhpk && claude plugin install dhpk@dhpk`.
- Ship the plugin in three layers: core harness (always on), sentinel-driven review workflow (parameterised), and opt-in stack modules. Each module is a self-contained `modules/<stack>-<version>/` directory with its own `module.yaml`, skills, and references.
- v0.1.0 modules: `php-5.6`, `yii-1.1` (requires `php-5.6`), `phpunit-5.7` (requires `php-5.6`). Future modules (`php-8.2`, `nextjs-14`, `python-3.11`, etc.) follow the same template.
- Parameterise everything zdpos-specific via `userConfig`: `review_agents`, `docker_containers`, `hook_profile`, `modules`, `review_trigger_extra_paths`.
- Ship a parallel `codex/` tree (skills, agents, config example) for Codex CLI users to sync into their project `.codex/` via a one-shot helper script. Claude Code itself does NOT load `codex/`.
- Fold the existing dhpk scaffold (10 `openspec-*` skills + `commands/opsx/`) into the plugin layout (move, not duplicate).
- **DESIGN CONSTRAINT** discovered late: Claude Code plugin spec has no `rules` component — plugin-shipped `rules/*.md` does NOT auto-load. All former rule content (tool-routing, execution-policy, PHP rules) ships as either skill content or agent body content. The plan was updated to reflect this.

## Capabilities

### New Capabilities

- `plugin-manifest`: `.claude-plugin/{plugin,marketplace}.json` define the installable plugin, expose `userConfig` for project overrides, and form a one-entry marketplace pointing at `./plugins/dhpk`.
- `core-harness`: ~12 generic agents, ~68 generic commands, ~60 generic skills (including new `tool-routing` and `dhpk-execution-policy` skills that carry former rule content), harness scripts (codemaps, validate, precommit-runner, verify-runner, harness-audit, gemini-adapt-agents, dep-audit) ship as the always-on baseline. Subagent prompt template ships in `docs/`.
- `review-sentinel-workflow`: PostToolUse / Stop / SessionStart hooks plus `code-reviewer` / `database-reviewer` / `security-reviewer` agents implement a sentinel-driven review loop, with sentinel file names, trigger globs, agent names, and docker checks all parameterised via `userConfig` and exported env vars.
- `modules-architecture`: per-stack-version modules under `modules/<name>/` with `module.yaml` metadata (name, version, requires, triggers, provides). v0.1.0 ships `php-5.6`, `yii-1.1`, `phpunit-5.7`. SessionStart parses enabled modules, validates `requires`, exports `DHPK_ACTIVE_MODULES`, and announces activation. `post-edit-remind` merges each active module's triggers into its reviewer pattern set.
- `codex-dual-track`: non-auto-loaded `codex/` tree mirrors plugin skills/agents in Codex CLI format, with `scripts/hooks/install-codex-skills.sh` to copy or symlink them into a project's `.codex/` idempotently.

### Modified Capabilities

(none — this change introduces the plugin from scratch; no existing `openspec/specs/` entries to delta.)

## Impact

- **New repo content**: `~/projects/dhpk` gains `.claude-plugin/marketplace.json`, `plugins/dhpk/.claude-plugin/plugin.json`, and the full plugin directory tree (`agents/`, `commands/`, `skills/`, `modules/`, `hooks/`, `scripts/`, `docs/`, `codex/`). The existing `dhpk/.claude/{commands,skills}/openspec-*` scaffold and `dhpk/openspec/config.yaml` get folded into the new layout (existing dhpk scaffold dirs removed after move).
- **No changes to `zdpos_dev`** as part of this change. Migrating zdpos_dev to consume the plugin (and dropping its in-tree harness duplicates) is a follow-up change after the plugin proves out.
- **Source dependency on `~/projects/zdpos_dev/.claude/` and `.codex/`** as the extraction source; the plan reads from there but does not modify it.
- **External tooling assumed available**: `claude` CLI (for `plugin validate`, `plugin install`, `plugin marketplace add`), `openspec` CLI, `bash`, `python3` (for YAML parsing in hooks). `docker`, `jq` are optional and feature-detected.
- **Distribution surface**: v0.1.0 starts at version `0.1.0` in `plugin.json`; users get updates only when the field changes.
- **README + CHANGELOG** at repo root document install, userConfig, modules, statusline wiring, Codex sync, and the migration walkthrough.
