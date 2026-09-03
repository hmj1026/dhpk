# Configuration Reference

> **Languages**: **English** · [繁體中文](./configuration.zh-TW.md)

dhpk exposes **59 `userConfig` knobs** in `.claude-plugin/plugin.json`. This page documents every knob: where you set it, what values it accepts, and what it actually changes. For platform installation routes and support status, see the [platform installation SSOT](./platform-installation.md). For the day-to-day command flow (install, common workflows, review cycle), see [`docs/basic-operations.md`](./basic-operations.md).

The default Claude discovery artifact is the materialized `minimal` profile,
derived from `manifests/distribution-inventory.json`; it is not an unfiltered
scan of the source `skills/` directory. The profile publishes at most 15
`implicit-eligible` entries. `full` and `compat-v1` are explicit opt-in profile
artifacts. Agent Plugin and Cursor publication memberships are unchanged. See
[`docs/platform-installation.md`](./platform-installation.md) for the profile
selection and receipt rules.

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
| `hook_profile` | string | `standard` | `minimal` \| `standard` \| `strict` | Verbosity of active deterministic hook output. Retired Stop reminders are not default-wired. |
| `review_agents` | string[] | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer","polyfill-reviewer","migration-reviewer"]` | any 7 agent names | Reviewer names used by sentinel routing, in slot order. Override to point at project-specific agents; shorter overrides are padded with defaults. |
| `deep_reasoner_model` | string | `opus` | `haiku` \| `sonnet` \| `opus` (whatever the running Claude Code version supports) | Model tier for `dhpk:deep-reasoner` Agent-call dispatches (reasoning-heavy implementation work). Applied per dispatch via the Agent call's `model` param when it differs from the agent's frontmatter default. Invalid value warns once per session and falls back to the frontmatter default — never fails the dispatch. |
| `fast_worker_model` | string | `sonnet` | same as above | Model tier for `dhpk:fast-worker` Agent-call dispatches (mechanical implementation work). Same validation/fallback behavior as `deep_reasoner_model`. |
| `planner_model` | string | `opus` | same as above | Model tier for `dhpk:planner` Agent-call dispatches (the opt-in `/dhpk:flow-drive --plan` pre-implementation critique / post-implementation warm review). Same validation/fallback behavior as `deep_reasoner_model`. |
| `deep_reasoner_effort` | string | `high` | `low` \| `medium` \| `high` \| `xhigh` \| `max` (whatever the running Claude Code version supports) | Reasoning effort for `dhpk:deep-reasoner` Agent-call dispatches. Applied per dispatch via the Agent call's `effort` param when it differs from the agent's frontmatter default. Invalid value warns once per session and falls back to the frontmatter default — never fails the dispatch. |
| `fast_worker_effort` | string | `medium` | same as above | Reasoning effort for `dhpk:fast-worker` Agent-call dispatches. Same validation/fallback behavior as `deep_reasoner_effort`; the decision layer (`deep-reasoner`) runs higher effort and execution (`fast-worker`) de-escalates. |
| `planner_effort` | string | `high` | same as above | Reasoning effort for `dhpk:planner` Agent-call dispatches. Same validation/fallback behavior as `deep_reasoner_effort`; the warm-review (post-implementation) invocation de-escalates to `medium`. |
| `codex_worker_model` | string | `gpt-5.6-luna` | any model the codex CLI accepts | Model passed to the codex CLI backend for canonical role `codex-worker` dispatches. Resolved via the standard layering (project pluginConfigs > global pluginConfigs > shipped default) and passed into `run-codex.sh`. Codex model names rotate quickly — override here instead of editing source when a default is deprecated (check `codex models`). Legacy alias: `codex_fast_worker_model`. |
| `codex_worker_effort` | string | `xhigh` | any effort the codex CLI accepts (e.g. `low` \| `medium` \| `high` \| `xhigh`) | `model_reasoning_effort` passed to the codex CLI backend for `codex-worker` dispatches — the strong mechanical tier. Legacy alias: `codex_fast_worker_effort`. |
| `codex_worker_timeout_secs` | string | `360` | integer seconds `>= 0`; `0` disables | Role-specific dispatcher deadline for canonical role `codex-worker`. It wins over the shared value in the same scope; project values win over global values. Legacy alias: `codex_fast_worker_timeout_secs`. |
| `codex_reasoner_model` | string | `gpt-5.6-sol` | any model the codex CLI accepts | Model passed to the codex CLI backend for canonical role `codex-reasoner` dispatches via `--reasoner=codex` in a read-only sandbox. Legacy alias: `codex_deep_reasoner_model`. |
| `codex_reasoner_effort` | string | `high` | any effort the codex CLI accepts | `model_reasoning_effort` passed to the codex CLI backend for `codex-reasoner` dispatches. Legacy alias: `codex_deep_reasoner_effort`. |
| `codex_reasoner_timeout_secs` | string | `360` | integer seconds `>= 0`; `0` disables | Role-specific dispatcher deadline for canonical role `codex-reasoner`. It wins over the shared value in the same scope; project values win over global values. Invalid values fail closed at dispatch time. Legacy alias: `codex_deep_reasoner_timeout_secs`. |
| `codex_reviewer_model` | string | `gpt-5.6-sol` | any model the codex CLI accepts | Model passed to the codex CLI backend for canonical role `codex-reviewer` (internal-only in this rollout; not directly dispatchable). |
| `codex_reviewer_effort` | string | `high` | any effort the codex CLI accepts | `model_reasoning_effort` passed to the codex CLI backend for `codex-reviewer` dispatches. |
| `codex_reviewer_timeout_secs` | string | `360` | integer seconds `>= 0`; `0` disables | Role-specific dispatcher deadline for canonical role `codex-reviewer`. It wins over the shared value in the same scope; project values win over global values. Legacy alias: `codex_bridge_timeout_secs`. |
| `codex_timeout_secs` | string | `360` | integer seconds `>= 0`; `0` disables | Shared dispatcher deadline for all Codex CLI roles. Precedence is project role-specific > project shared > global role-specific > global shared > shipped default; malformed values fail closed before dispatch. The resolved value is copied into the immutable transport context, never read by a wrapper from its environment. |
| `agy_worker_model` | string | `Gemini 3.6 Flash (High)` | any model listed by `agy models` | Model display string passed to the agy CLI backend for canonical role `agy-worker` dispatches. Agy bakes the thinking level into the model name, so there is no separate effort key. Same layering as above; override when a default is deprecated (check `agy models`). Legacy alias: `agy_fast_worker_model`. |
| `architect_model` | string | `fable` | any model tier supported by the running Claude Code | Model tier for `dhpk:architect` Agent-call dispatches; applied per invocation without editing frontmatter, with up-only escalation for HIGH-risk architecture decisions. |
| `architect_effort` | string | `low` | `low` \| `medium` \| `high` \| `xhigh` \| `max` | Reasoning effort for `dhpk:architect` Agent-call dispatches; applied per invocation without editing frontmatter. |
| `orchestration_dispatch` | string | `on` | `on` \| `off` | Kill switch for implementation worker/reasoner routing in the Implementation dispatch table (`flow-guide` classification and `flow-drive` implementation modes, plus `opsx-apply-goal`). `on` routes implement-phase work through the decision table and prohibits `general-purpose` for implementation. `off` restores inline implementation and removes the dispatch directive, while the mandatory multi-task OpenSpec planner and verification gates remain active. |
| `fast_worker_backend` | string | `claude` | `claude` \| `codex` \| `agy` \| `auto` | Deterministic mechanical-worker selector. `claude` maps to `dhpk:fast-worker`; `auto` checks `fast_worker_backend_order`. `/dhpk:flow-drive --worker=...` overrides this key for one invocation only (flag > userConfig > shipped default); an invalid flag warns once and falls through to this key/default, while an invalid configured value uses `claude`. Codex CLI availability is checked independently of the retired `CODEX=on` flag; select a Codex worker explicitly with `--worker=codex`. |
| `fast_worker_backend_order` | string | `claude,codex,agy` | comma-separated backend names | Availability order used only by `auto`; rejected candidates and reasons are recorded. Invalid values warn once per session and use the shipped order. |
| `fast_worker_fallback` | string | `none` | `none` \| `claude` | Explicit fallback for a missing selected CLI executable only. Auth, authorization, model, task, execution, and verification failures remain blocked. |
| `subagent_quality_gate` | string | `off` | `on` \| `off` | Retained for an explicitly registered advisory quality hook. It has no default-lifecycle effect; strict artifact evidence is enforced by `subagent-stop-verify.sh`. |

