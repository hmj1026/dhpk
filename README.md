# dhpk — Dev Harness Plugin Kit for Claude Code

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)

A generic, install-and-go Claude Code harness. Ships ~13 role-based agents, ~74 commands (codex / openspec / gitnexus / git / project workflow), ~64 skills, sentinel-driven review hooks, statusline, harness scripts, and three opt-in stack modules (`php-5.6`, `yii-1.1`, `phpunit-5.7`). Parallel Codex CLI tree included for dual-assistant projects.

## Prerequisites

| Tool | Status | Why |
|------|--------|-----|
| `bash` | Required | All hook and helper scripts |
| `git` | Required | Sentinel/artifact path resolution; `git rev-parse --show-toplevel` |
| `python3` | Required IF you enable `modules` | Parses `module.yaml` in `post-edit-remind` and `session-start` |
| `jq` | Optional (python3 fallback exists) | Faster JSON payload extraction |
| `docker` | Optional | Only consulted when `userConfig.docker_containers` is non-empty |
| Codex MCP server | Optional | Required ONLY if you invoke the 14 `codex-*` skills (install separately) |
| Codex CLI binary | Optional | Required ONLY if you run `install-codex-skills.sh` and want Codex to actually load the synced content |

Missing optional tools degrade gracefully (the script no-ops or skips a feature). Missing required tools surface as a single-line `[hook-name] WARN: …` to stderr at SessionStart or first hook fire so you can act on them.

## Install

### Interactive (recommended)

Walks you through stack/version selection, docker prerequisites, review-agent overrides, and hook profile — then runs `claude plugin install` for you.

```bash
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh
```

Add `--dry-run` to print the resolved `claude plugin install …` command without executing it.

After install, reconfigure any time from inside Claude Code:

```
/dhpk:setup           # rerun the same questions
/dhpk:setup --show    # print current effective config
```

### Manual / non-interactive

If you already know the values:

```bash
claude plugin marketplace add ~/projects/dhpk
claude plugin install dhpk@dhpk
# or with options
claude plugin install dhpk@dhpk \
  --plugin-option modules=php-5.6,yii-1.1,phpunit-5.7 \
  --plugin-option docker_containers=php-fpm,mysql \
  --plugin-option hook_profile=standard
```

Available stacks/versions are declared in `manifests/module-catalog.json` (SSOT). Curated bundles in `manifests/install-profiles.json`. Docker prerequisites: see [`docs/docker-setup.md`](./docs/docker-setup.md).

Validate the manifests at any time:

```bash
claude plugin validate ~/projects/dhpk --strict
```

For plugin development, see [§ Development](#development).

## What you get

| Component | Count | Notes |
|-----------|------:|-------|
| Agents | 13 | `dhpk:code-reviewer`, `dhpk:tdd-guide`, `dhpk:architect`, etc. (1 INDEX.md is navigation-only) |
| Commands | ~74 | `dhpk:opsx:*`, `dhpk:codex-*`, `dhpk:create-pr`, `dhpk:smart-commit`, etc. |
| Core skills | ~59 | openspec-*, codex-*, gitnexus, tool-routing, dhpk-execution-policy, etc. |
| Stack modules | 3 | `php-5.6`, `yii-1.1`, `phpunit-5.7` (opt-in; see "Modules" below) |
| Hooks | 5 events | PreToolUse (Edit, Bash), PostToolUse (Edit + async crlf-fix), SessionStart, Stop |
| Harness scripts | 5 | precommit-runner, verify-runner, harness-audit, codemap generator, dep-audit |
| Codex dual-track | 24 skills + 5 agents | Synced into project `.codex/` by `install-codex-skills.sh` |

## userConfig

Five knobs, all settable at install time with `--plugin-option <key>=<value>`:

| Key | Default | Purpose |
|-----|---------|---------|
| `hook_profile` | `standard` | `minimal` suppresses Stop reminders; `strict` adds extra warnings |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer"]` | Agents invoked by sentinel reminders. Override to point at your project-specific agents. |
| `docker_containers` | `[]` | Container names checked at SessionStart. Empty list disables the check. First entry exported as `DHPK_PHP_CONTAINER`; second as `DHPK_MYSQL_CONTAINER`. |
| `modules` | `[]` | Stack modules to enable. Ships: `php-5.6`, `yii-1.1`, `phpunit-5.7`. Module `requires:` validated at SessionStart (warning, not blocking). |
| `review_trigger_extra_paths` | `[]` | Extra path prefixes per reviewer slot. Format: `<slot>:<prefix>` where slot ∈ `code|db|sec`. Example: `code:protected/`. |

Examples:

```bash
# Plain install with defaults.
claude plugin install dhpk@dhpk

# PHP/Yii project setup.
claude plugin install dhpk@dhpk \
  --plugin-option modules=php-5.6,yii-1.1,phpunit-5.7 \
  --plugin-option docker_containers=php-fpm,mysql \
  --plugin-option review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj
```

See `manifests/install-profiles.json` for curated module bundles.

## Skills with MCP dependencies

14 skills require the **Codex MCP server** (`mcp__codex__codex`, `mcp__codex__codex-reply`):

```
codex-architect       codex-brainstorm     codex-cli-review
codex-code-review     codex-explain        codex-implement
codex-review-doc      codex-review         codex-review-branch
codex-review-fast     codex-security       codex-test-gen
codex-test-review     codex-test-review
```

Without Codex installed, invoking any of these will surface a tool-permission error. Install separately (see Anthropic's Codex documentation), then these become available.

All other skills (~50) have no MCP dependencies.

## Modules

A **module** is a labeled, version-tagged bundle of skills + references + trigger contributions, gated by `userConfig.modules`. v0.1.0 ships:

- **`php-5.6`** — PHP 5.6 language baseline. Forbids 7.0+ syntax; polyfill guidance.
- **`yii-1.1`** — Yii 1.1 framework: autoload, AR/CDbCriteria, DDD layering, XSS/CSRF defaults. Requires `php-5.6`.
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API and patterns. Requires `php-5.6`.

When enabled, a module:
- Surfaces its skills under `dhpk:<skill-name>` (e.g. `dhpk:php-pro`, `dhpk:yii1-security-audit`).
- Contributes path triggers to `post-edit-remind` so reviewers fire on framework-specific paths.
- Prints a SessionStart activation line so Claude knows the module is in scope.

### Adding a new module

```bash
mkdir -p modules/<stack>-<version>/{skills,references}
cat > modules/<stack>-<version>/module.yaml <<'EOF'
name: <stack>-<version>
display_name: "..."
version: 0.1.0
description: "..."
requires: []
triggers:
  code: { extensions: [], paths: [] }
  db:   { extensions: [], paths: [] }
  sec:  { extensions: [], paths: [] }
provides:
  skills: []
EOF
```

Add at least one `modules/<stack>-<version>/skills/<name>/SKILL.md`. Then register the path in `.claude-plugin/plugin.json`:

```json
"skills": [..., "./modules/<stack>-<version>/skills/"]
```

Bump plugin `version` in the manifest. Run `claude plugin validate ~/projects/dhpk --strict`. Document the module in this README.

Per-module hooks (e.g. a yii-1.1-specific pre-edit guard) are not supported in v0.1.0; the design accommodates them in a future release.

### External-path placeholders in module references

Module `references/*.md` may contain placeholders for project-specific paths:

- `<framework-source>` — local checkout of the framework source (e.g. Yii framework).
- `<project-root>` — your project root.
- `<container-workdir>` — the `-w` working dir inside the docker container.
- `<docker-bind-mount>` — host path bind-mounted into the container.

Replace these in your project's notes when you reference module content.

## Wire the statusline

The plugin spec has no statusline component; opt in manually by adding to your project's `.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline/statusline.sh"
  }
}
```

The statusline renders `[branch] +staged ~modified | docker:status | profile=<p> | mod=<active> | ⚠ <pending-sentinels>` and falls back to the global `~/.claude/statusline.sh` for tokens/model/rate-limit lines.

## Sync Codex CLI content

Projects using both Claude Code and Codex CLI:

```bash
# From any project root:
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

