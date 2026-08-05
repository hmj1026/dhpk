# Basic Operations

> **Languages**: **English** · [繁體中文](./basic-operations.zh-TW.md)

This page walks through the operational lifecycle of dhpk: installing it, the day-to-day command flow, the automatic review cycle, and how to migrate an existing project onto it. For the full `userConfig` knob reference, see [`docs/configuration.md`](./configuration.md).

## Distribution surface policy

dhpk deliberately exposes several surfaces with different support tiers:

| Surface | Tier | Meaning |
|---|---|---|
| Claude marketplace | Supported | Primary consumer install and update path. |
| `claude --plugin-dir` | Development-only | Working-tree iteration; not a release channel. |
| `scripts/install.sh` | Convenience wrapper | Runs the Claude install contract; it is not a separate distribution. |
| `install-codex-skills.sh` | Supported | Stable Codex project sync path. |
| Codex plugin marketplace | Experimental | Physical publication package with a verified real-CLI install proof; tier stays Experimental until a separate graduation decision. |
| Gemini / Antigravity sync | Adapter-only | Claude-first comparison or conversion; no native package or full agent-parity promise. |

Plugin management commands (`claude plugin …`, `codex plugin …`) are separate
from skill invocation. Claude workflows enter through `/dhpk:do` or an
explicit skill; Codex consumes the project-local `.codex/` projection.

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

