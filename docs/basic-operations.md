# Basic Operations

> **Languages**: **English** · [繁體中文](./basic-operations.zh-TW.md)

This page walks through the operational lifecycle of dhpk: installing it, the day-to-day command flow, the automatic review cycle, and how to migrate an existing project onto it. For the full `userConfig` knob reference, see [`docs/configuration.md`](./configuration.md).

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

### Install troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `marketplace add` says the path doesn't exist | You followed Path B but skipped the `git clone` step | Run `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk` first — or switch to Path A which needs no clone |
| `claude plugin install dhpk@dhpk` says marketplace not found | `marketplace add` didn't run, or you removed it earlier | Re-run the `marketplace add` line from your chosen path |
| `/dhpk:*` commands or hooks don't appear after install | Session loaded its skill list before install finished | Run `/reload-plugins` inside Claude Code, or restart the session |
| `claude plugin list` shows dhpk but `/dhpk:setup` is missing | Plugin is installed but disabled | `claude plugin enable dhpk` (or `/plugin enable dhpk`) |
| `install.sh` errors on `gum` / `jq` not found | Optional UI deps missing | The script falls back to plain shell / `python3`; install `gum` and `jq` for the nicer flow, or ignore the warning |
| Some skill descriptions truncated/dropped (seen in `/doctor`) | Many modules shipped → skill-listing budget overflow (module skills list regardless of `modules`, [#12](https://github.com/hmj1026/dhpk/issues/12)) | Raise `skillListingBudgetFraction` in `settings.json` (default ~1% → `0.02`–`0.03`), or install fewer modules / disable the whole plugin with `/plugin` where unused |

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

**`--openspec` / `--opsx` flag:** pass `--openspec` (alias `--opsx`) to `/dhpk:do` to force the OpenSpec authoring flow (`opsx:new` → `opsx:ff`, then stop for human review) instead of routing straight to implementation. It applies to the 3 change-authoring routes — `dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev` — and supersedes `--plan`. On every other route, including `dhpk:opsx-apply-goal`, the flag is a no-op: it prints `--openspec ignored: ...` and the route proceeds normally.

### 3. Post-edit review cycle (automatic)

No command needed. After any file edit the hooks automatically:

1. Drop a `.pending-*` sentinel for each relevant reviewer slot (code / db / sec / frontend / doc)
2. Remind dispatched reviewers to run in parallel at Stop
3. Warn before `git commit` while sentinels are open (configurable via `sentinel_commit_gate`: `warn` / `block` / `off` — see [`docs/configuration.md`](./configuration.md))

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

For a long-running change that should run without supervision — generates a single `/goal` command (with the `/opsx:apply` kickoff embedded), ready to paste into a fresh session:

```text
/dhpk:opsx-apply-goal my-change-id --max-duration 2h
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

**What the pasted `/goal` string actually contains:** an orientation-first kickoff — a single combined Bash orientation command that reads both the change's task head (`head -40 openspec/changes/<change-id>/tasks.md`) and the self-located `rules/execution-policy.md` (`$CLAUDE_PLUGIN_ROOT` first, else the newest installed plugin cache path, else `POLICY-UNRESOLVED` — falling back to the goal string's own inline gates, best-effort), first, *then* invokes `opsx:apply` on the change, with a fallback if the skill catalog hasn't registered yet (`Unknown skill` → retry once next turn → still failing → implement directly from the change directory's `proposal.md`/`design.md`/`tasks.md`). Part 0 itself is a bounded kickoff: the kickoff sentence, a hard-rule carve-out, the unknown-skill fallback, a one-line four-role dispatch roster (`dhpk:fast-worker` / `dhpk:deep-reasoner` / `dhpk:tdd-guide` / `dhpk:e2e-runner` — never `general-purpose` — inline only within a ≤2-file whole-implement-step footprint plus bookkeeping), an inline hard-rule guardrail, and a one-line CODEX ON/OFF declaration; the behavioral elaborations (premise-verification routing, the in-flight doubt cycle, the CODEX high-stakes peer path, and the session-end self-check) no longer live in the goal string — they live only in `rules/execution-policy.md` and bind through the orientation read. The remaining condition clauses are unchanged: every `tasks.md` checkbox is `[x]`; a universal check that no reviewer sentinel is pending (`ls .claude/artifacts/sessions/.pending-*` outputs `NONE`); one line per verification gate actually detected for this change (test runner, build, lint, coverage, smoke — only what applies, nothing forced); and stop limits (the turn budget as a hard checkpoint — write `.resume-note.md` and end the session, not advisory; the optional wall-clock limit; a blocked-on-human clause that annotates `[blocked: <reason>]` in `tasks.md` and stops when every remaining task needs a human-only action; and a hard-rule-escalation clause that halts and writes a resume note rather than guessing through an explicit policy conflict). Full structure: `skills/opsx-apply-goal/SKILL.md` Step 6 (Parts 0-4).

When `orchestration_dispatch=on` (default), the generated `/goal` condition also embeds a one-line dispatch directive routing implementation through the four-role roster — `fast-worker`, `deep-reasoner`, `tdd-guide`, `e2e-runner` (see item 9 below). Set `orchestration_dispatch=off` to fully opt out of that dispatch directive — implementation stays inline everywhere instead of being routed through worker agents.

**4000-character hard stop:** Claude Code's `/goal` input has a practical paste ceiling around 4000 characters. There is a single full template variant — no compact fallback exists. A typical change composes to roughly 3600 characters. If the composed goal string would exceed 4000 characters, that's treated as a should-never-fire template regression, not a routine condition: no `/goal` command is emitted at all — instead you get the measured character count and which setting or flag to adjust (turn off the `orchestration_dispatch` project setting, or drop `--codex` / `--smoke`) before re-running.

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

### 9. Implementation dispatch (automatic)

During the implement phase of `feature-dev`, `bug-fix`, and `adaptive-dev-workflow`, work is routed rather than written directly: reasoning-heavy work (unknown root cause, algorithm design, cross-file debugging) goes to `dhpk:deep-reasoner` (opus, read-only — returns a conclusion contract, never edits); mechanical work with a clear spec (boilerplate, scaffolds, rename sweeps, applying an approved plan) goes to `dhpk:fast-worker` (sonnet, write-capable — applies edits, runs verification, escalates after 3 failed attempts); small diffs (~≤2 files, unambiguous intent) stay inline; complex work chains both (`deep-reasoner` produces a fix spec → `fast-worker` applies it). `general-purpose` is prohibited for implementation while dispatch is on. Full table: [`rules/execution-policy.md`](../rules/execution-policy.md) §"Implementation dispatch".

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

Symlinks (default) or copies (`--copy`) the plugin's `codex/{skills,agents}` into the project's `.codex/`. Idempotent — re-run with `--update` after a plugin version bump. `codex/agents/` now ships 11 roles (4 hand-maintained generic + 7 generated from the canonical Claude agents via `scripts/gen-codex-agents.js`, up from 4). See `codex/AGENTS.md` and `codex/README.md` for the dual-harness model.

### Codex Plugin Marketplace (experimental)

dhpk also ships a Codex plugin manifest (`.codex-plugin/plugin.json` + a thin
marketplace-target wrapper at `plugins/dhpk/`) so Codex CLI's own plugin
marketplace can discover and install the `codex/skills/` mirror natively.
Two ways to install it:

**Option A — let the agent do it.** Paste this into a Codex CLI session:

```text
Add hmj1026/dhpk as a Codex plugin marketplace source, install the dhpk
plugin from it, then verify it's listed as installed. Run:
  codex plugin marketplace add hmj1026/dhpk
  codex plugin add dhpk@dhpk
  codex plugin list
Report back what codex plugin list shows, and check whether the codex/skills/
content actually resolved inside the installed plugin cache — Codex has a
known upstream issue (openai/codex#26037) where skills referenced via a
marketplace-target wrapper sometimes don't get copied into the runtime cache.
```

**Option B — run the commands yourself:**

```bash
codex plugin marketplace add hmj1026/dhpk   # or a local path while developing
codex plugin add dhpk@dhpk
codex plugin list
```

> **Plugin mode is currently experimental / fragile on Codex** (verified
> against `codex-cli 0.142.5`). Marketplace discovery and install work, but
> runtime skill loading from local/repo marketplaces is unreliable upstream
> ([openai/codex#26037](https://github.com/openai/codex/issues/26037)). The
> supported, fully-working path remains `install-codex-skills.sh` above — the
> marketplace manifest is additive, not a replacement.

See `.codex-plugin/README.md` and `plugins/dhpk/README.md` for details.

## Migrating an existing project

If the project already has its own `.claude/` harness, follow the phased plan:

1. **Phase A — baseline**: snapshot pre-install hook outputs and test results.
2. **Phase B — install (parallel)**: install the plugin with `userConfig.review_agents` pointing at the project's existing agents. Both sets of hooks fire side-by-side.
3. **Phase C — discovery**: confirm `/agents` and `/plugin details dhpk` show expected components.
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

The marketplace install path (`claude plugin install`) copies the plugin into `~/.claude/plugins/cache/`, so edits to the source repo do NOT take effect there until `claude plugin update dhpk`.
