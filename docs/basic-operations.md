# Basic Operations

> **Languages**: **English** · [繁體中文](./basic-operations.zh-TW.md)

This page walks through the operational lifecycle of dhpk: installing it, the day-to-day command flow, the automatic review cycle, and how to migrate an existing project onto it. For exact Codex/Cursor installation, status, and rollback instructions, use the [platform installation SSOT](./platform-installation.md). For the full `userConfig` knob reference, see [`docs/configuration.md`](./configuration.md).

## Decision ladder

Use this order for a fresh request: **inspect** the repository and session
state → **verify** the installed surface → **choose** Claude, supported Codex
sync, or the experimental native Codex surface → **route** through Claude
`/dhpk:do`, the Cursor generated command, or Codex `$dhpk-do` (Codex has no
`/dhpk:do` command) or an explicit skill → **implement** with TDD and pre-edit
impact checks →
**review/verify** the resulting evidence → **handoff** with exactly one next
command. Plugin management (`claude plugin …`, `codex plugin …`) does not invoke
a skill.

The behavior owners are [`rules/execution-policy.md`](../rules/execution-policy.md),
[`docs/configuration.md`](./configuration.md),
[`docs/skill-platform-migration.md`](./skill-platform-migration.md),
[`docs/distribution-surfaces.md`](./distribution-surfaces.md), the
[`distribution-inventory.json`](../manifests/distribution-inventory.json)
manifest, [`scripts/install.sh`](../scripts/install.sh), the supported
[`install-codex-skills.sh`](../scripts/hooks/install-codex-skills.sh), and the
supported [`install-cursor-harness.sh`](../scripts/hooks/install-cursor-harness.sh). OpenSpec
change proposals, specifications, and task evidence live under
`openspec/changes/`; a passing validator is not version-control delivery.

When a destination is unclear and the work will span sessions, first record a
wayfinder checkpoint with destination candidates, current frontier, and one
next decision. A clear single-session request goes directly to its route.

## Distribution surface policy

dhpk deliberately exposes several surfaces with different support tiers:

| Surface | Tier | Meaning |
|---|---|---|
| Claude marketplace | Supported | Primary consumer install and update path. |
| `claude --plugin-dir` | Development-only | Working-tree iteration; not a release channel. |
| `scripts/install.sh` | Convenience wrapper | Runs the Claude install contract; it is not a separate distribution. |
| `install-codex-skills.sh` | Supported | Stable Codex project sync path. |
| `install-cursor-harness.sh` | Supported | Stable Cursor project-local sync path (`.cursor/`). |
| Codex plugin marketplace | Experimental | Physical publication package with a verified real-CLI install proof; tier stays Experimental until a separate graduation decision. |
| Antigravity / AGY sync | Adapter/package | Antigravity uses `.agent` mappings; AGY uses its native plugin package and validator. |

Plugin management commands (`claude plugin …`, `codex plugin …`) are separate
from skill invocation. Claude workflows enter through `/dhpk:do` or an
explicit skill; Cursor uses the generated command after
`install-cursor-harness.sh`; Codex enters through `$dhpk-do` after project-local
`.codex/` sync (Codex has no `/dhpk:do` command).

## Install

dhpk follows the standard [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins): the same marketplace + manifest is reachable from **two surfaces**, pick whichever fits your workflow:

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Inside a Claude Code session** — `/plugin marketplace add …` / `/plugin install …` (or the interactive `/plugin` browser)

Both surfaces read the same `.claude-plugin/marketplace.json` shipped in this repo, so the result is identical.

### Path A — From GitHub (recommended)

No clone needed. Fastest path for end users.

The direct GitHub marketplace entry is the raw `dhpk@dhpk` compatibility
surface. The measured, pre-discovery `minimal` artifact is produced by the
interactive installer in Path B (or by the profile generator command below)
until a release publishes that generated package as its marketplace source.

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

With no stack modules selected, the script materializes the inventory-owned
`minimal` profile, registers a local marketplace wrapper, and installs
`dhpk@dhpk-profile-minimal`; selecting stack modules keeps the explicit raw
compatibility route. The script walks stack/version selection, docker
prerequisites, review-agent overrides, and hook profile, then runs
`claude plugin install` for you. Append `--dry-run` to print the resolved
commands without executing them.

Validate the local checkout at any time:

```bash
claude plugin validate ~/projects/dhpk --strict
```

Repository checks such as `node scripts/ci/validate-plugin.js` and
`node scripts/ci/validate-skills.js --strict` are fast source gates, not proof of the official
consumer. When the Claude CLI is available, retain
`claude plugin validate <manifest> --strict` and its exit code as official
evidence; when it is unavailable, record `NOT RUN` and do not claim an official
PASS. The release consumer gate treats a non-zero official result as blocking
and validates the consumer-shaped staged package (development-only root
`CLAUDE.md` is not part of the shipped plugin surface).

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

