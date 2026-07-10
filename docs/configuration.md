# Configuration Reference

> **Languages**: **English** · [繁體中文](./configuration.zh-TW.md)

dhpk exposes **45 `userConfig` knobs** in `.claude-plugin/plugin.json`. This page documents every knob: where you set it, what values it accepts, and what it actually changes. For the day-to-day command flow (install, common workflows, review cycle), see [`docs/basic-operations.md`](./basic-operations.md).

## Where to set a value

There are three places a knob's value can come from, in increasing precedence:

1. **Plugin default** — baked into `.claude-plugin/plugin.json`, applies if you never touch the knob.
2. **Install-time `--config`** — set once at install, stored as the plugin's global config:
   ```bash
   claude plugin install dhpk@dhpk \
     --config modules=php-8.x,laravel-11,phpunit-11,library-author \
     --config docker_containers=php-fpm,mysql \
     --config hook_profile=standard
   ```
   Multi-value knobs (`multiple: true` below) take a comma-separated list.
3. **Project-level override** — a consuming project's `.claude/settings.local.json` (or `settings.json`) can override specific knobs per-project via:
   ```json
   {
     "pluginConfigs": {
       "dhpk@dhpk": {
         "options": {
           "modules": ["php-7.4", "laravel-10"]
         }
       }
     }
   }
   ```
   This is documented and confirmed for `modules` (lets one dev machine run different stacks per project) — the same `pluginConfigs.dhpk@dhpk.options.<key>` path applies to any knob since it's a general plugin-config override mechanism, not a `modules`-specific special case.

Reconfigure or inspect the effective config at any time from inside Claude Code:

```text
/dhpk:setup           # rerun the same install questions
/dhpk:setup --show    # print current effective config
```

A handful of boolean/mode knobs additionally support a **one-shot environment-variable override** for a single session — see the "Env override" column below.

## Core dispatch & review

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `hook_profile` | string | `standard` | `minimal` \| `standard` \| `strict` | Verbosity of hook output. `minimal` suppresses Stop reminders; `strict` adds extra warnings. |
| `review_agents` | string[] | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer","polyfill-reviewer","migration-reviewer"]` | any 7 agent names | Agents invoked by sentinel reminders, in slot order (code, db, sec, frontend, doc, polyfill, migration). Override to point at project-specific agent names; shorter overrides are padded with the defaults for the remaining slots. Slots 5–6 (polyfill, migration) only fire when opted in — polyfill via the `library-author` module, migration via module triggers or a `mig:` extra path. |
| `deep_reasoner_model` | string | `opus` | `haiku` \| `sonnet` \| `opus` (whatever the running Claude Code version supports) | Model tier for `dhpk:deep-reasoner` Agent-call dispatches (reasoning-heavy implementation work). Applied per dispatch via the Agent call's `model` param when it differs from the agent's frontmatter default. Invalid value warns once per session and falls back to the frontmatter default — never fails the dispatch. |
| `fast_worker_model` | string | `sonnet` | same as above | Model tier for `dhpk:fast-worker` Agent-call dispatches (mechanical implementation work). Same validation/fallback behavior as `deep_reasoner_model`. |
| `planner_model` | string | `opus` | same as above | Model tier for `dhpk:planner` Agent-call dispatches (the opt-in `/dhpk:do --plan` pre-implementation critique / post-implementation warm review). Same validation/fallback behavior as `deep_reasoner_model`. |
| `deep_reasoner_effort` | string | `high` | `low` \| `medium` \| `high` \| `xhigh` \| `max` (whatever the running Claude Code version supports) | Reasoning effort for `dhpk:deep-reasoner` Agent-call dispatches. Applied per dispatch via the Agent call's `effort` param when it differs from the agent's frontmatter default. Invalid value warns once per session and falls back to the frontmatter default — never fails the dispatch. |
| `fast_worker_effort` | string | `medium` | same as above | Reasoning effort for `dhpk:fast-worker` Agent-call dispatches. Same validation/fallback behavior as `deep_reasoner_effort`; the decision layer (`deep-reasoner`) runs higher effort and execution (`fast-worker`) de-escalates. |
| `planner_effort` | string | `high` | same as above | Reasoning effort for `dhpk:planner` Agent-call dispatches. Same validation/fallback behavior as `deep_reasoner_effort`; the warm-review (post-implementation) invocation de-escalates to `medium`. |
| `orchestration_dispatch` | string | `on` | `on` \| `off` | Kill switch for the Implementation dispatch table (`deep-reasoner` / `fast-worker` routing in `feature-dev`, `bug-fix`, `adaptive-dev-workflow`, `opsx-apply-goal`). `on` routes implement-phase work through the decision table and prohibits `general-purpose` for implementation. `off` fully restores pre-v0.22.0 behavior: inline implementation, no dispatch prohibition, byte-identical `opsx-apply-goal` output. |
| `subagent_quality_gate` | string | `off` | `on` \| `off` | Enables `scripts/hooks/subagent-stop-quality.sh`, a `SubagentStop` hook that blocks-and-continues a subagent once when its final report is thin, a bare approval, an unresolved error with no next-step language, or an evidence-free review-shaped reply — wired ahead of `subagent-stop-verify.sh` so a blocked reviewer's sentinel is not auto-cleared. Default `off` (no-op, no heuristic evaluation). Extraction hit/miss is recorded to `.claude/artifacts/sessions/.subagent-stop-quality-extraction.json` to support a future data-driven default-on flip decision. |

