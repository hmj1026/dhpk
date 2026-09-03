# dhpk — Dev Harness Plugin Kit for Claude Code

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)
>
> Skill-platform upgrade: [English](./docs/skill-platform-migration.md) · [繁體中文](./docs/skill-platform-migration.zh-TW.md)
>
> Platform installation SSOT: [English](./docs/platform-installation.md) · [繁體中文](./docs/platform-installation.zh-TW.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Version](https://img.shields.io/github/v/tag/hmj1026/dhpk?label=version&sort=semver)](https://github.com/hmj1026/dhpk/tags) [![CI](https://img.shields.io/github/actions/workflow/status/hmj1026/dhpk/ci.yml?branch=main&label=CI)](https://github.com/hmj1026/dhpk/actions/workflows/ci.yml) [![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-8A63D2)](https://docs.claude.com/en/docs/claude-code/plugins) [![Codex project sync](https://img.shields.io/badge/Codex%20project%20sync-supported-412991)](./docs/platform-installation.md#codex-project-local-sync-supported) [![Cursor project sync](https://img.shields.io/badge/Cursor%20project%20sync-supported-F2A900)](./docs/platform-installation.md#cursor-project-local-sync-supported) [![Native packages](https://img.shields.io/badge/native%20packages-experimental-orange)](./docs/platform-installation.md#surface-matrix)

A generic, install-and-go Claude Code harness. It ships **36 role-based agents** (35 root-level agents plus one module-scoped reviewer), registered dhpk commands, six task-shaped capability families, a cross-session learning DB (opt-in), **7-slot sentinel-driven review hooks** (code / db / sec / frontend / doc / polyfill / migration), statusline, harness scripts, and **31 opt-in stack modules** across PHP, Yii, PHPUnit, Laravel, JavaScript, Vue, Laravel Mix, Next.js, React, Python, and iOS/Swift. Modules contribute hooks at runtime via the **wrapper-dispatch** model (see [`docs/hook-extension.md`](./docs/hook-extension.md)). A curated Codex CLI projection is included for dual-assistant projects.

> **Harness engineering over prompt engineering.** dhpk treats the agent's operating environment — hooks, sentinel review gates, routing rules, and stack-aware modules — as the unit of leverage. Rather than hand-tuning one-off prompts, you install a reusable harness that makes the right checks fire automatically and keeps the model on the rails across sessions.

OpenSpec is an **optional external integration** — install the [OpenSpec plugin](https://github.com/Fission-AI/OpenSpec) separately if you want OpenSpec workflow commands. dhpk retains only its own value-add helper `opsx-apply-resume` (long-running OpenSpec session context handoff); the 10 generic OpenSpec wrapper skills/commands were unbundled in v0.2.1 since OpenSpec ships them upstream.

## Prerequisites

| Tool | Status | Why |
|------|--------|-----|
| `bash` | Required | All hook and helper scripts |
| `git` | Required | Sentinel/artifact path resolution; `git rev-parse --show-toplevel` |
| `python3` | Required IF you enable `modules` | Parses `module.yaml` for opt-in module activation and routing |
| `jq` | Optional (python3 fallback exists) | Faster JSON payload extraction |
| `docker` | Optional | Used only by an explicitly registered Docker workflow with `userConfig.docker_containers` |
| Codex CLI binary | Optional | Required only for CLI-backed roles/reviews, `codex exec` second opinions, or `install-codex-skills.sh` when Codex should load the synced content |
| Cursor | Optional | Required ONLY if you run `install-cursor-harness.sh` and want Cursor to load the project-local `.cursor/` harness |
| `cx` CLI | Optional | Semantic code navigation. Primary tool in `rules/tool-routing.md` for `cx overview` / `cx definition` / `cx references`. Referenced by 6 reviewer agents and the `code-trace` family. Missing → falls back to `Grep` / `Read`. |
| `gitnexus` MCP server | Optional | Knowledge-graph queries (`gitnexus_impact`, `gitnexus_rename`, `gitnexus_detect_changes`). Required by 6 `gitnexus-*` skills and the `rules/execution-policy.md` self-check. Missing → falls back to `cx` or `Grep`. |
| `claude-mem` | Optional | Cross-session memory search (`mem-search`). Referenced by `rules/tool-routing.md` for past-decision lookups. Missing → skip. |

Missing optional tools degrade gracefully (the script no-ops or skips a feature). Missing required tools surface as a single-line `[hook-name] WARN: …` to stderr when an active hook needs them so you can act on them.

External code-navigation tools (`cx`, `gitnexus`, `claude-mem`) are **not bundled** by dhpk. Each consuming project decides whether to install them. The shipped rules and agents are written to degrade gracefully via [`rules/tool-routing.md`](./rules/tool-routing.md).

## Install

dhpk follows the standard [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins). Fastest path (no clone needed):

```bash
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk --config modules=php-8.x,laravel-11 --config hook_profile=standard
```

The direct GitHub marketplace entry is the raw compatibility route. A clean
default install that applies the measured pre-discovery boundary should use
`scripts/install.sh` (Path B in the basic-operations guide), which materializes
and installs `dhpk@dhpk-profile-minimal`.

**Requirements**: Claude Code 2.x. Current dhpk workflows are Codex-free by default. Optional Codex CLI and external app-server integrations are documented in the [Codex integration surfaces](#codex-integration-surfaces) section and [`docs/configuration.md`](./docs/configuration.md#codex-mcp-dependency-not-a-userconfig-knob).

Reconfigure any time with `/dhpk:setup` (or `/dhpk:setup --show` to print the current config). Full install paths (GitHub vs. local clone), update/uninstall, and troubleshooting live in **[`docs/basic-operations.md`](./docs/basic-operations.md)**. Full `--config` knob reference: **[`docs/configuration.md`](./docs/configuration.md)**.

## What you get

| Component | Count | Notes |
|-----------|------:|-------|
| Agents | Role-based agents | Sentinel-driven reviewers plus situational architecture, testing, security, documentation, platform, and runtime roles. |
| Commands | dhpk's 29 commands | `/dhpk:precommit`, `/dhpk:setup`, `/dhpk:review-pending`, `/dhpk:smart-commit`, `/dhpk:opsx-apply-resume`, `/dhpk:harness-audit`, `/dhpk:harness-govern`, `/dhpk:ui-ux-verify`, etc. |
| Canonical skills | 85 flat packages | One named package per capability, rooted at `skills/<public-name>/`; non-family packages retain the `skills/dhpk-*/` contract, while six portable families (`skill-scope`, `skill-forge`, `flow-guide`, `flow-drive`, `change-verdict`, `code-trace`) own the consolidated modes. |
| Stack modules | Opt-in stack modules | PHP, Yii, PHPUnit, Laravel, JavaScript, Vue, Laravel Mix, Next.js, React, Python, `library-author`, and iOS/Swift modules. |
| Hooks | 4 events | PreToolUse (Edit guard and combined Bash safety/Git gate), PostToolUse (sentinel routing), SessionStart (module activation), SubagentStop (strict reviewer reconciliation) |
| Hook dispatchers | 2 | `post-edit-dispatch.sh` routes sentinels; `pre-bash-dispatch.sh` combines deterministic shell and Git/review-debt gates |
| Harness scripts | 5 | precommit-runner, verify-runner, harness-audit, codemap generator, dep-audit |
| Codex dual-track | 18 entries (16 invokable) | Project sync uses receipt-owned projections; the experimental native package publishes the same invokable set plus internal transport and dispatch-context runtimes as physical files. |

Invocation syntax is surface-specific:

| Surface | Syntax | Example |
|---|---|---|
| Claude command | `/dhpk:<command>` | `/dhpk:harness-audit` |
| Claude plugin skill | `/dhpk:<public-skill-name>` | `/dhpk:flow-guide` |
| Codex skill | `$<public-skill-name>` after discovery | `$flow-guide --mode classify` |

The six capability families use unprefixed public names; other first-party
skills retain the collision-safe `dhpk-` prefix. See the complete migration map in
[`docs/skill-platform-migration.md`](./docs/skill-platform-migration.md).
Lifecycle, public names, and publication surfaces are owned by
`manifests/distribution-inventory.json` rather than this prose.

## Common workflows

Use `flow-guide` to classify or advise, `flow-drive` to explicitly route or
implement a confirmed task, `code-trace` to investigate, `change-verdict` for
read-only review, `skill-scope` for skill governance, and `skill-forge` for
authoring. Full walkthrough with worked examples for each: **[`docs/basic-operations.md`](./docs/basic-operations.md)**.

```text
$flow-drive --mode route --route-only implement a password-reset email flow # inspect the route only
$flow-drive --mode implement implement a password-reset email flow   # feature (TDD + review gates)
$flow-drive --mode implement --worker=codex implement the plan   # explicit worker override
$code-trace --mode diagnose investigate the login redirect loop       # root-cause evidence
/dhpk:review-pending                              # trigger pending reviewers immediately
/dhpk:smart-commit && /dhpk:create-pr             # commit + PR
/dhpk:harness-audit                              # harness health scorecard
```

`--route-only` prints a user-facing `Route only: /...` result (or a bounded
classification/task prompt) and stops before planner, worker, OpenSpec, or skill
execution. Its underlying helper exposes the machine-readable `MATCH`,
`NO_MATCH`, and `NO_QUERY` statuses. If the selected target is `explicit-only`,
the router prints the direct invocation and stops; it does not silently bypass
that boundary. Use the [basic operations guide](./docs/basic-operations.md) for
the full inspect → route → implement → review → verify → handoff flow.

---

## userConfig

59 knobs, all settable at install time with `--config <key>=<value>`, reconfigurable any time via `/dhpk:setup`. Full reference (where to set each one, every option, project-level override syntax): **[`docs/configuration.md`](./docs/configuration.md)**.

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-7.4,php-8.x,laravel-6,laravel-11,phpunit-9,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

See `manifests/install-profiles.json` for curated module bundles.

The default Claude discovery artifact is the materialized `minimal` profile,
generated from the distribution inventory rather than from an unfiltered scan of
the source `skills/` directory. It contains at most 15 implicit-eligible
entries. `full` and `compat-v1` remain explicit opt-in profile artifacts. The
Agent Plugin and Cursor publication memberships are unchanged; the source tree
remains the authoring tree.

## Codex integration surfaces

dhpk's core — hooks, sentinel reviewers, the Smart Router, and the workflow
skills — runs without a Codex MCP server. Optional Codex integrations are
separate surfaces with explicit ownership:

| Surface | Names / entrypoint | Requirement | Failure or boundary |
|---------|--------------------|-------------|--------------------|
| CLI-only Codex path | `change-verdict --mode code --backend cli`; sibling roles `codex-worker`, `codex-reasoner`, `codex-reviewer`, and `dhpk-codex-bridge` | Codex CLI binary and Bash shell-out through the hardened wrapper; no MCP server | Missing `codex` is reported as an unavailable optional backend; the current-model path remains the default |
| External app-server plugin | `openai/codex-plugin-cc` and its `/codex:*` commands | Explicitly installed external plugin; it drives `codex app-server` | It is independent of dhpk skills, CLI review, and the retired MCP mechanism |
| Historical retired MCP | `mcp__codex__codex`, `mcp__codex__codex-reply`, and `codex mcp-server` | Retired in this migration; no current dhpk capability requires or recommends it | Historical context only. See the [retirement ledger](./docs/skill-platform-migration.md#alias-free-codex-mcp-retirement-ledger) and [capability-parity matrix](./docs/codex-mcp-capability-parity.md) for each capability's successor |

The historical MCP row is not a setup path. It records the transport that
previously powered the retired Codex-backed routes and why their capabilities
now live in backend-neutral owners. No active dhpk skill or command depends on
that server. The parity matrix records the retained CLI, current-model, or
isolated-review behavior for every migrated capability.

`CODEX=on` and `/dhpk:do --codex` are removed legacy MCP-peer interfaces. They
are not aliases for `codex exec`, `--worker=codex`, `--reasoner=codex`, or the
external app-server plugin. Use the explicit `/dhpk:flow-drive` path
for current-model implementation, `--worker=codex` or `--reasoner=codex` when
an external CLI role is explicitly selected, and an explicitly named
`codex exec` second opinion where a migrated skill supports it. A deprecated
legacy flag produces a deprecation diagnostic rather than selecting a hidden
backend.

The former `/dhpk:codex-security` command semantics are now covered by the
backend-neutral `change-verdict` security mode; the former review family uses
`change-verdict --mode code --backend cli` where a CLI review is requested.
Neither path reaches the retired MCP server. The complete nine-identity
retirement and rollback ledger is in the migration guide.

## External code-navigation tools

`cx`, `gitnexus`, and `claude-mem` are **optional** dependencies — not bundled, not auto-installed. The shipped agents / skills / rules assume they may be missing and provide deterministic fallbacks via [`rules/tool-routing.md`](./rules/tool-routing.md).

| Tool | Used by (selected) | What you lose if missing |
|------|-------------------|--------------------------|
| `cx` CLI | Agents: `code-reviewer`, `doc-reviewer`, `doc-updater`, `frontend-reviewer`, `migration-reviewer`, `refactor-cleaner`. Skills: `harness-fill`, `code-trace`, `polyfill-version-matrix-audit`. Rule: `tool-routing.md` (primary for `cx overview` / `cx definition` / `cx references`). | Sub-200-token file overviews and AST-precise symbol reads — falls back to `Grep` + `Read` (more tokens, less precision). |
| `gitnexus` MCP | Dedicated skills: `gitnexus-cli`, `gitnexus-debugging`, `gitnexus-exploring`, `gitnexus-guide`, `gitnexus-impact-analysis`, `gitnexus-refactoring`. Agents: `architect`, `code-reviewer`, `database-reviewer`, `migration-reviewer`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `ui-ux-verifier`. Rules: `execution-policy.md` self-check (`gitnexus_impact`), `tool-routing.md`. | Cross-file blast-radius analysis (`gitnexus_impact`), safe global rename (`gitnexus_rename`), pre-commit scope check (`gitnexus_detect_changes`) — falls back to `cx references` / `git diff --stat` / **find-and-replace forbidden**. |
| `claude-mem` | Rule: `tool-routing.md` entry "Past decisions (cross-session)". | Cross-session memory recall — current-session context still works via scrollback. |

Detailed routing tie-breakers live in [`rules/tool-routing.md`](./rules/tool-routing.md); the prose / sub-agent boilerplate version lives in the `code-trace` family (`select-tool` mode).

## Rules (resource layer)

`rules/` ships four plain-markdown files that are **not** registered in `plugin.json` and are opt-in per consuming project. Load them from your project's `CLAUDE.md` with `@${CLAUDE_PLUGIN_ROOT}/rules/<file>.md`. Currently shipped:

- `execution-policy.md` — pre-plan checklist, anti-loop, self-check gates.
- `tool-routing.md` — the `cx` / `gitnexus` / `claude-mem` decision tree referenced above.
- `anti-rationalization.md` — guard against post-hoc justification when checks fail.
- `model-economics.md` — cost/tier SSOT: role→model-tier map, reviewer-escalation rules, and the deep-reasoner/fast-worker effort dials.

## Modules

A **module** is a labeled, version-tagged bundle of skills + references + hooks + trigger contributions, gated by `userConfig.modules`. Modules across the same axis (PHP / Laravel / PHPUnit) are **additive** — a library spanning Laravel 6–11 should enable each version to get cumulative guidance. Currently shipped:

**PHP language baselines** — pick the version(s) your composer `require.php` constraint spans:
- **`php-5.6`** — forbids 7.0+ syntax; polyfill guidance.
- **`php-7.4`** — typed properties, arrow functions, null coalescing assignment, plus php-cs-fixer, pre-commit lint, phpstan, and psalm guidance. Consumers explicitly register any formatter hook.
- **`php-8.x`** — readonly, enums, match, named args, attributes, first-class callable syntax.

**Frameworks**:
- **`yii-1.1`** — Yii 1.1: alias autoload, `CActiveRecord` / `CDbCriteria`, `accessRules`, XSS / CSRF defaults. Requires `php-5.6`.
- **`laravel-5.4`** — Laravel 5.4 (LTS, Feb 2017): Blade components & slots, route model binding, middleware groups, realtime facades, markdown mailables, the Elixir → Mix transition; 5.3 → 5.4 traps. Requires `php-5.6`.
- **`laravel-6`** … **`laravel-11`** — one module per major. Per-version: Eloquent / collection / cast / migration / queue / event / mail / notification / package-discovery deltas; Testbench mapping; deprecation walls.

**Testing**:
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API and patterns. Requires `php-5.6`.
- **`phpunit-9`** / **`phpunit-10`** / **`phpunit-11`** — per-major API deltas (`createMock` vs `createPartialMock`, attribute-based metadata, deprecation surface).

**Frontend**:
- **`js`** — JS / TS tooling. ESLint flat-config tier strategy (Tier 1 strict / 1.5 core-exempt / 1.7 deferred-migration / globals), per-leaf `// @ts-check` rollout, on-demand ESLint feedback, and a pre-commit `npm run <lint> + <typecheck>` gate. Framework-agnostic.
- **`vue-2`** — Vue 2 (Options API era, `^2.5`): `data()` / `computed` / `methods` / `watch` + lifecycle shape, props-down + `$emit` events-up, the Vue 2 reactivity traps (`Vue.set` / array index & length), `@vue/test-utils` 1.x + `vue-jest` 3 SFC testing. Predates the Composition API.
- **`laravel-mix`** — Laravel Mix 5 (`^5.0.9`, webpack 4): `webpack.mix.js` entry/output mapping, `mix()` versioning + manifest, the `dev` / `watch` / `hot` / `prod` script ladder, and the legacy-OpenSSL prod-build flag on newer Node.
- **`nextjs-15.5`** — Next.js 15.5 (current stable 15.x line, ends at v15.5.19; 15.6 never shipped stable). App Router, `next typegen`, stable typed routes (`typedRoutes`), beta Turbopack production builds (`next build --turbopack`), React 18/19 dual support, and the `next lint` deprecation (removed in 16).
- **`nextjs-16`** — Next.js 16 (current stable major, 16.2.x). Turbopack default for dev + build, async-only Request APIs (`params`/`searchParams`/`cookies`/`headers`), Node.js 20.9+ / TypeScript 5.1+ floors, `next lint` + AMP removed, `next/image` `priority`→`preload`, `next upgrade` CLI (16.1). Supports React 18.2+/19 (React 19 recommended, not required).
- **`react-18`** — React 18 (March 2022). `createRoot`/`hydrateRoot` (`react-dom/client`), automatic batching, opt-in concurrent features (`startTransition`/`useTransition`/`useDeferredValue`), streaming SSR (`renderToPipeableStream`), new hooks (`useId`/`useSyncExternalStore`/`useInsertionEffect`), and StrictMode dev-only effect double-invocation. React 18.2+ is the floor Next.js 16 supports.
- **`react-19`** — React 19 (December 2024). Actions + async transitions, new hooks (`useActionState`/`useOptimistic`/`useFormStatus`, `use()`), `ref` as a prop (no `forwardRef`), `<Context>` as provider, document metadata hoisting, resource preloading (`preload`/`preinit`), stable Server Components. Removes `ReactDOM.render`/`hydrate`, `propTypes`/`defaultProps` on function components, legacy Context, and string refs. Recommended (not required) for Next.js 16.

**Cross-cutting**:
- **`library-author`** — Cross-cutting glue for multi-major-version PHP libraries (Laravel 6–11, Monolog 2/3, PHPUnit 8–11, Flysystem 1/3 etc.). Ships the **sixth-color** `polyfill-reviewer` agent (sentinel-driven via `.pending-polyfill-review`), the `polyfill-version-matrix-audit` skill, the `matrix-cell-onboard` skill (+ root-level `/dhpk:dhpk-matrix-cell-onboard` alias), an OpenSpec artifact guard, and a dual-testsuite mapping helper. Auto-fires on `.php` edits containing runtime version guards (`version_compare`, `class_exists`, `method_exists`, `Composer\InstalledVersions::*`).

**iOS / Swift** (dependency-chained — each `requires: swift`; enable the whole set via the `ios-app` install profile):
- **`swift`** — Swift 6 strict-concurrency baseline + Swift 5.10 / iOS 17 compatibility + Swift 6.2 approachable-concurrency. The foundation the rest of the suite requires.
- **`swiftui`** — MVVM + Coordinator, Observation (`@Observable` / `@Bindable`), `NavigationStack` routing, Combine / UIKit interop. Requires `swift`.
- **`ios-platform`** — health/PHI iOS SDK: Core Data encryption, CryptoKit + Keychain, actor offline store, Vision OCR, LocalAuthentication, UserNotifications, HealthKit, privacy compliance. Requires `swift`.
- **`swift-testing`** — XCTest + Swift Testing, XCUITest, snapshot testing, a 3-layer test taxonomy, protocol-DI host testing. Requires `swift`.
- **`xcode-tooling`** — SwiftLint guidance, xcodebuild/SPM pre-commit build+test gate (generic build destination, simulator auto-fallback, toolchain self-skip), and `ios-icon-gen` skill. Requires `swift`; consumers explicitly register any SwiftLint hook.

When enabled, a module:
- Makes its skills invocable as `dhpk:<skill-name>` (e.g. `dhpk:dhpk-php-runtime-router`, `dhpk:dhpk-yii1-security-audit`, `dhpk:dhpk-js-lint-config`). *(Skill **descriptions** are listed for every shipped module regardless of `modules` — see the budget note below.)*
- Contributes path triggers to deterministic post-edit sentinel routing for framework-specific paths.
- May ship optional hook scripts under `modules/<m>/hooks/`; a consumer registers them explicitly. See [`docs/hook-extension.md`](./docs/hook-extension.md).
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

Modules may ship hook scripts under `modules/<stack>-<version>/hooks/`. Their activation depends on the hook class:

- `post-edit-*.sh` — register explicitly for advisory post-edit work.
- `pre-bash-*.sh` / `pre-commit-*.sh` — run automatically through the combined
  `PreToolUse(Bash)` dispatcher when that module is active; non-zero status may
  block the Bash call.

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

The statusline renders `[branch] +staged ~modified | docker:status | profile=<p> | mod=<active> | ⚠ <pending-sentinels>` and falls back to the global `~/.claude/statusline.sh` for tokens/model/rate-limit lines. Sentinel badges are generated from the shared `SENTINEL_SHORT_NAMES` map, so the seven review slots stay in SSOT order (including `⚠ mig` for migration review).

## Sync Codex CLI content

For projects using both Claude Code and the standalone Codex CLI (separate
from the retired MCP mechanism above), the supported path is `bash
"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"`. Its default
hybrid projection keeps skills/supporting assets linked to the plugin root but
always materializes agent TOMLs as physical files; `--copy` is the fully
physical portable fallback. It creates the curated Codex projection in the
project's `.codex/`. The clean-install materialization proof for [issue #88](https://github.com/hmj1026/dhpk/issues/88)
now passes for the shipped physical package; Codex Plugin Marketplace support
nevertheless remains experimental until a separate graduation decision. Full
policy and instructions: **[`docs/basic-operations.md`](./docs/basic-operations.md#sync-codex-cli-content)**.

## Sync Cursor project-local harness

For projects that want Cursor to load dhpk skills, subagents, `.mdc` rules, and
commands from the project itself (not only from `~/.cursor/plugins/local/`),
the supported path is `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh"`.
Cursor retains its all-symlink default; `--copy` is the portable fallback. The
installer writes a schema-v3 receipt at `.cursor/.dhpk-installed.json` and does
not write `.cursor/hooks.json`. Keep `plugins/dhpk-cursor/` for the marketplace
/ user-plugin route. Full policy: **[`docs/platform-installation.md`](./docs/platform-installation.md)**.

## Migrating an existing project

If the project already has its own `.claude/` harness, dhpk supports a phased parallel-install → hook-parity → cutover plan with a rollback gate at each phase. Full 6-phase walkthrough: **[`docs/basic-operations.md`](./docs/basic-operations.md#migrating-an-existing-project)**.

## Repository layout

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # one-entry marketplace (plugins[0].source: "./")
│   └── plugin.json               # plugin manifest with userConfig
├── agents/                       # 36 role-based agents (INDEX.md is navigation)
├── commands/                     # slash commands (review, setup, codex-*, smart-commit, opsx-apply-resume, ...)
├── skills/                       # SSOT: 85 flat canonical packages rooted at skills/<public-name>/ (six portable family names are unprefixed)
├── templates/                    # hook-bootstrap templates (graduation-candidates.md — copied to .claude/artifacts/ on first graduation run)
├── rules/                        # plain-markdown governance rules (execution-policy, tool-routing, anti-rationalization) — not in plugin.json; opt-in via ${CLAUDE_PLUGIN_ROOT}/rules/*.md from a consuming project's CLAUDE.md
├── modules/                      # 31 opt-in modules; skills/ entries are relative symlink projections
│   ├── php-5.6/, php-7.4/, php-8.x/        # {module.yaml, skills/, references/, hooks/ (php-7.4 only)}
│   ├── yii-1.1/                            # Yii 1.1 framework
│   ├── phpunit-5.7/, phpunit-9/, phpunit-10/, phpunit-11/
│   ├── laravel-5.4/, laravel-6/ … laravel-11/  # one per major (5.4 requires php-5.6)
│   ├── js/{module.yaml, hooks/, skills/, commands/, references/}
│   ├── vue-2/, laravel-mix/                # frontend: Vue 2 SFC + Laravel Mix 5 asset pipeline
│   ├── nextjs-15.5/, nextjs-16/         # Next.js React framework
│   ├── react-18/, react-19/             # React library (per-major)
│   ├── library-author/{module.yaml, agents/, skills/, hooks/, references/}
│   └── swift/, swiftui/, ios-platform/, swift-testing/, xcode-tooling/  # iOS/Swift suite (xcode-tooling adds hooks/ + skill scripts)
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / SubagentStop wiring
├── scripts/
│   ├── hooks/                    # core hooks incl. post-edit-dispatch.sh, pre-bash-dispatch.sh, reap-stale-sentinels.sh, _lib/{payload,portable-sed,portable-timeout}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/, lib/, opsx-apply-resume/, validate/
│   └── (harness-audit, precommit-runner, verify-runner, agy-adapt-agents, dep-audit)
├── docs/
│   ├── configuration.md, configuration.zh-TW.md      # full userConfig reference
│   ├── basic-operations.md, basic-operations.zh-TW.md # install + workflow lifecycle
│   ├── distribution-surfaces.md, distribution-surfaces.zh-TW.md
│   ├── skill-platform-migration.md, skill-platform-migration.zh-TW.md
│   ├── hook-extension.md, hook-extension.zh-TW.md
│   ├── recommended-permissions.md
│   ├── docker-setup.md, docker-setup.zh-TW.md, subagent-prompt-template.md
├── cursor/                       # Cursor project-local dual-track (Cursor does NOT auto-load this tree)
│   ├── AGENTS.md                 # Cursor dual-route guidance
│   ├── skills/                   # relative symlinks to canonical skills/
│   ├── agents/, rules/*.mdc, commands/
├── codex/                        # Codex CLI dual-track (Claude Code does NOT auto-load)
│   ├── AGENTS.md                 # Codex-specific guidance
│   ├── README.md, README.zh-TW.md # how to sync into a project
│   ├── skills/                   # 18 relative symlinks (16 invokable + internal transport + dispatch-context runtimes)
│   ├── agents/, config.toml.example
├── .codex-plugin/plugin.json     # Codex plugin manifest (marketplace-installable, experimental)
├── plugins/dhpk/                 # tracked Codex-native package: 18 physical entries, zero symlinks
│   ├── .codex-plugin/plugin.json
│   ├── README.md
├── .agents/plugins/marketplace.json  # repo-scoped Codex marketplace descriptor
├── manifests/
│   ├── distribution-inventory.json  # lifecycle/name/surface SSOT (schema v2)
│   ├── install-profiles.json         # curated module bundles
│   └── module-catalog.json           # module configuration SSOT
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

The marketplace install path (`claude plugin install`) copies the plugin into `~/.claude/plugins/cache/`, so edits to the source repo do NOT take effect there until `claude plugin update dhpk@dhpk`.

## License

Released under the [MIT License](./LICENSE). Copyright (c) 2026 Paul.

See [CHANGELOG.md](./CHANGELOG.md) for release history.