The dispatcher validates the resolved deadline as unsigned decimal seconds
before it creates the `0600` immutable transport context. Empty, fractional,
negative, or otherwise malformed values block the dispatch instead of silently
falling back to `360`; set `0` deliberately only when no portable runner
deadline is required. The Python transport runner, not `timeout` or `gtimeout`,
enforces the attested deadline and writes a contained terminal receipt. The
separate agy setting is likewise an attested dispatch input.

<a id="codex-mcp-dependency-not-a-userconfig-knob"></a>

## Codex integrations and retired MCP history (not a `userConfig` knob)

Current dhpk capabilities run with the in-process model or an explicit CLI
backend. No active skill or command requires a Codex MCP server. The current
CLI-only review path is `change-verdict --mode code --backend cli`;
its sibling CLI roles are `codex-worker`, `codex-reasoner`, `codex-reviewer`,
and `dhpk-codex-bridge`. Use `--worker=codex`, `--reasoner=codex`, or an
explicit `codex exec` second opinion when a Codex CLI transport is wanted.

### Historical: Codex MCP server (retired)

The Codex CLI once exposed a stdio Model Context Protocol server through
`codex mcp-server`. Claude Code surfaced its two tools as
`mcp__codex__codex` and `mcp__codex__codex-reply`. A historical registration
used `claude mcp add --transport stdio codex -- codex mcp-server`; `/mcp` and
`claude mcp list` were then used to inspect the connection. This paragraph and
the command are retained for migration diagnosis only. The server is retired,
is not required or recommended for any current dhpk skill or command, and must
not be added as a hidden fallback.

