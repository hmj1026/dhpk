# dhpk — Dev Harness Plugin Kit for Claude Code

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Version](https://img.shields.io/github/v/tag/hmj1026/dhpk?label=version&sort=semver)](https://github.com/hmj1026/dhpk/tags) [![CI](https://img.shields.io/github/actions/workflow/status/hmj1026/dhpk/ci.yml?branch=main&label=CI)](https://github.com/hmj1026/dhpk/actions/workflows/ci.yml) [![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](https://docs.claude.com/en/docs/claude-code/plugins)

A generic, install-and-go Claude Code harness. Ships **27 role-based agents** (26 root + 1 module-scoped reviewer), ~45 registered dhpk commands (44 root + the `ts-check-status` JS-module command; the bundled codex / gitnexus / git trees ship their own separately), ~59 core skills + the `deploy-list` cross-project deploy file list generator + the **`/dhpk:do` Smart Router** (natural-language task routing via 20-pattern bilingual route table + LLM fallback) + **cross-session learning DB** (operational signal store with confidence decay, opt-in), **7-slot sentinel-driven review hooks** (code / db / sec / frontend / doc / **polyfill** / **migration** — polyfill via `library-author`, migration via module triggers or a `mig:` extra path; `doc-reviewer` covers both SSOT/link-validity and frontmatter schema for `.md` DSL artifacts), statusline, harness scripts, and **27 opt-in stack modules** across PHP (`php-5.6`, `php-7.4`, `php-8.x`), Yii (`yii-1.1`), PHPUnit (`phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11`), Laravel (`laravel-5.4`, `laravel-6` through `laravel-11`), JS (`js`), Vue (`vue-2`), Laravel Mix (`laravel-mix`), Python (`python`, `fastapi`, `pytest`), the cross-cutting `library-author` module, and an **iOS/Swift suite** (`swift`, `swiftui`, `ios-platform`, `swift-testing`, `xcode-tooling`). Modules contribute hooks at runtime via the **wrapper-dispatch** model (see [`docs/hook-extension.md`](./docs/hook-extension.md)). Parallel Codex CLI tree included for dual-assistant projects.

> **Harness engineering over prompt engineering.** dhpk treats the agent's operating environment — hooks, sentinel review gates, routing rules, and stack-aware modules — as the unit of leverage. Rather than hand-tuning one-off prompts, you install a reusable harness that makes the right checks fire automatically and keeps the model on the rails across sessions.

OpenSpec is an **optional external integration** — install the [OpenSpec plugin](https://github.com/Fission-AI/OpenSpec) separately if you want OpenSpec workflow commands. dhpk retains only its own value-add helper `opsx-apply-resume` (long-running OpenSpec session context handoff); the 10 generic OpenSpec wrapper skills/commands were unbundled in v0.2.1 since OpenSpec ships them upstream.

## Prerequisites

| Tool | Status | Why |
|------|--------|-----|
| `bash` | Required | All hook and helper scripts |
| `git` | Required | Sentinel/artifact path resolution; `git rev-parse --show-toplevel` |
| `python3` | Required IF you enable `modules` | Parses `module.yaml` in `post-edit-remind` and `session-start` |
| `jq` | Optional (python3 fallback exists) | Faster JSON payload extraction |
| `docker` | Optional | Only consulted when `userConfig.docker_containers` is non-empty |
| Codex MCP server | Optional | Required ONLY if you invoke the 5 MCP-backed `codex-*` skills, the 7 `/dhpk:codex-*` commands, or use `CODEX=on` — registered by pointing Claude Code at the Codex CLI's `codex mcp-server` subcommand, see [`docs/configuration.md`](./docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob) |
| Codex CLI binary | Optional | Required ONLY if you run `install-codex-skills.sh` and want Codex to actually load the synced content |
| `cx` CLI | Optional | Semantic code navigation. Primary tool in `rules/tool-routing.md` for `cx overview` / `cx definition` / `cx references`. Referenced by 6 reviewer agents and the `harness-fill` skill. Missing → falls back to `Grep` / `Read`. |
| `gitnexus` MCP server | Optional | Knowledge-graph queries (`gitnexus_impact`, `gitnexus_rename`, `gitnexus_detect_changes`). Required by 6 `gitnexus-*` skills and the `rules/execution-policy.md` self-check. Missing → falls back to `cx` or `Grep`. |
| `claude-mem` | Optional | Cross-session memory search (`mem-search`). Referenced by `rules/tool-routing.md` for past-decision lookups. Missing → skip. |

Missing optional tools degrade gracefully (the script no-ops or skips a feature). Missing required tools surface as a single-line `[hook-name] WARN: …` to stderr at SessionStart or first hook fire so you can act on them.

External code-navigation tools (`cx`, `gitnexus`, `claude-mem`) are **not bundled** by dhpk. Each consuming project decides whether to install them. The shipped rules and agents are written to degrade gracefully via [`rules/tool-routing.md`](./rules/tool-routing.md).

## Install

dhpk follows the standard [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins). Fastest path (no clone needed):

```bash
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk --config modules=php-8.x,laravel-11 --config hook_profile=standard
```

**Requirements**: Claude Code 2.x. Codex MCP is **optional** — it powers the `codex-*` skills/commands and the `CODEX=on` dual-assistant path; everything else is Codex-free. Setup and verification: [`docs/configuration.md`](./docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob).

Reconfigure any time with `/dhpk:setup` (or `/dhpk:setup --show` to print the current config). Full install paths (GitHub vs. local clone), update/uninstall, and troubleshooting live in **[`docs/basic-operations.md`](./docs/basic-operations.md)**. Full `--config` knob reference: **[`docs/configuration.md`](./docs/configuration.md)**.

## What you get

| Component | Count | Notes |
|-----------|------:|-------|
| Agents | 26 root-level agents | 7 sentinel-driven reviewers across the slots: code / db / sec / **frontend** / **doc** / **polyfill** (slot 5, written by `library-author`) / **migration** (slot 6, opt-in via module triggers or a `mig:` extra path). Situational: architect, tdd-guide, refactor-cleaner, ui-ux-verifier, performance-analyzer, doc-updater, docs-lookup, harness-reviser, version-matrix-impact-reviewer, **swift-build-resolver** (iOS suite), **silent-failure-hunter** (error-handling audit), **spec-miner** (brownfield→OpenSpec extraction), **type-design-analyzer**, **agent-evaluator** (output-quality scorecard), **e2e-runner** (E2E journeys). |
| Commands | ~45 | `dhpk:do` (Smart Router), `dhpk:create-dev`, `dhpk:codex-*`, `dhpk:review-pending`, `dhpk:smart-commit`, `dhpk:ts-check-status` (JS module), `dhpk:opsx-apply-resume` (needs OpenSpec), `dhpk:matrix-cell-onboard` (library-author), `dhpk:de-ai-flavor`, `dhpk:deploy-list`, `dhpk:harness-fill`, `dhpk:ui-ux-verify`, etc. |
| Core skills | ~59 + extras | codex-*, gitnexus, tool-routing, dhpk-execution-policy, **adaptive-dev-workflow** (Feature/Bug/Maintenance classifier), **deploy-list** (cross-project deploy file list generator), **execution-checklist** (end-of-task self-check), `opsx-apply-resume` helpers (need OpenSpec) |
| Stack modules | 27 | PHP: `php-5.6`, `php-7.4`, `php-8.x` · Yii: `yii-1.1` · PHPUnit: `phpunit-5.7`, `phpunit-9`, `phpunit-10`, `phpunit-11` · Laravel: `laravel-5.4`, `laravel-6` … `laravel-11` · Frontend: `js`, `vue-2`, `laravel-mix` · **Python**: `python`, `fastapi`, `pytest` · `library-author` · **iOS**: `swift`, `swiftui`, `ios-platform`, `swift-testing`, `xcode-tooling` (opt-in; see "Modules" below) |
| Hooks | 9 events | PreToolUse (Edit, Bash + dispatcher + sentinel-gate + branch-safety, Task\|Agent warmstart), PostToolUse (Edit + dispatcher + async crlf-fix + async manifest-guard), SessionStart (+ version-pin / cross-CLI-drift / broken-symlink advisories), PreCompact (checkpoint archive), PostCompact (sentinel restore), SubagentStop (reviewer verify + failure log), StopFailure (failure log), UserPromptSubmit (skill hint), Stop (review-reminder + completion-evidence + graduation-scan + reap-stale-sentinels) |
| Hook dispatchers | 2 | `post-edit-dispatch.sh`, `pre-bash-dispatch.sh` — fan out to active modules' hooks |
| Harness scripts | 5 | precommit-runner, verify-runner, harness-audit, codemap generator, dep-audit |
| Codex dual-track | 14 skills + 1 agent (5 config profiles) | Synced into project `.codex/` by `install-codex-skills.sh` |

## Common workflows

Everything is reachable through `/dhpk:do` — one entry point that routes natural-language task descriptions to the right skill: feature development, bug fixes, the automatic post-edit review cycle, commit/PR, unattended OpenSpec sessions, spec mining, E2E test authoring, harness health checks, and Implementation dispatch (reasoning-heavy work → `deep-reasoner`, mechanical work → `fast-worker`). Full walkthrough with worked examples for each: **[`docs/basic-operations.md`](./docs/basic-operations.md)**.

```text
/dhpk:do implement a password-reset email flow   # feature (TDD + review gates)
/dhpk:do fix the login redirect loop              # bug fix (root cause + regression test)
/dhpk:review-pending                              # trigger pending reviewers immediately
/dhpk:smart-commit && /dhpk:create-pr             # commit + PR
/harness-audit                                    # harness health scorecard
```

---

## userConfig

40 knobs, all settable at install time with `--config <key>=<value>`, reconfigurable any time via `/dhpk:setup`. Full reference (where to set each one, every option, project-level override syntax): **[`docs/configuration.md`](./docs/configuration.md)**.

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

See `manifests/install-profiles.json` for curated module bundles.

## Codex-backed skills and commands

dhpk's core — hooks, sentinel reviewers, the Smart Router, and ~51 other skills — is Codex-free. The `codex-*` family delegates to OpenAI's Codex for a second opinion. Their `mcp__codex__codex` / `mcp__codex__codex-reply` tools come from directly registering the Codex CLI's own `codex mcp-server` subcommand as an MCP server (`claude mcp add --transport stdio codex -- codex mcp-server`) — **not** from installing the `openai/codex-plugin-cc` plugin, which drives a separate Codex surface and registers no MCP server. See the [how-it-works aside in `docs/configuration.md`](./docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob) for the full registration steps and the plugin-vs-MCP-server contrast.

| Surface | Names | Needs | Without it |
|---------|-------|-------|------------|
| 5 skills | `codex-architect` · `codex-brainstorm` · `codex-code-review` · `codex-explain` · `codex-implement` | Codex MCP (`mcp__codex__codex`, `mcp__codex__codex-reply`) | Tool-permission error — no automatic fallback; use a Codex-free counterpart below |
| 1 skill | `codex-cli-review` | Codex CLI binary only (shells out via Bash — no MCP server) | `codex: command not found`; use `codex-code-review` (MCP) or the sentinel `code-reviewer` |
| 7 commands | `/dhpk:codex-review`, `-review-branch`, `-review-doc`, `-review-fast`, `-security`, `-test-gen`, `-test-review` | Codex MCP | Tool-permission error — Codex-free routes: `/dhpk:security-review`, `/dhpk:precommit`, sentinel review hooks |
| `CODEX=on` | Dual-assistant peer path in Implementation dispatch | Codex MCP | Nothing breaks — dispatch stays in its default single-assistant mode |

Codex-free counterparts: `security-review` ↔ `codex-security`, `code-explore` ↔ `codex-explain`, sentinel reviewer agents ↔ `codex-code-review`, and `create-dev` (Codex-free by default; `--codex` opts in).

One-time setup: register the Codex MCP server with `claude mcp add --transport stdio codex -- codex mcp-server`, then verify with `claude mcp list` and `/mcp` (look for a connected `codex` entry). Full verification steps, the MCP-vs-Skill surface distinction, and the separate `openai/codex-plugin-cc` collaboration surface: **[`docs/configuration.md`](./docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob)** / **[`docs/basic-operations.md`](./docs/basic-operations.md#10-codex-dual-assistant-collaboration)**.

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
- `model-economics.md` — cost/tier SSOT: role→model-tier map, reviewer-escalation rules, and the deep-reasoner/fast-worker effort dials.

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

For projects using both Claude Code and the standalone Codex CLI (distinct from the Codex MCP dependency above — this needs no MCP server): `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"` mirrors dhpk's skills/agents into the project's `.codex/`, plus an experimental Codex Plugin Marketplace path. Full instructions: **[`docs/basic-operations.md`](./docs/basic-operations.md#sync-codex-cli-content)**.

## Migrating an existing project

If the project already has its own `.claude/` harness, dhpk supports a phased parallel-install → hook-parity → cutover plan with a rollback gate at each phase. Full 6-phase walkthrough: **[`docs/basic-operations.md`](./docs/basic-operations.md#migrating-an-existing-project)**.

## Repository layout

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # one-entry marketplace (plugins[0].source: "./")
│   └── plugin.json               # plugin manifest with userConfig
├── agents/                       # 27 role-based agents (INDEX.md is navigation)
├── commands/                     # ~45 slash commands (do, create-dev, codex-*, smart-commit, opsx-apply-resume, matrix-cell-onboard, ...)
├── skills/                       # ~59 core skills (adaptive-dev-workflow, codex-*, tool-routing, dhpk-execution-policy, opsx-apply-resume helpers, harness-fill, ...)
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
│   ├── hooks/                    # core hooks incl. post-edit-dispatch.sh, pre-bash-dispatch.sh, reap-stale-sentinels.sh, _lib/{payload,portable-sed,portable-timeout}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/, lib/, opsx-apply-resume/, validate/
│   └── (harness-audit, precommit-runner, verify-runner, gemini-adapt-agents, dep-audit)
├── docs/
│   ├── configuration.md, configuration.zh-TW.md      # full userConfig reference
│   ├── basic-operations.md, basic-operations.zh-TW.md # install + workflow lifecycle
│   ├── hook-extension.md         # wrapper-dispatch contract + module-hook authoring
│   ├── recommended-permissions.md
│   ├── docker-setup.md, subagent-prompt-template.md
├── codex/                        # Codex CLI dual-track (Claude Code does NOT auto-load)
│   ├── AGENTS.md                 # Codex-specific guidance
│   ├── README.md                 # how to sync into a project
│   ├── skills/, agents/, config.toml.example
├── .codex-plugin/plugin.json     # Codex plugin manifest (marketplace-installable, experimental)
├── plugins/dhpk/                 # thin marketplace-target wrapper (openai/codex#26037)
│   ├── .codex-plugin/plugin.json
│   ├── README.md
├── .agents/plugins/marketplace.json  # repo-scoped Codex marketplace descriptor
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

See [CHANGELOG.md](./CHANGELOG.md) for release history.