Add `--config` flags to pre-seed config (skip if you'd rather answer interactively via `/dhpk:setup` after install) — see [`docs/configuration.md`](./configuration.md) for the full knob reference:

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-8.x,laravel-11,phpunit-11,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

Pin a specific release by appending a version: `claude plugin install dhpk@dhpk@v0.6.0`. Available stacks/versions live in `manifests/module-catalog.json` (SSOT); curated bundles in `manifests/install-profiles.json`. Docker prerequisites: see [`docs/docker-setup.md`](./docker-setup.md).

After install, reconfigure any time from inside Claude Code:

```text
/dhpk:setup           # rerun the same questions
/dhpk:setup --show    # print current effective config
```

### Path B — Local clone + interactive installer

Use this for an out-of-Claude shell wizard or when hacking on the plugin source.
It is a convenience/development path, not a second release channel. **You must
`git clone` first** — the installer lives inside the repo.

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
claude plugin update dhpk@dhpk         # pull the latest version from the marketplace
claude plugin uninstall dhpk@dhpk      # remove the plugin
claude plugin marketplace remove dhpk  # forget the marketplace entry
```

The same actions are available as `/plugin update dhpk@dhpk`, `/plugin uninstall dhpk@dhpk`, `/plugin marketplace remove dhpk` inside Claude Code.

For a project that uses the supported Codex projection, update Claude first and
then refresh the project-local files:

```bash
claude plugin update dhpk@dhpk
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
```

### Install troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `marketplace add` says the path doesn't exist | You followed Path B but skipped the `git clone` step | Run `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk` first — or switch to Path A which needs no clone |
| `claude plugin install dhpk@dhpk` says marketplace not found | `marketplace add` didn't run, or you removed it earlier | Re-run the `marketplace add` line from your chosen path |
| `/dhpk:*` commands or hooks don't appear after install | Session loaded its skill list before install finished | Run `/reload-plugins` inside Claude Code, or restart the session |
| `claude plugin list` shows dhpk but `/dhpk:setup` is missing | Plugin is installed but disabled | `claude plugin enable dhpk@dhpk` (or `/plugin enable dhpk@dhpk`) |
| `install.sh` errors on `gum` / `jq` not found | Optional UI deps missing | The script falls back to plain shell / `python3`; install `gum` and `jq` for the nicer flow, or ignore the warning |
| Some skill descriptions truncated/dropped (seen in `/doctor`) | Many modules shipped → skill-listing budget overflow (module skills list regardless of `modules`, [#12](https://github.com/hmj1026/dhpk/issues/12)) | Raise `skillListingBudgetFraction` in `settings.json` (default ~1% → `0.02`–`0.03`), or install fewer modules / disable the whole plugin with `/plugin` where unused |
| Version advisory asks you to update `.claude/dhpk-versions.json`, but it is a symlink | The Write tool refuses symlink targets | Run `realpath .claude/dhpk-versions.json` and write the verified entry to that real path; `scripts/version-diff.sh` prints the same safe instruction |

## Common workflows

Everything is reachable through `/dhpk:do` — one entry point that routes natural-language task descriptions to the right skill. The examples below show what actually happens after you type a command, grouped into the main delivery flow, situational on-ramps, and standalone tools; each keeps its exact invocation syntax.

### Main flow — feature and bug delivery

### 1. Feature development

```text
/dhpk:do implement a password-reset email flow
```

The Smart Router matches "implement … feature" → `dhpk:dhpk-adaptive-dev-workflow` → **Feature Delivery** path. The skill loads TDD guide, runs the RED→GREEN→REFACTOR cycle, and closes with code-review and security gates. Post-edit hooks automatically drop sentinels after each file write; the Stop hook reminds you of any still-open reviewers.

### 2. Bug fix

```text
/dhpk:do fix the login redirect loop
```

Matches "fix … bug" → `dhpk:dhpk-adaptive-dev-workflow` → **Bug Investigation & Fix**: root-cause evidence, regression test, RED gate before writing the fix.

**`--openspec` / `--opsx` flag:** pass `--openspec` (alias `--opsx`) to `/dhpk:do` to force the OpenSpec authoring flow (`opsx:new` → `opsx:ff`, then stop for human review) instead of routing straight to implementation. It applies to the 3 change-authoring routes — `dhpk:dhpk-adaptive-dev-workflow`, `dhpk:dhpk-bug-fix`, `dhpk:dhpk-feature-dev` — and supersedes `--plan`. On every other route, including `dhpk:dhpk-opsx-apply-goal`, the flag is a no-op: it prints `--openspec ignored: ...` and the route proceeds normally.

**`--worker=<claude|codex|agy|auto>` flag:** choose the mechanical worker for this invocation without changing project configuration. `/dhpk:do` parses and strips the flag before route matching, then forwards its exact value as `WORKER_OVERRIDE` only to implementation-class routes (`adaptive-dev-workflow`, `bug-fix`, `feature-dev`, and `opsx-apply-goal`). Precedence is flag > `fast_worker_backend` userConfig > shipped `claude`; an invalid flag warns once and falls through to userConfig/default. Downstream workflows call the shared selector rather than reimplementing availability, order, or fallback logic.

### Situational on-ramps

### 3. Review on-ramp (automatic, with a manual trigger)

No command needed. After any file edit the hooks automatically:

1. Drop a `.pending-*` sentinel for each relevant reviewer slot (code / db / sec / frontend / doc)
2. Remind dispatched reviewers to run in parallel at Stop
3. Warn before `git commit` while sentinels are open (configurable via `sentinel_commit_gate`: `warn` / `block` / `off` — see [`docs/configuration.md`](./configuration.md))

The immediate post-edit advisory is edge-triggered: it prints only when the pending-sentinel set changes. `.advisory-state` tracks that set, so repeated edits do not spam the same message, while an externally cleared reviewer set can be re-armed and advised on a later edit. Edits with no matching trigger are silent unless `DHPK_DEBUG=1`.

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

For an actual version release (not just a commit/PR) — version files, changelog, and the fixed git/PR/tag/CI sequence — see `/dhpk:dhpk-release-creator <version>` (explicit-only; run it directly, it is never auto-invoked).

### 5. Setup on-ramp

Re-run or inspect configuration any time, without reinstalling — see [§ Install](#install): `/dhpk:setup` / `/dhpk:setup --show`.

### 6. Unattended OpenSpec session (large-uncertainty on-ramp)

For a long-running change that should run without supervision — generates a single `/goal` command (with the `/opsx:apply` kickoff embedded), ready to paste into a fresh session:

```text
/dhpk:dhpk-opsx-apply-goal my-change-id --max-duration 2h
```

**Flags:**

| Flag | Meaning |
|---|---|
| `<change-id>` | Required. The OpenSpec change directory name under `openspec/changes/` — not free text; this is the one route where `/dhpk:do`'s task description becomes an id + flags, not a task description (see item 1's routing notes). |
| `--turns N` | Overrides the auto-calculated turn budget (default: `max(20, min(120, open_tasks × 4 + 20))`). At the budget the session writes `.resume-note.md` and stops — a hard checkpoint, not advisory. |
| `--max-duration <Nm\|Nh>` | Adds a wall-clock stop condition (e.g. `30m`, `2h`). Omit for no time limit — only the turn budget bounds the session. |
| `--min-coverage N` | Forces a coverage gate at `N`% even when the project has no native coverage config. Requires a detected test runner; ignored (with a note) otherwise. |
| `--codex` | Opts this session into the `CODEX=on` cross-model doubt-cycle / high-stakes-peer-review clause inside the pasted `/goal` string. Independent of `/dhpk:do`'s own `--codex` — passing `--codex` to `/dhpk:do` does **not** forward into this flag; pass it directly if you want it. |
| `--smoke` / `--no-smoke` | Force the read-only live-runtime smoke gate on or off. Without either, it auto-detects: on only for a strong signal (explicit runtime-verification task, dispatched `e2e-runner`, or a derivable launch command), off otherwise. |
| `--dry-run` | Prints the analysis + goal string without the "ready to paste" session-setup framing — use it to preview before committing to an unattended run. |

**What the pasted `/goal` string actually contains:** an orientation-first kickoff that locates `rules/execution-policy.md`, then invokes `opsx:apply` (with the bounded unknown-skill fallback). Part 0 carries the selector-resolved fast-worker clause and a UTF-8-safe task digest capped at 200 bytes; the `e2e-runner` roster clause appears only when the change actually has an E2E signal. Review is one consolidated parallel reviewer batch per contiguous implementation wave, with at most one confirm-only pass for known findings. Completion still requires every task checkbox, applicable test/build/lint/coverage/smoke gates, and no pending sentinels. Turn/time checkpoints write `.resume-note.md`; human-only remaining work is annotated `[blocked: <reason>]`; a hard-rule conflict writes `.hard-rule-escalation.md` with file:line evidence and stops instead of guessing. Full structure: `skills/dhpk-opsx-apply-goal/SKILL.md` Steps 3-4 and Output (Parts 0-4).

When `orchestration_dispatch=on` (default), the generated `/goal` condition embeds the compact selector-resolved mechanical-worker clause plus the specialist clauses that apply to the detected work; the E2E clause is omitted when no browser surface is detected. Set `orchestration_dispatch=off` to remove the dispatch directive entirely — implementation stays inline instead of being routed through worker agents.

**4,000 UTF-8-byte hard stop:** Claude Code's `/goal` input has a practical paste ceiling around 4,000 UTF-8 bytes, measured with `wc -c`. The normal target is 3,400 bytes, leaving a 600-byte reserve for variable gate tokens. If the composed goal string would exceed 4,000 bytes, that's treated as a should-never-fire template regression, not a routine condition: no `/goal` command is emitted at all — instead you get the measured byte count and which setting or flag to adjust (turn off the `orchestration_dispatch` project setting, or drop `--codex` / `--smoke`) before re-running. Required safety and verification gates are never removed to fit.

### Standalone tools

### 7. Mine specs from existing code

Extracts behavioral requirements from an existing module into `openspec/specs/<capability>/spec.md` (brownfield onboarding):

```text
/dhpk:spec-mine user-authentication
```

Delegates to the `spec-miner` (Opus) agent. Omit the capability name to get a prompted list.

### 8. E2E test authoring

```text
/dhpk:do write E2E tests for the checkout flow
```

Routes to `dhpk:dhpk-post-dev-test`, which delegates Playwright suite authoring to the `e2e-runner` agent. Its write boundary is test specs, shared helpers, fixtures, and artifacts only. An application-code failure returns a fast-worker-ready fix spec; after that fix lands, `e2e-runner` reruns the originating journey. It reuses existing project helpers and cleans synthetic shared-DB rows in teardown.

### 9. Harness health check and repair

The harness-* family covers four distinct concerns — use the right tool for each:

| Command / Skill | Concern | Mutates? |
|---|---|---|
| `/harness-audit` | Deterministic 7-category scorecard | No |
| `dhpk:dhpk-harness-budget` | Context-window token accounting | No |
| `dhpk:dhpk-claude-health` | `.claude/` config health, naming, plugin sync | No |
| `/harness-govern` | End-to-end measure → conform → fix → verify loop | No (add `--fix` to apply) |
| `dhpk:dhpk-harness-revise` | Trim, dedupe, validate (G1–G13 gap taxonomy) | Yes |
| `dhpk:dhpk-harness-fill` | Backfill missing `.claude/` infrastructure | Yes |

**Typical flow:**

```text
# 1. Quick diagnostic — see what's wrong
/harness-audit

# 2. Check context-window overhead (token budget)
/dhpk:dhpk-harness-budget

# 3. End-to-end governance loop (read-only by default)
/harness-govern

# 4. Apply fixes (trim, dedupe, validate)
/harness-govern --fix

# 5. If .claude/ is missing skills/agents/rules (new project onboarding)
/dhpk:dhpk-harness-fill
```

`/harness-govern` is the single front door: it sequences `/harness-audit` (score) → conform (best-practices lens) → `/harness-revise` (fix, only with `--fix`) → verify. Safe to run as `/loop /harness-govern` for ongoing monitoring.

### Automatic (no direct invocation)

### Implementation dispatch

During the implement phase of `feature-dev`, `bug-fix`, `adaptive-dev-workflow`, and `opsx-apply-goal`, reasoning-heavy work goes to `deep-reasoner`; mechanical work goes through the shared selector to `fast-worker`, `codex-fast-worker`, or `agy-fast-worker`. `auto` follows `fast_worker_backend_order`; fallback to Claude is allowed only for a missing selected CLI executable, never for auth, model, execution, task, or verification failures. `--worker=codex` is independent of `CODEX=on`: the former selects a Codex CLI mechanical worker, while the latter enables the Codex MCP peer path. Small diffs totaling ≤2 files across the whole implementation step may stay inline; `general-purpose` is prohibited while dispatch is on. Full table: [`rules/execution-policy.md`](../rules/execution-policy.md) §"Implementation dispatch".

The TDD specialist owns RED and scoped test-first work. It implements GREEN only when the whole production footprint is ≤2 files; larger changes stop after RED and return a fast-worker-ready fix spec. Iteration uses one filtered test or affected suite, with the full applicable suite once at phase exit; a minimal GREEN diff may report `REFACTOR: skipped (minimal diff)`. Concurrent ownership of the same test or production files is a hard collision, not a race.

Model overrides: `deep_reasoner_model` (default `opus`), `fast_worker_model` (default `sonnet`) — see [`docs/configuration.md`](./configuration.md). Set `orchestration_dispatch=off` to fully restore pre-v0.22.0 behavior.

**`CODEX=on` high-stakes parallel peer path**: for a high-stakes implement-phase design/diagnosis decision, this same dispatch step can add Codex as a second, independent peer alongside `deep-reasoner` — see item 10 below for how to opt in and what "independent" means in practice.

### 10. Codex dual-assistant collaboration

dhpk runs **codex-free by default**. Opting in unlocks two related but distinct things:

**A. The Codex peer in Implementation dispatch.** With `CODEX=on`, a high-stakes implement-phase decision (root-cause diagnosis, architecture choice) is no longer `deep-reasoner`-only: dhpk dispatches `deep-reasoner` and Codex (via `mcp__codex__codex`) **in parallel, each blind to the other's findings** — neither side's prompt is seeded with the other's conclusion, verdict, or theory — then compares the two independent results and flags any divergence in the report. This blind-independence rule also governs the `codex-architect`, `codex-brainstorm`, `codex-implement`, and `codex-code-review` skills, plus `multi-ai-sync`, `feature-verify`, `test-review`, `code-investigate`, and `issue-analyze`. Full rule: [`rules/execution-policy.md`](../rules/execution-policy.md) §"Multi-AI / dual-perspective independence".

**B. Six direct Codex-delegation skills** — `codex-architect`, `codex-brainstorm`, `codex-cli-review`, `codex-code-review`, `codex-explain`, `codex-implement` — invocable directly (e.g. `/codex-code-review`) whenever you want Codex's take without going through `/dhpk:do`.

Five of these six (all but `codex-cli-review`, which shells out to the `codex` CLI binary via `Bash` and needs no MCP server) require the `mcp__codex__codex` / `mcp__codex__codex-reply` tools, which come from directly registering the Codex CLI's own `codex mcp-server` subcommand as an MCP server — **not** from installing the `openai/codex-plugin-cc` plugin, which is a separate, optional surface. Setup steps and the `CODEX=on` opt-in mechanics (the `--codex` flag / natural-language trigger on `/dhpk:do`) live in [`docs/configuration.md`](./configuration.md#codex-mcp-dependency-not-a-userconfig-knob).

This is unrelated to **syncing Codex CLI content** (below) — that mirrors dhpk's own skills into a project's `.codex/` directory for the standalone `codex` CLI tool, no MCP server involved.

## Sync Codex CLI content

Projects using both Claude Code and Codex CLI:

```bash
# From any project root:
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

The script is the supported Codex distribution path, with two modes:

- **`--copy` (portable supported fallback).** Materializes real files under
  `.codex/`. Recommended whenever the project may move, be archived, or be
  checked out somewhere the plugin source tree isn't guaranteed to sit
  alongside it — copied content has no dependency on the plugin checkout
  surviving.
- **Symlink (default, source-checkout dependent).** Links `.codex/` entries
  back to the plugin's own `codex/skills/` tree. Faster to re-sync and always
  current with the source checkout, but the links break if that plugin
  checkout is moved, deleted, or absent (e.g. a marketplace-cache install) —
  this is the exact failure mode behind
  [issue #88](https://github.com/hmj1026/dhpk/issues/88). Use `--copy`
  instead whenever the plugin source's continued presence isn't guaranteed.

Both modes record version, source-fingerprint, and schema-versioned managed
entry provenance in `.codex/.dhpk-installed.json`; re-run with `--update` after
a plugin update. Unowned collisions are preserved, and `--migrate` adopts only
exact legacy matches. Use `--uninstall` to remove unchanged receipt-owned
entries without deleting unrelated project assets.
The Codex tree is an explicitly curated subset of the canonical Claude
packages, not a second complete inventory. `codex/agents/` ships 11 roles:
four hand-maintained generic roles and seven generated from canonical Claude
agents via `scripts/gen-codex-agents.js`. See `codex/AGENTS.md` and
`codex/README.md` for the dual-harness model.

Generated roles may depend on shared prompt-defense, trap-sheet, reviewer-contract,
artifact-contract, or execution-policy content. Those support files are mapped in
the `supporting_assets` section of `manifests/distribution-inventory.json`, copied
under `.codex/dhpk/`, and tracked in the same schema-v2 receipt. The runtime
projection validator rejects unreachable references or Claude plugin-root paths.

### Codex Plugin Marketplace (experimental support tier)

The repository ships a Codex plugin manifest and marketplace wrapper backed
by a tracked, physical publication package at `plugins/dhpk/` — generated
from `manifests/distribution-inventory.json`'s explicit `codex-native`
surface, containing zero symlinks:

```bash
codex plugin marketplace add hmj1026/dhpk   # or a local path during development
codex plugin add dhpk@dhpk
codex plugin list
```

`codex plugin list` is management evidence only; it does not by itself prove
the installed cache contains working files. That proof is a real,
CLI-driven test: `tests/codex-native-install-smoke.test.js` installs the
exact tracked `plugins/dhpk/` artifact into a sandboxed `CODEX_HOME`,
deletes the source checkout, and verifies every allowlisted native skill
materialized as a real (non-symlink) file — the exact failure mode
[issue #88](https://github.com/hmj1026/dhpk/issues/88) tracked is closed at
the manifest level (both `.codex-plugin/plugin.json` and
`plugins/dhpk/.codex-plugin/plugin.json` now resolve to the same tracked
physical tree). This proof runs as part of the release CONSUMER gate
whenever a `codex` CLI is available; see
[`docs/distribution-surfaces.md`](./distribution-surfaces.md#codex-native-plugin-package-github-issue-88)
for the full gate model.

A passing install proof is necessary evidence, not sufficient by itself:
native Codex marketplace support remains **experimental** until a later,
separately approved graduation decision (see
[ADR-0006](./adr/0006-codex-native-publication-artifact.md)). For production
work, use `install-codex-skills.sh` — the marketplace package is additive,
not a replacement for the supported project-local sync path.

See `.codex-plugin/README.md` and `plugins/dhpk/README.md` for details.

## Migrating an existing project

If the project already has its own `.claude/` harness, follow the phased plan:

1. **Phase A — baseline**: snapshot pre-install hook outputs and test results.
2. **Phase B — install (parallel)**: install the plugin with `userConfig.review_agents` pointing at the project's existing agents. Both sets of hooks fire side-by-side.
3. **Phase C — discovery**: confirm `/agents` and `/plugin details dhpk@dhpk` show expected components.
4. **Phase D — hook parity**: diff plugin-side sentinels vs project-side. Document any expected differences.
5. **Phase E — cutover**: disable the project's in-tree hooks via `.claude/settings.local.json` (`"hooks": {}`); run regression tests.
6. **Phase F — cleanup**: delete project files now provided by the plugin; keep project-specific overrides.

Each phase has a rollback gate. Tag `pre-dhpk-migration` before deleting anything.

## Development

For iterating on the plugin source itself (no install/reinstall loop), launch Claude Code against the working tree directly:

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude --plugin-dir ~/projects/dhpk
```

Edits to plugin files take effect after `/reload-plugins` (hooks, MCP, LSP) or session restart (monitors, skill listings).

The marketplace install path (`claude plugin install`) copies the plugin into `~/.claude/plugins/cache/`, so edits to the source repo do NOT take effect there until `claude plugin update dhpk@dhpk`.