The former MCP path could preserve a reply thread between calls. The migrated
owners instead use the current model, isolated reviewers, or explicitly chosen
`codex exec`; the [capability-parity matrix](./codex-mcp-capability-parity.md)
records the continuity difference, verification evidence, and rollback for each
capability. For rollback, pin the last compatible release carrying the MCP
grant; do not reintroduce that transport in the current release.

### Current external app-server plugin

`openai/codex-plugin-cc` (installed via `/plugin install codex@openai-codex`)
is a separate, optional integration. It drives the Codex CLI's `app-server`
subcommand through its own broker scripts and provides `/codex:*` commands,
`codex-rescue`, background polling, resume/transfer, and an optional Stop-hook
gate. It does not register the retired MCP server and is not required for any
dhpk capability.

The supported current surfaces are independent:

| Surface | How it is obtained | What it provides | dhpk dependency |
|---|---|---|---|
| Codex CLI | Install and authenticate the `codex` binary | `codex exec`, CLI-backed roles, and `change-verdict --mode code --backend cli` | Optional; no MCP server |
| `openai/codex-plugin-cc` | `/plugin install codex@openai-codex` | `/codex:*` commands and app-server collaboration | Optional external plugin |
| Retired Codex MCP | Historical `codex mcp-server` registration | `mcp__codex__codex` / `mcp__codex__codex-reply` | None; retained only as historical context |

The standalone Codex CLI dual-track sync (`install-codex-skills.sh`, see
[`docs/basic-operations.md`](./basic-operations.md)) is also independent of
the retired MCP mechanism and needs no server registration.

The `CODEX=on` and `/dhpk:do --codex` flags were legacy per-session MCP-peer
interfaces. They are removed, are not persisted `userConfig` values, and are
not silently reinterpreted as `codex exec`, `--worker=codex`,
`--reasoner=codex`, or the external plugin. Use `/dhpk:flow-drive` for
current-model implementation, select a CLI role explicitly when needed, and
request a second opinion by its named `codex exec` opt-in.

### Codex agent roles (dual-track sync)

This is about the standalone Codex CLI dual-track sync (`codex/agents/` → `.codex/agents/`), not the retired MCP mechanism. Every `codex/agents/*.toml` file must declare non-empty `name`, `description`, `model`, `model_reasoning_effort`, and `developer_instructions`; Codex agent definitions use TOML only. dhpk publishes these files for Codex's documented project-local discovery path, and the installer always materializes them as physical files even when skills use symlinks. The 12 generated roles (`architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`, `planner`, `spec-miner`, `frontend-reviewer`, `migration-reviewer`, `e2e-runner`) are produced from `agents/<name>.md` by `scripts/gen-codex-agents.js`, joining 4 hand-maintained generic roles (`explorer`, `worker`, `monitor`, `bug-investigator`) for a total of 16 direct roles.

`[agents.<name>]` blocks in `config.toml.example` are optional metadata, not a workaround for a runtime registry failure. The supported top-level concurrency setting is `max_concurrent_threads_per_session`; the example also records the effective default subagent model and reasoning effort. Static metadata, a physical TOML, or built-in `explorer` success does not prove custom-role callability; require an observed non-built-in spawn and targeted wait. See [`codex/AGENTS.md`](../codex/AGENTS.md) for diagnostics and [`platform-installation.md`](platform-installation.md) for the evidence boundary.

