# dhpk — Dev Harness Plugin Kit for Claude Code

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)

A generic, install-and-go Claude Code harness. Ships **22 role-based agents** (+ 1 module-scoped reviewer), ~73 commands (codex / gitnexus / git / project workflow), ~57 core skills + the `deploy-list` cross-project deploy file list generator + the **`/dhpk:do` Smart Router** (natural-language task routing via 35-pattern route table + LLM fallback) + **cross-session learning DB** (operational signal store with confidence decay, opt-in), **7-slot sentinel-driven review hooks** (code / db / sec / frontend / doc / **polyfill** / **migration** — polyfill via `library-author`, migration via module triggers or a `mig:` extra path), statusline, harness scripts, and **27 opt-in stack modules** across PHP (`php-5.6`, `php-7.4`, `php-8.x`), Yii (`yii-1.1`), PHPUnit (`phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11`), Laravel (`laravel-5.4`, `laravel-6` through `laravel-11`), JS (`js`), Vue (`vue-2`), Laravel Mix (`laravel-mix`), Python (`python`, `fastapi`, `pytest`), the cross-cutting `library-author` module, and an **iOS/Swift suite** (`swift`, `swiftui`, `ios-platform`, `swift-testing`, `xcode-tooling`). Modules contribute hooks at runtime via the **wrapper-dispatch** model (see [`docs/hook-extension.md`](./docs/hook-extension.md)). Parallel Codex CLI tree included for dual-assistant projects.

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
| `cx` CLI | Optional | Semantic code navigation. Primary tool in `rules/tool-routing.md` for `cx overview` / `cx definition` / `cx references`. Referenced by 6 reviewer agents and the `harness-fill` skill. Missing → falls back to `Grep` / `Read`. |
| `gitnexus` MCP server | Optional | Knowledge-graph queries (`gitnexus_impact`, `gitnexus_rename`, `gitnexus_detect_changes`). Required by 6 `gitnexus-*` skills and the `rules/execution-policy.md` self-check. Missing → falls back to `cx` or `Grep`. |
| `claude-mem` | Optional | Cross-session memory search (`mem-search`). Referenced by `rules/tool-routing.md` for past-decision lookups. Missing → skip. |

Missing optional tools degrade gracefully (the script no-ops or skips a feature). Missing required tools surface as a single-line `[hook-name] WARN: …` to stderr at SessionStart or first hook fire so you can act on them.

External code-navigation tools (`cx`, `gitnexus`, `claude-mem`) are **not bundled** by dhpk. Each consuming project decides whether to install them. The shipped rules and agents are written to degrade gracefully via [`rules/tool-routing.md`](./rules/tool-routing.md).

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