`CLAUDE_PLUGIN_ROOT` is exported inside the Claude Code plugin runtime (hooks,
commands, and Bash tools launched from that session); an ordinary terminal does
not receive it automatically. From a normal shell, point at a persistent local
checkout instead, for example `DHPK_ROOT=/absolute/path/to/dhpk` and run
`bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" ...`. Do not hard-code
an ephemeral marketplace cache path.

```bash
claude plugin update dhpk@dhpk
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --update
```

If the project has a pre-consolidation Codex receipt or unprefixed dhpk skill
directories, migrate ownership explicitly before the normal update:

```bash
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --migrate --update
```

`--migrate` adopts only unchanged destinations whose legacy source matches
exactly. User-owned, edited, retargeted, malformed, and ambiguous entries are
preserved and reported. `--force` only bypasses the project-root heuristic; it
never overrides ownership, collision, symlink, containment, or modified-file
safety. Use `--uninstall` to remove only unchanged receipt-owned entries. See
the complete rename/merge and rollback guide in
[`skill-platform-migration.md`](./skill-platform-migration.md).

To remove both surfaces, reverse the installation order: first run the Codex
projection script with `--uninstall` in every project while the plugin root is
still available, then run `claude plugin uninstall dhpk@dhpk`, and finally
remove the marketplace entry if desired. This avoids broken project symlinks
and is also the safe order for copy mode.

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

The user-facing workflow has one safe front door and several explicit exits:

```text
inspect → verify surface → route → plan/classify → implement → review → verify → handoff
```

Use Claude `/dhpk:do`, the Cursor generated command, or Codex `$dhpk-do` when
you know the outcome but not the right skill. Codex has no `/dhpk:do` command.
Use a direct command or skill when you already know the exact workflow. Plugin management
(`claude plugin …`, `codex plugin …`) installs or updates a surface; it does not
invoke a workflow.

### Choose an entry

| Need | Entry | Completion signal |
|---|---|---|
| See what would run | `/dhpk:do --route-only <task>` | `Route only: /...` (or a bounded classification / task prompt); no downstream work runs. |
| Feature, bug, refactor, or other substantial change | `/dhpk:do <task>` | One workflow classification and one named next route. |
| Inspect code or execution flow | `/dhpk:do trace the <area> flow` or `dhpk-codebase-exploration` | Evidence-backed explanation with file/symbol references. |
| Review existing edits | `/dhpk:review-pending` or `/dhpk:dhpk-change-review` | Reviewer verdict plus fresh artifact or an explicit blocker. |
| Commit, PR, or release | `/dhpk:smart-commit`, `/dhpk:create-pr`, or `/dhpk:dhpk-release-creator` | Explicit command result; no automatic commit, push, or merge. |

`/dhpk:do` may invoke an `implicit-eligible` target. If routing selects an
`explicit-only` target, it prints the exact direct invocation and stops; routing
confidence never bypasses the target's invocation class. The route table is the
deterministic fast path, while ambiguous compound requests use bounded
classification rather than a guessed match.

### Inspect routing before execution

```text
/dhpk:do --route-only implement a password-reset email flow
/dhpk:do --route-only fix the login redirect loop
```

`--route-only` strips itself and any supported mode flags before matching. The
user-facing command prints `Route only: /<skill> (<label>).` for a deterministic
match, or `Route only: /<chosen> because <reason>.` after bounded classification;
empty input asks for a task description. The underlying route helper exposes
the machine-readable `MATCH<TAB>skill<TAB>label`, `NO_MATCH`, and `NO_QUERY`
tokens used by validators. In either form it never invokes OpenSpec, planner,
architect, worker, or the selected skill.

### Main delivery flow — feature and bug work

```text
/dhpk:do implement a password-reset email flow
/dhpk:do fix the login redirect loop
```

The adaptive workflow classifies the request before loading branch-specific
context. Feature work enters TDD RED → GREEN → REFACTOR; bug work records root
cause evidence and a regression-test RED gate before the fix. Existing symbols
receive pre-edit impact analysis when the repository provides GitNexus; `cx`
overview/definition/references remain the primary navigation fallback.

Use these invocation-only modifiers when they change the decision for this run:

| Modifier | Effect and boundary |
|---|---|
| `--plan[=<model>[:<effort>]]` | Adds a planner critique only to implementation-class routes. `--openspec` supersedes it on authoring routes. |
| `--openspec` / `--opsx` | Sends feature/bug authoring routes to external OpenSpec artifact creation, then stops at human review. It is ignored on non-authoring routes. |
| `--worker=<claude\|codex\|agy\|auto>` | Selects the mechanical worker for this invocation; precedence is flag → `fast_worker_backend` → shipped `claude`. It does not persist configuration. |
| `--reasoner=<claude\|codex>[:<model>[:<effort>]]` | Selects the reasoning backend for implementation-class routes; ignored elsewhere with an explicit message. |
| `--codex` | Enables the session's Codex peer path where the selected workflow supports it. It is distinct from the worker selector. |

`--worker=codex` chooses a Codex CLI mechanical worker. `CODEX=on` adds an
independent Codex MCP peer for high-stakes reasoning/review. Only a missing
selected executable may use the configured Claude fallback; authentication,
task, execution, and verification failures remain blocked.

### OpenSpec lifecycle boundary

For unclear or multi-session work, record a wayfinder checkpoint, then use
`/opsx:new` or `/opsx:ff` to author `openspec/changes/<change-id>/` artifacts.
After the Planning Review Gate, apply with `$dhpk:openspec-apply-change <change>`
or the repository's external OpenSpec apply entry. A plan, passing validator, or
all-green test run is not archival evidence. Completion requires task checkboxes,
applicable verification gates, review obligations, and human-only actions to be
resolved; archive, issue closure, and release publication remain separate steps.

Before implementation, record `Decision: CLEAR`, `REASONER_REQUIRED`,
`HUMAN_REQUIRED`, or `BLOCKED`. A domain-boundary ownership question consults
`architect` first; if uncertainty remains, record `REASONER_REQUIRED` and obtain
a read-only reasoner result before any writer. Two or more unchecked OpenSpec
tasks require a planner before the first write wave. Its result states dependency
order, each task's exact owner and write scope, and the next checkpoint. For one
clear task, record `planner=skipped`. The external `/opsx:apply` workflow is
unchanged.

Each implementation wave ends with one consolidated review and a bounded fix
loop: `BLOCK`, `CRITICAL`, and `HIGH` findings require a dedicated confirm-only
reviewer; LOW/WARNING-only findings may close with worker verification plus a
diff-scope recheck. Delivery order is: verify all tasks and gates → archive/sync
OpenSpec → add a valid changelog fragment → open a Draft PR targeting `develop`
→ monitor that PR's actual CI with `gh run watch` to a completed conclusion → human
merge gate.
Queued or partial CI is not completion.

### Review, verify, and handoff

After an Edit/Write/MultiEdit, the default hooks create only the applicable
`.pending-*` review sentinels and keep review debt visible. They do not silently
run formatting, lint, lockfile, or Stop advisory scripts. `/dhpk:review-pending`
starts the pending reviewers immediately; `sentinel_commit_gate` controls whether
open sentinels warn or block a commit.

```text
/dhpk:review-pending
/dhpk:precommit
/dhpk:verify
/dhpk:smart-commit
/dhpk:create-pr
```

Every handoff reports exactly one next command, the files/evidence it covers,
and any `BLOCKED`, `NOT_RUN`, `UNAVAILABLE`, or `NO_SHIP` condition. A release
or consumer result must keep structural/package evidence separate from live
runtime proof; see [`docs/harness-workflow.md`](./harness-workflow.md).

<a id="6-unattended-openspec-session-large-uncertainty-on-ramp"></a>

### Explicit long-running OpenSpec session

Use this only when an existing change should generate a bounded paste-ready
`/goal` session:

```text
/dhpk:dhpk-opsx-apply-goal my-change-id --max-duration 2h
```

`<change-id>` is the directory name under `openspec/changes/`, not free text.
`--turns N`, `--max-duration`, `--min-coverage`, `--codex`, `--smoke`,
`--no-smoke`, and `--dry-run` constrain the generated session. Turn/time limits
write `.resume-note.md`; human-only work is `[blocked: <reason>]`; hard-rule
conflicts write `.hard-rule-escalation.md` with file:line evidence. The generated
goal keeps the selector-resolved worker, applicable specialist reviewers, and
completion gates; it never removes required gates to fit the roughly 4,000
UTF-8-byte paste ceiling.

### Standalone assistance workflows

```text
/dhpk:spec-mine user-authentication
/dhpk:do write E2E tests for the checkout flow
/dhpk:harness-audit
/dhpk:harness-govern
/dhpk:harness-govern --fix
```

`spec-mine` writes brownfield behavioral specs to `openspec/specs/`. E2E work is
owned by `e2e-runner` and may write only specs, helpers, fixtures, and artifacts;
application failures return a worker-ready fix spec. Harness audit is read-only;
govern is read-only unless `--fix` is supplied. Structural changes also route
`doc-updater` to refresh codemaps and user-facing docs.