## Docker & stack modules

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `docker_containers` | string[] | `[]` | container name(s) | Retained for explicitly registered Docker tooling; default SessionStart does not probe containers or export container variables. |
| `modules` | string[] | `[]` | any shipped module — see [`docs/basic-operations.md`](./basic-operations.md) or `manifests/module-catalog.json` | Stack modules to activate. SessionStart validates `requires:` and reports enabled modules; module selection influences sentinel routing and combined Bash/pre-commit gates. Post-edit lint/format/Stop work is not default-wired. **Precedence**: project `.claude/settings.local.json` `pluginConfigs.dhpk@dhpk.options.modules` overrides the global value. |

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
| `protected_branches` | string[] | `["main","master","develop","release/*","hotfix/*"]` | branch name(s) / bash `case` globs | — | Branches the `branch_safety` gate checks against. Set to `[]` to disable per-branch gating without setting `branch_safety=off`. |

## Session behavior & advisories

| Key | Type | Default | Env override | Purpose |
|-----|------|---------|--------------|---------|
| `skill_hint_enabled` | boolean | `true` | `DHPK_DISABLE_SKILL_HINT=1` | Retained for an explicitly registered UserPromptSubmit hint; no default hook consumes it. |
| `learning_db_enabled` | boolean | `false` | `DHPK_LEARNING_DB=1/0` | Retained for explicitly registered learning observation and presentation; default SessionStart does not inject learned context. |
| `graduation_scan_enabled` | boolean | `false` | `DHPK_GRADUATION_SCAN=1/0` | Retained for explicitly registered Stop advisory work; no default Stop hook consumes it. |
| `completion_evidence_enabled` | boolean | `false` | `DHPK_COMPLETION_EVIDENCE=1/0` | Retained for explicitly registered Stop advisory work; no default Stop hook consumes it. |
| `agent_warmstart_enabled` | boolean | `false` | `DHPK_AGENT_WARMSTART=1/0` | Retained for explicitly registered `Task`/`Agent` prompt injection; no default lifecycle entry consumes it. |
| `reap_stale_mcp_processes` | boolean | `false` | — | Retained for explicitly registered SessionEnd/process tooling; default SessionStart does not reap processes. |
| `harness_restore_hint` | string | `""` | — | Retained for explicitly registered symlink-health advice; default SessionStart does not emit it. |

## Manifest / lockfile sync

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `lockfile_sync_commands` | string[] | `[]` | `<manifest>:<command>`, no commas in the command | Retained for explicitly registered manifest/lockfile advisory tooling; default PostToolUse only routes review sentinels. |

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
| `ruff_bin` | string | `"ruff"` | — | ruff executable for an explicitly registered lint workflow and applicable pre-commit validation. |
| `python_typechecker` | string | `"pyright"` | `pyright` \| `mypy` \| `none` | Type checker the pre-commit gate runs on staged `.py` files. `none` skips type-checking entirely. |
| `pyright_bin` | string | `"pyright"` | — | pyright executable, used when `python_typechecker=pyright`. |
| `mypy_bin` | string | `"mypy"` | — | mypy executable, used when `python_typechecker=mypy`. |

## `php-5.6` / `php-7.4` modules

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `php_bin` | string | `"php"` | PHP binary/wrapper for an explicitly registered `php-5.6` syntax-check workflow, e.g. `docker exec -i my_php php`. Self-skips when the first word is not on PATH. |
| `php_cs_fixer_bin` | string | `"vendor/bin/php-cs-fixer"` | Binary for an explicitly registered `php-7.4` formatter workflow and its applicable pre-commit gate. |
| `phpstan_bin` | string | `"vendor/bin/phpstan"` | PHPStan binary for the `php-7.4` module's pre-commit gate; only invoked when `phpstan.neon[.dist]` is present. |
| `psalm_bin` | string | `"vendor/bin/psalm"` | Psalm binary for the `php-7.4` module's pre-commit gate; only invoked when `psalm.xml[.dist]` is present. |

## iOS / Swift suite (`xcode-tooling` module)

| Key | Type | Default | Options | Purpose |
|-----|------|---------|---------|---------|
| `swiftlint_bin` | string | `"swiftlint"` | — | Binary for an explicitly registered `xcode-tooling` SwiftLint workflow. Self-skips when absent. |
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