Symlinks (default) or copies (`--copy`) the plugin's `codex/{skills,agents}` into the project's `.codex/`. Idempotent — re-run with `--update` after a plugin version bump. See `codex/AGENTS.md` and `codex/README.md` for the dual-harness model.

## Migrating an existing project

If the project already has its own `.claude/` harness, follow the phased plan:

1. **Phase A — baseline**: snapshot pre-install hook outputs and test results.
2. **Phase B — install (parallel)**: install the plugin with `userConfig.review_agents` pointing at the project's existing agents. Both sets of hooks fire side-by-side.
3. **Phase C — discovery**: confirm `/agents` and `/plugin details dhpk` show expected components.
4. **Phase D — hook parity**: diff plugin-side sentinels vs project-side. Document any expected differences.
5. **Phase E — cutover**: disable the project's in-tree hooks via `.claude/settings.local.json` (`"hooks": {}`); run regression tests.
6. **Phase F — cleanup**: delete project files now provided by the plugin; keep project-specific overrides.

Each phase has a rollback gate. Tag `pre-dhpk-migration` before deleting anything.

## Repository layout

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # one-entry marketplace (plugins[0].source: "./")
│   └── plugin.json               # plugin manifest with userConfig
├── agents/                       # 13 role-based agents (INDEX.md is navigation)
├── commands/                     # ~74 slash commands incl. opsx/
│   └── opsx/                     # 10 OpenSpec workflow wrappers
├── skills/                       # ~59 core skills (openspec-*, codex-*, tool-routing, dhpk-execution-policy, ...)
├── modules/                      # opt-in stack modules
│   ├── php-5.6/{module.yaml, skills/, references/}
│   ├── yii-1.1/...
│   └── phpunit-5.7/...
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / Stop wiring
├── scripts/
│   ├── hooks/                    # 8 hook scripts (incl. _lib/payload.sh, install-codex-skills.sh)
│   ├── statusline/statusline.sh
│   ├── codemaps/, lib/, opsx-apply-resume/, validate/
│   └── (harness-audit, precommit-runner, verify-runner, gemini-adapt-agents, dep-audit)
├── docs/subagent-prompt-template.md
├── codex/                        # Codex CLI dual-track (Claude Code does NOT auto-load)
│   ├── AGENTS.md                 # Codex-specific guidance
│   ├── README.md                 # how to sync into a project
│   ├── skills/, agents/, config.toml.example
├── manifests/install-profiles.json  # curated module bundles
├── openspec/                     # this repo's own OpenSpec config + changes
├── README.md, README.zh-TW.md, CHANGELOG.md, LICENSE, .gitignore
```

## Development

For iterating on the plugin itself, use `--plugin-dir` to load in-place:

```bash
claude --plugin-dir ~/projects/dhpk
```

Edits to plugin files take effect after `/reload-plugins` (hooks, MCP, LSP) or session restart (monitors, skill listings).

The marketplace install path (`claude plugin install`) copies the plugin into `~/.claude/plugins/cache/`, so edits to the source repo do NOT take effect there until `claude plugin update dhpk`.

## License

Released under the [MIT License](./LICENSE). Copyright (c) 2026 Paul.