### Implementation dispatch

With `orchestration_dispatch=on` (default), reasoning-heavy work goes to
`deep-reasoner` and mechanical work goes through the shared selector to
`fast-worker`, `codex-fast-worker`, or `agy-fast-worker`. A whole implementation
step touching at most two files may remain inline; larger clear-spec batches use
one assigned worker scope. TDD owns RED and scoped verification; the full
applicable suite runs at phase exit. The complete dispatch and reviewer batching
rules live in [`rules/execution-policy.md`](../rules/execution-policy.md).

### Codex dual-assistant collaboration

dhpk is **codex-free by default**. `CODEX=on` adds a blind independent Codex peer
to high-stakes implementation decisions and supported review skills. Direct
Codex-delegation skills (`dhpk-codex-architect` (including
`--mode adversarial`), `dhpk-codex-implement`, `dhpk-change-review`) can be
invoked without `/dhpk:do`.
The MCP backend needs `mcp__codex__codex` / `mcp__codex__codex-reply`; the optional
CLI backend needs only the `codex` executable. Setup and failure boundaries are
in [`docs/configuration.md`](./configuration.md#codex-mcp-dependency-not-a-userconfig-knob).

This is separate from syncing Codex CLI content below, which mirrors the curated
projection into `.codex/` and does not require an MCP server.

## Sync Codex CLI content

Projects using both Claude Code and Codex CLI:

The `${CLAUDE_PLUGIN_ROOT}` form below is for a Claude Code plugin-runtime
shell. In an ordinary terminal use the persistent-checkout form documented in
[Update / Uninstall](#update--uninstall).

```bash
# From any project root and a persistent local dhpk checkout:
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh"
```

Inside a Claude plugin-runtime shell, `${CLAUDE_PLUGIN_ROOT}` may be used as an
equivalent root. A normal terminal must set `DHPK_ROOT` explicitly; never copy
an ephemeral marketplace-cache path into a project command.

The script is the supported Codex distribution path, with a hybrid default
and a fully physical fallback:

- **`--copy` (portable supported fallback).** Materializes every managed entry
  under `.codex/`. Recommended whenever the project may move, be archived, or be
  checked out somewhere the plugin source tree isn't guaranteed to sit
  alongside it — copied content has no dependency on the plugin checkout
  surviving.
- **Hybrid (default, source-checkout dependent).** Links skills and supporting
  assets back to the plugin source, but always writes agent TOMLs as physical
  files. Linked entries are faster to re-sync and stay current with the source
  checkout, but those links break if that plugin
  root/cache is moved, pruned, or deleted. A marketplace cache is a
  valid source while it remains present; `--update` can adopt a new owned
  plugin root. Broken source lifetime was the failure mode behind
  [issue #88](https://github.com/hmj1026/dhpk/issues/88). Use `--copy`
  instead whenever the plugin source's continued presence isn't guaranteed.

Both modes record version, source-fingerprint, and per-entry mode in schema-v3
managed provenance at `.codex/.dhpk-installed.json`; skill entries include
their stable inventory id and current public `dhpk-*` name. Re-run with
`--update` after a
plugin update. Unowned collisions are preserved, and `--migrate` renames only
receipt-owned unchanged legacy destinations; edited, third-party, retargeted,
malformed, or ambiguous legacy paths remain reported conflicts. Use
`--uninstall` to remove unchanged receipt-owned entries without deleting
unrelated project assets.
The Codex tree is an explicitly curated subset of the canonical Claude
packages, not a second complete inventory. `codex/agents/` ships 16 direct
roles: four hand-maintained generic roles and 12 generated from canonical
Claude agents via `scripts/gen-codex-agents.js`. See `codex/AGENTS.md` and
`codex/README.md` for the dual-harness model.

Generated roles may depend on shared prompt-defense, trap-sheet, reviewer-contract,
artifact-contract, or execution-policy content. Those support files are mapped in
the `supporting_assets` section of `manifests/distribution-inventory.json`, copied
under `.codex/dhpk/`, and tracked in the same schema-v3 receipt. The runtime
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

Experimental lifecycle commands (the marketplace upgrade form applies to a
configured Git marketplace; for a local-path development marketplace, refresh
or re-add that local source before reinstalling the plugin):

```bash
codex plugin marketplace upgrade dhpk
codex plugin remove dhpk@dhpk
codex plugin add dhpk@dhpk        # reinstall from the refreshed snapshot

# Full teardown:
codex plugin remove dhpk@dhpk
codex plugin marketplace remove dhpk
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