Pin a specific release by appending a version: `claude plugin install dhpk@dhpk@v0.6.0`. Available stacks/versions live in `manifests/module-catalog.json` (SSOT); curated bundles in `manifests/install-profiles.json`. Docker prerequisites: see [`docs/docker-setup.md`](./docs/docker-setup.md).

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
| Some skill descriptions truncated/dropped (seen in `/doctor`) | Many modules shipped → skill-listing budget overflow (module skills list regardless of `modules`, [#12](https://github.com/hmj1026/dhpk/issues/12)) | Raise `skillListingBudgetFraction` in `settings.json` (default ~1% → `0.02`–`0.03`), or install fewer modules / disable the whole plugin with `/plugin` where unused |

## What you get

| Component | Count | Notes |
|-----------|------:|-------|
| Agents | 21 root | 7 sentinel-driven reviewers across the slots: code / db / sec / **frontend** / **doc** / **polyfill** (slot 5, written by `library-author`) / **migration** (slot 6, opt-in via module triggers or a `mig:` extra path). Situational: architect, tdd-guide, refactor-cleaner, ui-ux-verifier, performance-analyzer, doc-updater, docs-lookup, harness-reviser, version-matrix-impact-reviewer, **swift-build-resolver** (iOS suite), **silent-failure-hunter** (error-handling audit), **spec-miner** (brownfield→OpenSpec extraction), **type-design-analyzer**, **agent-evaluator** (output-quality scorecard), **e2e-runner** (E2E journeys). |
| Commands | ~73 | `dhpk:do` (Smart Router), `dhpk:create-dev`, `dhpk:codex-*`, `dhpk:review-pending`, `dhpk:smart-commit`, `dhpk:ts-check-status` (JS module), `dhpk:opsx-apply-resume` (needs OpenSpec), `dhpk:matrix-cell-onboard` (library-author), `dhpk:de-ai-flavor`, `dhpk:deploy-list`, `dhpk:harness-fill`, `dhpk:ui-ux-verify`, etc. |
| Core skills | ~57 + extras | codex-*, gitnexus, tool-routing, dhpk-execution-policy, **adaptive-dev-workflow** (Feature/Bug/Maintenance classifier), **deploy-list** (cross-project deploy file list generator), **execution-checklist** (end-of-task self-check), `opsx-apply-resume` helpers (need OpenSpec) |
| Stack modules | 27 | PHP: `php-5.6`, `php-7.4`, `php-8.x` · Yii: `yii-1.1` · PHPUnit: `phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11` · Laravel: `laravel-5.4`, `laravel-6` … `laravel-11` · Frontend: `js`, `vue-2`, `laravel-mix` · **Python**: `python`, `fastapi`, `pytest` · `library-author` · **iOS**: `swift`, `swiftui`, `ios-platform`, `swift-testing`, `xcode-tooling` (opt-in; see "Modules" below) |
| Hooks | 9 events | PreToolUse (Edit, Bash + dispatcher + sentinel-gate + branch-safety, Task\|Agent warmstart), PostToolUse (Edit + dispatcher + async crlf-fix + async manifest-guard), SessionStart (+ version-pin / cross-CLI-drift / broken-symlink advisories), PreCompact (checkpoint archive), PostCompact (sentinel restore), SubagentStop (reviewer verify + failure log), StopFailure (failure log), UserPromptSubmit (skill hint), Stop (review-reminder + completion-evidence + graduation-scan + reap-stale-sentinels) |
| Hook dispatchers | 2 | `post-edit-dispatch.sh`, `pre-bash-dispatch.sh` — fan out to active modules' hooks |
| Harness scripts | 5 | precommit-runner, verify-runner, harness-audit, codemap generator, dep-audit |
| Codex dual-track | 14 skills + 1 agent (5 config profiles) | Synced into project `.codex/` by `install-codex-skills.sh` |

## Common workflows

Everything is reachable through `/dhpk:do` — one entry point that routes natural-language task descriptions to the right skill. The examples below show what actually happens after you type a command.

### 1. Feature development

```text
/dhpk:do implement a password-reset email flow
```

The Smart Router matches "implement … feature" → `dhpk:adaptive-dev-workflow` → **Feature Delivery** path. The skill loads TDD guide, runs the RED→GREEN→REFACTOR cycle, and closes with code-review and security gates. Post-edit hooks automatically drop sentinels after each file write; the Stop hook reminds you of any still-open reviewers.

### 2. Bug fix

```text
/dhpk:do fix the login redirect loop
```

Matches "fix … bug" → `dhpk:adaptive-dev-workflow` → **Bug Investigation & Fix**: root-cause evidence, regression test, RED gate before writing the fix.

### 3. Post-edit review cycle (automatic)

No command needed. After any file edit the hooks automatically:

1. Drop a `.pending-*` sentinel for each relevant reviewer slot (code / db / sec / frontend / doc)
2. Remind dispatched reviewers to run in parallel at Stop
3. Warn before `git commit` while sentinels are open (configurable via `sentinel_commit_gate`: `warn` / `block` / `off`)

To trigger reviews immediately without waiting for Stop: `/dhpk:review-pending`

### 4. Commit and PR

```text
/dhpk:smart-commit        # stages changed files, generates a conventional commit message, runs pre-commit gates
/dhpk:create-pr           # drafts PR title + summary from the branch commit log
```

Or describe it in plain language:

```text
/dhpk:do 幫我提交並建立 PR
```

### 5. Unattended OpenSpec session

For a long-running change that should run without supervision — generates the `/goal` condition and `/opsx:apply` sequence, ready to paste into a fresh session:

```text
/dhpk:opsx-goal my-change-id --max-duration 2h
```

Add `--min-coverage 80` to enforce a coverage gate even when the project has no native coverage config.

### 6. Mine specs from existing code

Extracts behavioral requirements from an existing module into `openspec/specs/<capability>/spec.md` (brownfield onboarding):

```text
/dhpk:spec-mine user-authentication
```

Delegates to the `spec-miner` (Opus) agent. Omit the capability name to get a prompted list.

### 7. E2E test authoring

```text
/dhpk:do write E2E tests for the checkout flow
```

Routes to `dhpk:post-dev-test`, which delegates Playwright suite authoring to the `e2e-runner` agent.

### 8. Harness health check and repair

The harness-* family covers four distinct concerns — use the right tool for each:

| Command / Skill | Concern | Mutates? |
|---|---|---|
| `/harness-audit` | Deterministic 7-category scorecard | No |
| `dhpk:harness-budget` | Context-window token accounting | No |
| `dhpk:claude-health` | `.claude/` config health, naming, plugin sync | No |
| `/harness-govern` | End-to-end measure → conform → fix → verify loop | No (add `--fix` to apply) |
| `dhpk:harness-revise` | Trim, dedupe, validate (G1–G13 gap taxonomy) | Yes |
| `dhpk:harness-fill` | Backfill missing `.claude/` infrastructure | Yes |

**Typical flow:**

```text
# 1. Quick diagnostic — see what's wrong
/harness-audit

# 2. Check context-window overhead (token budget)
/dhpk:harness-budget

# 3. End-to-end governance loop (read-only by default)
/harness-govern

# 4. Apply fixes (trim, dedupe, validate)
/harness-govern --fix

# 5. If .claude/ is missing skills/agents/rules (new project onboarding)
/dhpk:harness-fill
```

`/harness-govern` is the single front door: it sequences `/harness-audit` (score) → conform (best-practices lens) → `/harness-revise` (fix, only with `--fix`) → verify. Safe to run as `/loop /harness-govern` for ongoing monitoring.

---

## userConfig

Thirty-one knobs, all settable at install time with `--config <key>=<value>`:

| Key | Default | Purpose |
|-----|---------|---------|
| `hook_profile` | `standard` | `minimal` suppresses Stop reminders; `strict` adds extra warnings |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer","polyfill-reviewer","migration-reviewer"]` | Seven agents invoked by sentinel reminders (slots: code, db, sec, frontend, doc, polyfill, migration). Override to point at your project-specific agents; shorter overrides are padded with the defaults for the remaining slots. (Slots 5–6 fire only when opted in — polyfill via `library-author`, migration via module triggers or a `mig:` extra path.) |
| `docker_containers` | `[]` | Container names checked at SessionStart. Empty list disables the check. First entry exported as `DHPK_PHP_CONTAINER`; second as `DHPK_MYSQL_CONTAINER`. |
| `modules` | `[]` | Stack modules to enable. Ships 27: `php-5.6`, `php-7.4`, `php-8.x`, `yii-1.1`, `phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11`, `laravel-5.4`, `laravel-6`, `laravel-7`, `laravel-8`, `laravel-9`, `laravel-10`, `laravel-11`, `js`, `vue-2`, `laravel-mix`, `python`, `fastapi`, `pytest`, `library-author`, `swift`, `swiftui`, `ios-platform`, `swift-testing`, `xcode-tooling`. Enabling `python` wires a post-edit ruff hook (batched at Stop) + a pre-commit ruff/format/type-check (pyright\|mypy) gate (project root auto-detected by walking up to `pyproject.toml`; set `python_project_roots=backend` for a subdir backend); `fastapi` / `pytest` are skills+refs and each `requires: python`. Module `requires:` validated at SessionStart (warning, not blocking). Project-level `.claude/settings.local.json` `pluginConfigs.dhpk@dhpk.options.modules` **overrides** the global value — supports a single dev machine working on projects with different stacks. |
| `review_trigger_extra_paths` | `[]` | Extra path prefixes per reviewer slot. Format: `<slot>:<prefix>` where slot ∈ `code\|db\|sec\|fe\|doc\|mig`. Example: `code:protected/`, `fe:resources/views/`, `mig:db/migrate/`. |
| `hot_tables` | `[]` | Project-specific high-volume table names that `performance-analyzer` and `migration-reviewer` treat as elevated risk (large-ALTER downtime, N+1, missing composite index). Empty falls back to the agents' generic heuristics + CLAUDE.md. Example: `orders`, `order_lines`, `inventory`. |
| `reap_stale_mcp_processes` | `false` | When `true`, SessionStart reaps **orphaned** `gitnexus mcp` processes (parent session dead / reparented to init) — never a process owned by a live parallel session. Only useful for gitnexus MCP users. |
| `js_lint_script` | `"lint"` | npm script invoked by the `js` module's pre-commit gate. |
| `js_typecheck_script` | `"typecheck"` | npm script invoked by the `js` module's pre-commit gate. |
| `js_check_path` | `"js/"` | Path scanned by `/ts-check-status` for `// @ts-check` rollout progress. |
| `sentinel_commit_gate` | `"warn"` | `warn` \| `block` \| `off` — gate on `git commit/merge/rebase/cherry-pick` while reviewer sentinels exist. Override one-shot via `DHPK_SENTINEL_COMMIT_GATE`. |
| `branch_safety` | `"warn"` | `warn` \| `block` \| `off` — gate on history-mutating git ops (`commit/merge/rebase/cherry-pick/reset/push`) on protected branches. Override one-shot via `DHPK_BRANCH_SAFETY`. |
| `protected_branches` | `["main","master","develop","release/*","hotfix/*"]` | Branch glob list checked by `branch_safety`. Bash `case` glob syntax. |
| `skill_hint_enabled` | `true` | Whether the UserPromptSubmit hook prints a one-line route-table skill hint. Silence via `DHPK_DISABLE_SKILL_HINT=1` (one-shot) or set this `false` (persistent). |
| `learning_db_enabled` | `false` | (v0.6.0) Enable the `.claude/artifacts/learning.jsonl` operational signal store (reviewer pass / subagent failure / abnormal stop). Surfaces as a `[learned-context]` block at SessionStart. |
| `graduation_scan_enabled` | `false` | (v0.6.0) Enable the Stop hook that scans session transcripts for cited auto-memory entries and drafts `graduation-candidates.md` promotion proposals. |
| `lockfile_sync_commands` | `[]` | (v0.10.0) Per-manifest lock-sync commands for the async PostToolUse manifest-guard reminder, `<manifest>:<command>` (e.g. `composer.json:docker exec -i my_php composer update --lock`). Unlisted manifests fall back to a generic default. Commands must not contain commas. |
| `php_bin` | `"php"` | (v0.10.0) PHP binary / wrapper for the `php-5.6` module's async `php -l` post-edit syntax check (e.g. `docker exec -i my_php php`); self-skips when the first word is not on PATH. |
| `completion_evidence_enabled` | `false` | (v0.10.0) Stop advisory warning when the assistant claims completion while the tree has code changes but no matching test changes (doc/harness-only exempt; defers to active sentinels). One-shot `DHPK_COMPLETION_EVIDENCE=1/0`. |
| `agent_warmstart_enabled` | `false` | (v0.10.0) PreToolUse (Task\|Agent) hook injecting parent-session context (active sentinels + reviewer slots, current OpenSpec change + tasks, `.claude/warmstart-context.md`, tool-routing reminder; ≤2000 chars) into subagent prompts. One-shot `DHPK_AGENT_WARMSTART=1/0`. |
| `harness_restore_hint` | `""` | (v0.10.0) Command line printed by the SessionStart broken-symlink advisory (for harnesses deployed via symlinks from a separate repo). Empty prints the WARN without a hint line. |
| `js_frontend_roots` | `[]` | (v0.10.0) Project override for the `js` module's tier detection — root dirs scanned for first-party JS/TS. Empty falls back to `modules/js/module.yaml` (default `[js, src]`). |
| `js_core_files` | `[]` | (v0.10.0) Project override — basenames at a frontend root that are first-party entry bundles (linted) rather than vendor. Empty falls back to `module.yaml`. |
| `js_vendor_globs` | `[]` | (v0.10.0) Project override — glob path prefixes treated as vendored (lint-skipped at any depth), e.g. `js/ckeditor/`, `js/jquery-*`. Globs must not contain commas. Empty falls back to `module.yaml`. |
| `swiftlint_bin` | `"swiftlint"` | (v0.7.0) Binary for the `xcode-tooling` post-edit SwiftLint hook; self-skips when absent. |
| `xcode_scheme` | `""` | (v0.7.0) Scheme for the `xcode-tooling` pre-commit build gate; empty skips the gate (no scheme guessing). |
| `xcode_destination` | `""` | (v0.7.0) Test-step `-destination` for the pre-commit gate; empty auto-picks the first available simulator (the build step always uses a device-name-free generic destination). |
| `swift_build_skip_tests` | `false` | (v0.7.0) When `true`, the Swift pre-commit gate builds only (no `xcodebuild test` / `swift test`). |
| `php_cs_fixer_bin` | `"vendor/bin/php-cs-fixer"` | Binary for the `php-7.4` module's post-edit php-cs-fixer hook + pre-commit gate. |
| `phpstan_bin` | `"vendor/bin/phpstan"` | PHPStan binary for the `php-7.4` module's pre-commit gate. |
| `psalm_bin` | `"vendor/bin/psalm"` | Psalm binary for the `php-7.4` module's pre-commit gate. |

Examples:

```bash
# Plain install with defaults (7-slot reviewer dispatch on the default agent names).
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

6 skills require the **Codex MCP server** (`mcp__codex__codex`, `mcp__codex__codex-reply`):

```
codex-architect       codex-brainstorm     codex-cli-review
codex-code-review     codex-explain        codex-implement
```

Without Codex installed, invoking any of these will surface a tool-permission error. Install separately (see Anthropic's Codex documentation), then these become available.

All other skills (~51) have no MCP dependencies.

## External code-navigation tools

`cx`, `gitnexus`, and `claude-mem` are **optional** dependencies — not bundled, not auto-installed. The shipped agents / skills / rules assume they may be missing and provide deterministic fallbacks via [`rules/tool-routing.md`](./rules/tool-routing.md).

| Tool | Used by (selected) | What you lose if missing |
|------|-------------------|--------------------------|
| `cx` CLI | Agents: `code-reviewer`, `doc-reviewer`, `doc-updater`, `frontend-reviewer`, `migration-reviewer`, `refactor-cleaner`. Skills: `harness-fill`, `tool-routing`, `polyfill-version-matrix-audit`. Rule: `tool-routing.md` (primary for `cx overview` / `cx definition` / `cx references`). | Sub-200-token file overviews and AST-precise symbol reads — falls back to `Grep` + `Read` (more tokens, less precision). |
| `gitnexus` MCP | Dedicated skills: `gitnexus-cli`, `gitnexus-debugging`, `gitnexus-exploring`, `gitnexus-guide`, `gitnexus-impact-analysis`, `gitnexus-refactoring`. Agents: `architect`, `code-reviewer`, `database-reviewer`, `migration-reviewer`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `ui-ux-verifier`. Rules: `execution-policy.md` self-check (`gitnexus_impact`), `tool-routing.md`. | Cross-file blast-radius analysis (`gitnexus_impact`), safe global rename (`gitnexus_rename`), pre-commit scope check (`gitnexus_detect_changes`) — falls back to `cx references` / `git diff --stat` / **find-and-replace forbidden**. |
| `claude-mem` | Rule: `tool-routing.md` entry "Past decisions (cross-session)". | Cross-session memory recall — current-session context still works via scrollback. |

Detailed routing tie-breakers live in [`rules/tool-routing.md`](./rules/tool-routing.md); the prose / sub-agent boilerplate version lives in the `dhpk:tool-routing` skill.

## Rules (resource layer)

`rules/` ships three plain-markdown files that are **not** registered in `plugin.json` and are opt-in per consuming project. Load them from your project's `CLAUDE.md` with `@${CLAUDE_PLUGIN_ROOT}/rules/<file>.md`. Currently shipped:

- `execution-policy.md` — pre-plan checklist, anti-loop, self-check gates.
- `tool-routing.md` — the `cx` / `gitnexus` / `claude-mem` decision tree referenced above.
- `anti-rationalization.md` — guard against post-hoc justification when checks fail.

## Modules

A **module** is a labeled, version-tagged bundle of skills + references + hooks + trigger contributions, gated by `userConfig.modules`. Modules across the same axis (PHP / Laravel / PHPUnit) are **additive** — a library spanning Laravel 6–11 should enable each version to get cumulative guidance. Currently shipped:

**PHP language baselines** — pick the version(s) your composer `require.php` constraint spans:
- **`php-5.6`** — forbids 7.0+ syntax; polyfill guidance.
- **`php-7.4`** — typed properties, arrow functions, null coalescing assignment. Wires the **php-cs-fixer post-edit hook** + pre-commit lint + phpstan + psalm gate.
- **`php-8.x`** — readonly, enums, match, named args, attributes, first-class callable syntax.

**Frameworks**:
- **`yii-1.1`** — Yii 1.1: alias autoload, `CActiveRecord` / `CDbCriteria`, `accessRules`, XSS / CSRF defaults. Requires `php-5.6`.
- **`laravel-5.4`** — Laravel 5.4 (LTS, Feb 2017): Blade components & slots, route model binding, middleware groups, realtime facades, markdown mailables, the Elixir → Mix transition; 5.3 → 5.4 traps. Requires `php-5.6`.
- **`laravel-6`** … **`laravel-11`** — one module per major. Per-version: Eloquent / collection / cast / migration / queue / event / mail / notification / package-discovery deltas; Testbench mapping; deprecation walls.

**Testing**:
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API and patterns. Requires `php-5.6`.
- **`phpunit-9`** / **`phpunit-10`** / **`phpunit-11`** — per-major API deltas (`createMock` vs `createPartialMock`, attribute-based metadata, deprecation surface).

**Frontend**:
- **`js`** — JS / TS tooling. ESLint flat-config tier strategy (Tier 1 strict / 1.5 core-exempt / 1.7 deferred-migration / globals), per-leaf `// @ts-check` rollout, async post-edit ESLint feedback, pre-commit `npm run <lint> + <typecheck>` gate. Framework-agnostic.
- **`vue-2`** — Vue 2 (Options API era, `^2.5`): `data()` / `computed` / `methods` / `watch` + lifecycle shape, props-down + `$emit` events-up, the Vue 2 reactivity traps (`Vue.set` / array index & length), `@vue/test-utils` 1.x + `vue-jest` 3 SFC testing. Predates the Composition API.
- **`laravel-mix`** — Laravel Mix 5 (`^5.0.9`, webpack 4): `webpack.mix.js` entry/output mapping, `mix()` versioning + manifest, the `dev` / `watch` / `hot` / `prod` script ladder, and the legacy-OpenSSL prod-build flag on newer Node.

**Cross-cutting**:
- **`library-author`** — Cross-cutting glue for multi-major-version PHP libraries (Laravel 6–11, Monolog 2/3, PHPUnit 8–11, Flysystem 1/3 etc.). Ships the **sixth-color** `polyfill-reviewer` agent (sentinel-driven via `.pending-polyfill-review`), the `polyfill-version-matrix-audit` skill, the `matrix-cell-onboard` skill (+ root-level `/dhpk:matrix-cell-onboard` alias), an OpenSpec artifact guard, and a dual-testsuite mapping helper. Auto-fires on `.php` edits containing runtime version guards (`version_compare`, `class_exists`, `method_exists`, `Composer\InstalledVersions::*`).

**iOS / Swift** (dependency-chained — each `requires: swift`; enable the whole set via the `ios-app` install profile):
- **`swift`** — Swift 6 strict-concurrency baseline + Swift 5.10 / iOS 17 compatibility + Swift 6.2 approachable-concurrency. The foundation the rest of the suite requires.
- **`swiftui`** — MVVM + Coordinator, Observation (`@Observable` / `@Bindable`), `NavigationStack` routing, Combine / UIKit interop. Requires `swift`.
- **`ios-platform`** — health/PHI iOS SDK: Core Data encryption, CryptoKit + Keychain, actor offline store, Vision OCR, LocalAuthentication, UserNotifications, HealthKit, privacy compliance. Requires `swift`.
- **`swift-testing`** — XCTest + Swift Testing, XCUITest, snapshot testing, a 3-layer test taxonomy, protocol-DI host testing. Requires `swift`.
- **`xcode-tooling`** — SwiftLint post-edit hook + xcodebuild/SPM pre-commit build+test gate (generic build destination, simulator auto-fallback, toolchain self-skip) + `ios-icon-gen` skill. Requires `swift`.

When enabled, a module:
- Makes its skills invocable as `dhpk:<skill-name>` (e.g. `dhpk:php-pro`, `dhpk:yii1-security-audit`, `dhpk:js-lint-config`). *(Skill **descriptions** are listed for every shipped module regardless of `modules` — see the budget note below.)*
- Contributes path triggers to `post-edit-remind` so reviewers fire on framework-specific paths.
- May contribute hooks under `modules/<m>/hooks/post-edit-*.sh` and `modules/<m>/hooks/pre-{bash,commit}-*.sh`, fanned out by the dispatcher when the module is active. See [`docs/hook-extension.md`](./docs/hook-extension.md).
- Prints a SessionStart activation line so Claude knows the module is in scope.

> **Skill listing is always-on, not module-gated.** Claude Code registers every shipped module's skill *descriptions* from the plugin manifest at load time, so `modules` gates **hooks, path triggers, and the SessionStart activation line — not** the skill listing ([#12](https://github.com/hmj1026/dhpk/issues/12); a plugin-manifest limitation — `skillOverrides` can't hide plugin skills either). On a machine running many stacks this can overflow Claude Code's skill-listing budget and truncate/drop descriptions (visible via `/doctor`). Raise `skillListingBudgetFraction` in `settings.json` (default ~1% of the context window — try `0.02`–`0.03`) to keep all descriptions intact; or install fewer modules / disable the whole plugin with `/plugin` on projects that don't need it.

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
├── agents/                       # 22 role-based agents (INDEX.md is navigation)
├── commands/                     # ~73 slash commands (do, create-dev, codex-*, smart-commit, opsx-apply-resume, matrix-cell-onboard, ...)
├── skills/                       # ~57 core skills (adaptive-dev-workflow, codex-*, tool-routing, dhpk-execution-policy, opsx-apply-resume helpers, harness-fill, ...)
├── templates/                    # hook-bootstrap templates (graduation-candidates.md — copied to .claude/artifacts/ on first graduation run)
├── rules/                        # plain-markdown governance rules (execution-policy, tool-routing, anti-rationalization) — not in plugin.json; opt-in via ${CLAUDE_PLUGIN_ROOT}/rules/*.md from a consuming project's CLAUDE.md
├── modules/                      # 27 opt-in stack modules
│   ├── php-5.6/, php-7.4/, php-8.x/        # {module.yaml, skills/, references/, hooks/ (php-7.4 only)}
│   ├── yii-1.1/                            # Yii 1.1 framework
│   ├── phpunit-5.7/, phpunit-9/, phpunit-10/, phpunit-11/
│   ├── laravel-5.4/, laravel-6/ … laravel-11/  # one per major (5.4 requires php-5.6)
│   ├── js/{module.yaml, hooks/, skills/, commands/, references/}
│   ├── vue-2/, laravel-mix/                # frontend: Vue 2 SFC + Laravel Mix 5 asset pipeline
│   ├── library-author/{module.yaml, agents/, skills/, hooks/, references/}
│   └── swift/, swiftui/, ios-platform/, swift-testing/, xcode-tooling/  # iOS/Swift suite (xcode-tooling adds hooks/ + skill scripts)
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