## Codex MCP dependency (not a `userConfig` knob)

`orchestration_dispatch`'s `CODEX=on` peer path, the **5 MCP-backed `codex-*` skills** (`codex-architect`, `codex-brainstorm`, `codex-code-review`, `codex-explain`, `codex-implement`), and the **7 `/dhpk:codex-*` commands** (`codex-review`, `-review-branch`, `-review-doc`, `-review-fast`, `-security`, `-test-gen`, `-test-review`) all require the `mcp__codex__codex` / `mcp__codex__codex-reply` tools. (`codex-cli-review` is the one exception — it shells out to the `codex` CLI binary via `Bash` and needs no MCP server.) dhpk does not bundle or configure these tools, and no `dhpk` `userConfig` key controls them: they come from **directly registering the Codex CLI's own `codex mcp-server` subcommand as an MCP server** — *not* from installing `openai/codex-plugin-cc`, which is a separate, optional surface (see the comparison aside below).

### How the Codex MCP server works

The Codex CLI ships an MCP-server mode. `codex mcp-server` starts a stdio Model Context Protocol server that exposes exactly two tools — `codex` and `codex-reply` — which Claude Code surfaces to skills as `mcp__codex__codex` / `mcp__codex__codex-reply`. Each call is configurable via `approval-policy`, `sandbox`, `model`, `profile`, and `cwd` (OpenAI documents the command and these parameters in its [Agents SDK / Codex MCP guide](https://developers.openai.com/codex/guides/agents-sdk)). Registering this server is the **only** way to obtain the `mcp__codex__*` tools dhpk's `codex-*` skills and commands depend on.

Register it once, independent of dhpk:

```bash
# Register the Codex CLI's mcp-server as an MCP server named "codex"
claude mcp add --transport stdio codex -- codex mcp-server
# Confirm Claude Code sees it
claude mcp list
```

You can equivalently hand-write the same server into a `.mcp.json` / `.claude.json` entry instead of using `claude mcp add`. Claude Code's [MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart#connect-to-mcp-servers) documents this generic connect-and-verify flow (`claude mcp add`, `claude mcp list`, and `/mcp` inside a session).

This requires the `codex` CLI itself to be installed and authenticated first: Node.js 18.18+ and either a ChatGPT subscription (including Free) or an OpenAI API key. Install with `npm install -g @openai/codex` and authenticate with `codex login` (prefix with `!` to run it as a shell command from inside a Claude Code session).

**Verifying the connection** — inside a Claude Code session, run:

```bash
/mcp
```

Look for a `codex` entry with a connected status and the `codex` / `codex-reply` tools listed under it (Claude Code exposes them to skills as `mcp__codex__codex` / `mcp__codex__codex-reply`). If `codex` is missing or shows a failed/disconnected state:

1. Re-check `claude mcp list` — confirm a `codex` server is registered and its command is `codex mcp-server`.
2. Confirm the underlying `codex` CLI runs and is authenticated (`codex login`); the MCP server can't start without it.
3. If `codex` appears connected but a `codex-*` skill still fails, the issue is usually auth (`codex login`) rather than the MCP connection itself.

Without the `codex mcp-server` registration, invoking any MCP-backed `codex-*` skill or `/dhpk:codex-*` command surfaces a tool-permission error (`mcp__codex__*` not found) — dhpk has no fallback for these surfaces specifically, since they exist only to delegate to Codex. This is distinct from `CODEX=on` (see [`docs/basic-operations.md`](./basic-operations.md#9-implementation-dispatch-automatic)), a **per-session opt-in flag** (not a persisted `userConfig` value, no install-time `--config` equivalent) that resets every session unless you pass `--codex` or say "use codex" again — and when its MCP dependency is absent, `CODEX=on` degrades silently to single-assistant dispatch rather than erroring.

It is also unrelated to **Codex CLI dual-track sync** (`install-codex-skills.sh`, see [`docs/basic-operations.md`](./basic-operations.md)), which mirrors dhpk's own skills into a project's `.codex/` directory for people running the standalone `codex` CLI directly — that path needs no MCP server at all.

### `openai/codex-plugin-cc` vs the Codex MCP server

`openai/codex-plugin-cc` (installed via `/plugin install codex@openai-codex`) is a **separate, optional** integration that does **not** register an MCP server and does **not** satisfy the `codex-*` skills' MCP dependency. It drives the Codex CLI's distinct `app-server` subcommand through its own Node broker scripts (`scripts/app-server-broker.mjs`, `scripts/codex-companion.mjs`) — not `mcp-server` — to provide its own slash commands (`/codex:review`, `/codex:adversarial-review`, `/codex:rescue`, `/codex:transfer`, `/codex:status`, `/codex:result`, `/codex:cancel`, `/codex:setup`), a `codex-rescue` subagent, background job polling, a `codex resume <session-id>` transfer mechanism, and an optional Stop-hook review gate. None of these touch `mcp-server` or `mcp__codex__*`.

The two are independent — you may have **either, both, or neither** installed:

| | Codex MCP server | `openai/codex-plugin-cc` |
|---|---|---|
| How to get it | `claude mcp add --transport stdio codex -- codex mcp-server` | `/plugin install codex@openai-codex` |
| Codex CLI subcommand | `codex mcp-server` | `codex app-server` (via broker scripts) |
| What it provides | `mcp__codex__codex` / `mcp__codex__codex-reply` tools | `/codex:*` slash commands, `codex-rescue` subagent, Stop-hook gate |
| Used by dhpk's `codex-*` skills? | **Yes** — this is their dependency | No |

If you install only the plugin and never register `codex mcp-server`, the `mcp__codex__codex` tool is still unavailable and invoking a `codex-*` skill will surface a tool-permission error. `/codex:setup` (shipped by the plugin) is a convenience for checking the underlying `codex` CLI install/auth state — which the MCP server also needs — but installing the plugin is neither necessary nor sufficient for the MCP dependency.

Finally, don't confuse either integration with dhpk's **own** `.codex-plugin/` directory (see the "Codex Plugin Marketplace" section of [`docs/basic-operations.md`](./basic-operations.md)) — that manifest runs in the opposite direction: it lets the **Codex CLI** install dhpk's skills as a Codex-native plugin. It shares the word "plugin" but has nothing to do with `openai/codex-plugin-cc` or the MCP tools documented above.

### Codex agent roles (dual-track sync)

This is about the standalone Codex CLI dual-track sync (`codex/agents/` → `.codex/agents/`), not the MCP server documented above. Every `codex/agents/*.toml` file must declare non-empty `name`, `description`, and `developer_instructions` — Codex CLI auto-discovers `.codex/agents/*.toml` and errors if `name` is missing. The 7 generated roles (`architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`) are produced from `agents/<name>.md` by `scripts/gen-codex-agents.js`, joining 4 hand-maintained generic roles (`explorer`, `worker`, `monitor`, `bug-investigator`) for a total of 11.

`[agents.<name>]` registration blocks in `config.toml.example` are **optional** — Codex CLI discovers roles directly from `.codex/agents/*.toml`, and the config blocks only add a description, nickname, or concurrency caps (`max_threads`, `max_depth`). See `codex/AGENTS.md` and `codex/README.md` for the full role map.

## Docker & stack modules

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `docker_containers` | string[] | `[]` | container name(s) | Container names checked at SessionStart. Empty disables the check. First entry exports as `DHPK_PHP_CONTAINER`; second as `DHPK_MYSQL_CONTAINER`. |
| `modules` | string[] | `[]` | any of the 27 shipped modules — see [`docs/basic-operations.md`](./basic-operations.md) or `manifests/module-catalog.json` for the full list | Stack modules to enable. Additive per axis (php / laravel / phpunit) — a library spanning Laravel 6–11 should enable each version for cumulative guidance. Enabling `js` wires the ESLint post-edit hook + pre-commit lint/typecheck gate; `php-7.4` wires php-cs-fixer + pre-commit lint/phpstan/psalm; `python` wires a post-edit ruff hook (batched at Stop) + a pre-commit ruff-check/ruff-format/type-check gate (project root auto-detected by walking up to `pyproject.toml`); `fastapi` / `pytest` are skills+references only (each `requires: python`); `library-author` wires the sixth-color `polyfill-reviewer` sentinel; `xcode-tooling` wires SwiftLint + pre-commit xcodebuild/SPM build+test (self-skips when binaries absent); `swift` / `swiftui` / `ios-platform` / `swift-testing` are skills+references only. Module `requires:` is validated at SessionStart (warning, not blocking). **Precedence**: a project's `.claude/settings.local.json` `pluginConfigs.dhpk@dhpk.options.modules` overrides the global value. |

## Review triggers & risk heuristics

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `review_trigger_extra_paths` | string[] | `[]` | `<slot>:<prefix>`, slot ∈ `code\|db\|sec\|fe\|doc\|mig` | Extra path prefixes per reviewer slot, e.g. `code:protected/`, `fe:resources/views/`, `mig:db/migrate/`. |
| `hot_tables` | string[] | `[]` | table name(s), e.g. `orders`, `order_lines`, `inventory` | Project-specific high-volume table names that `performance-analyzer` and `migration-reviewer` treat as elevated risk (large-ALTER downtime, N+1, missing composite index). The shipped agents only carry POS-system examples; declare your real hot tables here (or in `CLAUDE.md` / `.claude/rules/`). Empty falls back to generic heuristics. |

## Git safety gates

| Key | Type | Default | Options | Env override | Purpose |
|-----|------|---------|---------|--------------|---------|
| `sentinel_commit_gate` | string | `warn` | `warn` \| `block` \| `off` | `DHPK_SENTINEL_COMMIT_GATE` | Behavior when `git commit/merge/rebase/cherry-pick` runs while reviewer sentinels are pending. `warn` = stderr reminder (exit 0); `block` = reject the tool call (exit 2); `off` = silent. Companion to the pre-bash-guard's hard `git push` block. |
| `branch_safety` | string | `warn` | `warn` \| `block` \| `off` | `DHPK_BRANCH_SAFETY` | Behavior when a history-mutating git verb (`commit/merge/rebase/cherry-pick/reset/push`) runs on a protected branch. |
| `protected_branches` | string[] | `["main","master","develop","release/*","hotfix/*"]` | branch name(s) / bash `case` globs | Branches the `branch_safety` gate checks against. Set to `[]` to disable per-branch gating without setting `branch_safety=off`. |

## Session behavior & advisories

| Key | Type | Default | Env override | Purpose |
|-----|------|---------|--------------|---------|
| `skill_hint_enabled` | boolean | `true` | `DHPK_DISABLE_SKILL_HINT=1` | UserPromptSubmit hook prints a one-line route-table skill suggestion (e.g. "bug" → `/dhpk:bug-fix`). |
| `learning_db_enabled` | boolean | `false` | `DHPK_LEARNING_DB=1/0` | Appends operational signals (reviewer pass, subagent failure, abnormal stop) to `.claude/artifacts/learning.jsonl`; SessionStart surfaces top recurring signatures as a `[learned-context]` block (capped at 5 lines). Confidence decays with recency; log self-rotates past 50MB. |
| `graduation_scan_enabled` | boolean | `false` | `DHPK_GRADUATION_SCAN=1/0` | Stop hook scans the session transcript for cited auto-memory entries, tracks cross-session counts/confidence, and regenerates `.claude/artifacts/graduation-candidates.md`. Entries cited ≥3 times across ≥24h/≥3 dates without a trap re-occurring are proposed for promotion to a rule/skill. Requires `python3`. |
| `completion_evidence_enabled` | boolean | `false` | `DHPK_COMPLETION_EVIDENCE=1/0` | Stop advisory warning when the assistant claims completion but the tree has code changes with no matching test changes (doc/harness-only exempt; defers to active sentinels). Advisory only — never blocks Stop. |
| `agent_warmstart_enabled` | boolean | `false` | `DHPK_AGENT_WARMSTART=1/0` | PreToolUse (`Task`\|`Agent`) hook injecting parent-session context (active sentinels + reviewer slots, current OpenSpec change + tasks, `.claude/warmstart-context.md`, tool-routing reminder; ≤2000 chars) into subagent prompts. Costs tokens on every subagent spawn. |
| `reap_stale_mcp_processes` | boolean | `false` | — | When `true`, SessionStart reaps **orphaned** `gitnexus mcp` processes (parent session dead / reparented to init) — never a process owned by a live parallel session. Only useful for gitnexus MCP users. |
| `harness_restore_hint` | string | `""` | — | Command line printed by the SessionStart broken-symlink advisory (for harnesses deployed via symlinks from a separate repo). Empty prints the WARN without a hint line. |

## Manifest / lockfile sync

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `lockfile_sync_commands` | string[] | `[]` | `<manifest>:<command>`, no commas in the command | Per-manifest lock-sync commands for the async PostToolUse manifest-guard reminder, e.g. `composer.json:docker exec -i my_php composer update --lock`. Manifests without an entry fall back to a generic default (`composer update --lock` / `npm install` / `bundle install` / `cargo build` / `poetry lock`). |

## `js` module

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `js_lint_script` | string | `"lint"` | npm script invoked by the `js` module's pre-commit gate. Override for non-standard names (e.g. `lint:strict`). |
| `js_typecheck_script` | string | `"typecheck"` | npm script invoked by the `js` module's pre-commit gate. |
| `js_check_path` | string | `"js/"` | Path scanned by `/ts-check-status` for `// @ts-check` rollout progress. Override for projects laying out JS under `src/` or `app/javascript/`. |
| `js_frontend_roots` | string[] | `[]` | Project override for the `js` module's tier detection — root dirs scanned for first-party JS/TS. Empty falls back to `modules/js/module.yaml` (default `[js, src]`). |
| `js_core_files` | string[] | `[]` | Project override — basenames at a frontend root that are first-party entry bundles (linted) rather than vendor, e.g. `["app.js","main.js"]`. Empty falls back to `module.yaml`. |
| `js_vendor_globs` | string[] | `[]` | Project override — glob path prefixes treated as vendored (lint-skipped at any depth), e.g. `js/ckeditor/`, `js/jquery-*`. Globs must not contain commas. Empty falls back to `module.yaml`. |

## `python` module

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `python_project_roots` | string[] | `[]` | subdir path(s), e.g. `backend` | Subdirs holding a `pyproject.toml` that the python module's hooks should lint. Default empty — hooks walk up from the edited file to the nearest `pyproject.toml` (already handles monorepo backends). Set this only to **restrict** linting to specific subtrees. |
| `python_runner` | string | `"uv run"` | e.g. `"poetry run"`, `""` | Command prefix used to invoke ruff / pyright / mypy inside the project env. `""` runs tools straight off PATH (already-activated venv). Falls back to bare PATH tools when the runner binary is absent, then self-skips if those are missing too. |
| `ruff_bin` | string | `"ruff"` | — | ruff executable invoked by the post-edit lint hook, Stop batch check, and pre-commit validation. |
| `python_typechecker` | string | `"pyright"` | `pyright` \| `mypy` \| `none` | Type checker the pre-commit gate runs on staged `.py` files. `none` skips type-checking entirely. |
| `pyright_bin` | string | `"pyright"` | — | pyright executable, used when `python_typechecker=pyright`. |
| `mypy_bin` | string | `"mypy"` | — | mypy executable, used when `python_typechecker=mypy`. |

## `php-5.6` / `php-7.4` modules

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `php_bin` | string | `"php"` | PHP binary/wrapper for the `php-5.6` module's async `php -l` post-edit syntax check, e.g. `docker exec -i my_php php`. Self-skips when the first word is not on PATH. |
| `php_cs_fixer_bin` | string | `"vendor/bin/php-cs-fixer"` | Binary for the `php-7.4` module's post-edit php-cs-fixer hook + pre-commit gate. |
| `phpstan_bin` | string | `"vendor/bin/phpstan"` | PHPStan binary for the `php-7.4` module's pre-commit gate; only invoked when `phpstan.neon[.dist]` is present. |
| `psalm_bin` | string | `"vendor/bin/psalm"` | Psalm binary for the `php-7.4` module's pre-commit gate; only invoked when `psalm.xml[.dist]` is present. |

## iOS / Swift suite (`xcode-tooling` module)

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `swiftlint_bin` | string | `"swiftlint"` | — | Binary for the `xcode-tooling` post-edit SwiftLint hook. Self-skips when absent. |
| `xcode_scheme` | string | `""` | scheme name, e.g. `babylon` | Scheme for the `xcode-tooling` pre-commit build gate. Empty skips the gate entirely (no scheme guessing). |
| `xcode_destination` | string | `""` | e.g. `platform=iOS Simulator,name=iPhone 17` | `-destination` for the *test* step of the pre-commit gate. The *build* step always uses a device-name-free generic destination so it never goes stale. Empty auto-picks the first available simulator. |
| `swift_build_skip_tests` | boolean | `false` | — | When `true`, the Swift pre-commit gate builds only (no `xcodebuild test` / `swift test`). |

## Worked examples

```bash
# Plain install with defaults (7-slot reviewer dispatch on the default agent names).
claude plugin install dhpk@dhpk

# Legacy PHP/Yii + JS fullstack project.
claude plugin install dhpk@dhpk \
  --config modules=php-5.6,yii-1.1,phpunit-5.7,js \
  --config docker_containers=php-fpm,mysql \
  --config review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj,fe-reviewer-myproj,doc-reviewer-myproj

# Modern Laravel package library spanning Laravel 6-11 (with polyfill review).
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author

# Python/FastAPI project using Poetry instead of uv, mypy instead of pyright.
claude plugin install dhpk@dhpk \
  --config modules=python,fastapi,pytest \
  --config python_runner="poetry run" \
  --config python_typechecker=mypy
```

See `manifests/install-profiles.json` for curated module bundles and `manifests/module-catalog.json` for the full stack/version catalog (SSOT).
