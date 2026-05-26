# dhpk — Dev Harness Plugin Kit for Claude Code

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)

A generic, install-and-go Claude Code harness. Ships **15 role-based agents** (+ 1 module-scoped reviewer), ~65 commands (codex / gitnexus / git / project workflow), ~55 core skills + the `deploy-list` cross-project deploy file list generator, **6-slot sentinel-driven review hooks** (code / db / sec / frontend / doc / **polyfill** — the last via `library-author`), statusline, harness scripts, and **16 opt-in stack modules** across PHP (`php-5.6`, `php-7.4`, `php-8.x`), Yii (`yii-1.1`), PHPUnit (`phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11`), Laravel (`laravel-6` through `laravel-11`), JS (`js`), plus the cross-cutting `library-author` module. Modules contribute hooks at runtime via the **wrapper-dispatch** model (see [`docs/hook-extension.md`](./docs/hook-extension.md)). Parallel Codex CLI tree included for dual-assistant projects.

OpenSpec is an **optional external integration** — install the [OpenSpec plugin](https://github.com/Fission-AI/OpenSpec) separately if you want OpenSpec workflow commands. dhpk retains only its own value-add helper `opsx-apply-resume` (long-running OpenSpec session context handoff); the 10 generic OpenSpec wrapper skills/commands were unbundled in v0.2.1 since OpenSpec ships them upstream.

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

dhpk follows the standard [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins): the same marketplace + manifest is reachable from **two surfaces**, pick whichever fits your workflow:

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Inside a Claude Code session** — `/plugin marketplace add …` / `/plugin install …` (or the interactive `/plugin` browser)

Both surfaces read the same `.claude-plugin/marketplace.json` shipped in this repo, so the result is identical.

### Path A — From GitHub (recommended)

No clone needed. Fastest path for end users.

```bash
# Terminal
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk
```

```text
# …or inside Claude Code
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk@dhpk
```

Add `--config` flags to pre-seed config (skip if you'd rather answer interactively via `/dhpk:setup` after install):

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-8.x,laravel-11,phpunit-11,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

Pin a specific release by appending a version: `claude plugin install dhpk@dhpk@v0.3.2`. Available stacks/versions live in `manifests/module-catalog.json` (SSOT); curated bundles in `manifests/install-profiles.json`. Docker prerequisites: see [`docs/docker-setup.md`](./docs/docker-setup.md).

After install, reconfigure any time from inside Claude Code:

```text
/dhpk:setup           # rerun the same questions
/dhpk:setup --show    # print current effective config
```

### Path B — Local clone + interactive installer

Use this if you want an out-of-Claude shell wizard, or you'll be hacking on the plugin source. **You must `git clone` first** — the installer lives inside the repo.

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh        # interactive (gum / python3 fallback)
```

The script walks stack/version selection, docker prerequisites, review-agent overrides, and hook profile, then runs `claude plugin install` for you. Append `--dry-run` to print the resolved `claude plugin install …` command without executing it.

Validate the local checkout at any time:

```bash
claude plugin validate ~/projects/dhpk --strict
```

For live source edits during plugin development (no reinstall loop), see [§ Development](#development).

### Update / Uninstall

```bash
claude plugin update dhpk              # pull the latest version from the marketplace
claude plugin uninstall dhpk           # remove the plugin
claude plugin marketplace remove dhpk  # forget the marketplace entry
```

The same actions are available as `/plugin update dhpk`, `/plugin uninstall dhpk`, `/plugin marketplace remove dhpk` inside Claude Code.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `marketplace add` says the path doesn't exist | You followed Path B but skipped the `git clone` step | Run `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk` first — or switch to Path A which needs no clone |
| `claude plugin install dhpk@dhpk` says marketplace not found | `marketplace add` didn't run, or you removed it earlier | Re-run the `marketplace add` line from your chosen path |
| `/dhpk:*` commands or hooks don't appear after install | Session loaded its skill list before install finished | Run `/reload-plugins` inside Claude Code, or restart the session |
| `claude plugin list` shows dhpk but `/dhpk:setup` is missing | Plugin is installed but disabled | `claude plugin enable dhpk` (or `/plugin enable dhpk`) |
| `install.sh` errors on `gum` / `jq` not found | Optional UI deps missing | The script falls back to plain shell / `python3`; install `gum` and `jq` for the nicer flow, or ignore the warning |

## What you get

| Component | Count | Notes |
|-----------|------:|-------|
| Agents | 15 root + 1 module | 5 sentinel-driven reviewers (code / db / sec / **frontend** / **doc**) + the 6th `polyfill-reviewer` shipped by `library-author`. Situational: architect, tdd-guide, refactor-cleaner, ui-ux-verifier, performance-analyzer, doc-updater, docs-lookup, harness-reviser, harness-optimizer, version-matrix-impact-reviewer. |
| Commands | ~65 | `dhpk:codex-*`, `dhpk:review-pending`, `dhpk:smart-commit`, `dhpk:ts-check-status` (JS module), `dhpk:opsx-apply-resume` (needs OpenSpec), `dhpk:matrix-cell-onboard` (library-author), etc. |
| Core skills | ~55 + extras | codex-*, gitnexus, tool-routing, dhpk-execution-policy, **deploy-list** (cross-project deploy file list generator), **execution-checklist** (end-of-task self-check), `opsx-apply-resume` helpers (need OpenSpec) |
| Stack modules | 16 | PHP: `php-5.6`, `php-7.4`, `php-8.x` · Yii: `yii-1.1` · PHPUnit: `phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11` · Laravel: `laravel-6` … `laravel-11` · `js` · `library-author` (opt-in; see "Modules" below) |
| Hooks | 5 events | PreToolUse (Edit, Bash + dispatcher), PostToolUse (Edit + dispatcher + async crlf-fix), SessionStart, Stop (stop-review-reminder + reap-stale-sentinels) |
| Hook dispatchers | 2 | `post-edit-dispatch.sh`, `pre-bash-dispatch.sh` — fan out to active modules' hooks |
| Harness scripts | 5 | precommit-runner, verify-runner, harness-audit, codemap generator, dep-audit |
| Codex dual-track | 14 skills + 1 agent (5 config profiles) | Synced into project `.codex/` by `install-codex-skills.sh` |

## userConfig

Nine knobs, all settable at install time with `--config <key>=<value>`:

| Key | Default | Purpose |
|-----|---------|---------|
| `hook_profile` | `standard` | `minimal` suppresses Stop reminders; `strict` adds extra warnings |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer"]` | Five agents invoked by sentinel reminders. Override to point at your project-specific agents; shorter lists reduce coverage. (The 6th `polyfill-reviewer` slot is enabled by the `library-author` module, not via this list.) |
| `docker_containers` | `[]` | Container names checked at SessionStart. Empty list disables the check. First entry exported as `DHPK_PHP_CONTAINER`; second as `DHPK_MYSQL_CONTAINER`. |
| `modules` | `[]` | Stack modules to enable. Ships 16: `php-5.6`, `php-7.4`, `php-8.x`, `yii-1.1`, `phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11`, `laravel-6`, `laravel-7`, `laravel-8`, `laravel-9`, `laravel-10`, `laravel-11`, `js`, `library-author`. Module `requires:` validated at SessionStart (warning, not blocking). Project-level `.claude/settings.local.json` `pluginConfigs.dhpk@dhpk.options.modules` **overrides** the global value — supports a single dev machine working on projects with different stacks. |
| `review_trigger_extra_paths` | `[]` | Extra path prefixes per reviewer slot. Format: `<slot>:<prefix>` where slot ∈ `code\|db\|sec\|fe\|doc`. Example: `code:protected/`, `fe:resources/views/`. |
| `reap_stale_mcp_processes` | `false` | When `true`, SessionStart kills older `gitnexus mcp` processes (keep only newest). Only useful for gitnexus MCP users. |
| `js_lint_script` | `"lint"` | npm script invoked by the `js` module's pre-commit gate. |
| `js_typecheck_script` | `"typecheck"` | npm script invoked by the `js` module's pre-commit gate. |
| `js_check_path` | `"js/"` | Path scanned by `/ts-check-status` for `// @ts-check` rollout progress. |

Examples:

```bash
# Plain install with defaults (6-slot review chain on the default agent names).
claude plugin install dhpk@dhpk

# Legacy PHP/Yii + JS fullstack project.
claude plugin install dhpk@dhpk \
  --config modules=php-5.6,yii-1.1,phpunit-5.7,js \
  --config docker_containers=php-fpm,mysql \
  --config review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj,fe-reviewer-myproj,doc-reviewer-myproj

# Modern Laravel package library spanning Laravel 6–11 (with polyfill review).
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author
```

See `manifests/install-profiles.json` for curated module bundles.

## Skills with MCP dependencies

13 skills require the **Codex MCP server** (`mcp__codex__codex`, `mcp__codex__codex-reply`):

```
codex-architect       codex-brainstorm     codex-cli-review
codex-code-review     codex-explain        codex-implement
codex-review-doc      codex-review         codex-review-branch
codex-review-fast     codex-security       codex-test-gen
codex-test-review
```

Without Codex installed, invoking any of these will surface a tool-permission error. Install separately (see Anthropic's Codex documentation), then these become available.

All other skills (~42) have no MCP dependencies.

## Modules

A **module** is a labeled, version-tagged bundle of skills + references + hooks + trigger contributions, gated by `userConfig.modules`. Modules across the same axis (PHP / Laravel / PHPUnit) are **additive** — a library spanning Laravel 6–11 should enable each version to get cumulative guidance. Currently shipped:

**PHP language baselines** — pick the version(s) your composer `require.php` constraint spans:
- **`php-5.6`** — forbids 7.0+ syntax; polyfill guidance.
- **`php-7.4`** — typed properties, arrow functions, null coalescing assignment. Wires the **php-cs-fixer post-edit hook** + pre-commit lint + phpstan + psalm gate.
- **`php-8.x`** — readonly, enums, match, named args, attributes, first-class callable syntax.

**Frameworks**:
- **`yii-1.1`** — Yii 1.1: alias autoload, `CActiveRecord` / `CDbCriteria`, `accessRules`, XSS / CSRF defaults. Requires `php-5.6`.
- **`laravel-6`** … **`laravel-11`** — one module per major. Per-version: Eloquent / collection / cast / migration / queue / event / mail / notification / package-discovery deltas; Testbench mapping; deprecation walls.

**Testing**:
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API and patterns. Requires `php-5.6`.
- **`phpunit-9`** / **`phpunit-10`** / **`phpunit-11`** — per-major API deltas (`createMock` vs `createPartialMock`, attribute-based metadata, deprecation surface).

**Tooling / cross-cutting**:
- **`js`** — JS / TS tooling. ESLint flat-config tier strategy (Tier 1 strict / 1.5 core-exempt / 1.7 deferred-migration / globals), per-leaf `// @ts-check` rollout, async post-edit ESLint feedback, pre-commit `npm run <lint> + <typecheck>` gate. Framework-agnostic.
- **`library-author`** — Cross-cutting glue for multi-major-version PHP libraries (Laravel 6–11, Monolog 2/3, PHPUnit 8–11, Flysystem 1/3 etc.). Ships the **sixth-color** `polyfill-reviewer` agent (sentinel-driven via `.pending-polyfill-review`), the `polyfill-version-matrix-audit` skill, the `matrix-cell-onboard` skill (+ root-level `/dhpk:matrix-cell-onboard` alias), an OpenSpec artifact guard, and a dual-testsuite mapping helper. Auto-fires on `.php` edits containing runtime version guards (`version_compare`, `class_exists`, `method_exists`, `Composer\InstalledVersions::*`).

When enabled, a module:
- Surfaces its skills under `dhpk:<skill-name>` (e.g. `dhpk:php-pro`, `dhpk:yii1-security-audit`, `dhpk:js-lint-config`).
- Contributes path triggers to `post-edit-remind` so reviewers fire on framework-specific paths.
- May contribute hooks under `modules/<m>/hooks/post-edit-*.sh` and `modules/<m>/hooks/pre-{bash,commit}-*.sh`, fanned out by the dispatcher when the module is active. See [`docs/hook-extension.md`](./docs/hook-extension.md).
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

Per-module hooks are supported as of v0.2.0 via the wrapper-dispatch model. Drop scripts under `modules/<stack>-<version>/hooks/`:

- `post-edit-*.sh` — fired (backgrounded) by `scripts/hooks/post-edit-dispatch.sh` whenever the module is active.
- `pre-bash-*.sh` / `pre-commit-*.sh` — fired (synchronously, can block) by `scripts/hooks/pre-bash-dispatch.sh`.

See [`docs/hook-extension.md`](./docs/hook-extension.md) for the dispatcher contract and the worked `js` module example.

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
├── agents/                       # 15 role-based agents (INDEX.md is navigation)
├── commands/                     # ~65 slash commands (codex-*, smart-commit, opsx-apply-resume, matrix-cell-onboard, ...)
├── skills/                       # ~55 core skills (codex-*, tool-routing, dhpk-execution-policy, opsx-apply-resume helpers, ...)
├── modules/                      # 16 opt-in stack modules
│   ├── php-5.6/, php-7.4/, php-8.x/        # {module.yaml, skills/, references/, hooks/ (php-7.4 only)}
│   ├── yii-1.1/                            # Yii 1.1 framework
│   ├── phpunit-5.7/, phpunit-9/, phpunit-10/, phpunit-11/
│   ├── laravel-6/ … laravel-11/            # one per major
│   ├── js/{module.yaml, hooks/, skills/, commands/, references/}
│   └── library-author/{module.yaml, agents/, skills/, hooks/, references/}
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / Stop wiring
├── scripts/
│   ├── hooks/                    # core hooks incl. post-edit-dispatch.sh, pre-bash-dispatch.sh, reap-stale-sentinels.sh, _lib/{payload,portable-sed}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/, lib/, opsx-apply-resume/, validate/
│   └── (harness-audit, precommit-runner, verify-runner, gemini-adapt-agents, dep-audit)
├── docs/
│   ├── hook-extension.md         # wrapper-dispatch contract + module-hook authoring
│   ├── recommended-permissions.md
│   ├── docker-setup.md, subagent-prompt-template.md
├── codex/                        # Codex CLI dual-track (Claude Code does NOT auto-load)
│   ├── AGENTS.md                 # Codex-specific guidance
│   ├── README.md                 # how to sync into a project
│   ├── skills/, agents/, config.toml.example
├── manifests/install-profiles.json  # curated module bundles
├── docs/design/bootstrap-dhpk-plugin/  # original design archive (proposal/design/tasks/specs)
├── README.md, README.zh-TW.md, CHANGELOG.md, LICENSE, .gitignore
```

## Development

For iterating on the plugin source itself (no install/reinstall loop), launch Claude Code against the working tree directly:

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude --plugin-dir ~/projects/dhpk
```

Edits to plugin files take effect after `/reload-plugins` (hooks, MCP, LSP) or session restart (monitors, skill listings).

The marketplace install path (`claude plugin install`) copies the plugin into `~/.claude/plugins/cache/`, so edits to the source repo do NOT take effect there until `claude plugin update dhpk`.

## License

Released under the [MIT License](./LICENSE). Copyright (c) 2026 Paul.
