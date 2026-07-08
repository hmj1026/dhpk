---
name: opsx-apply-goal
argument-hint: '<change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--codex] [--smoke|--no-smoke] [--dry-run]'
description: 'Generate a single-paste /goal condition (with an embedded opsx:apply kickoff instruction) for an unattended OpenSpec change implementation session. Reads tasks.md + proposal.md, detects test-runner scope, calculates turn budget, and emits one /goal string — pasting it into a fresh session both sets the stop condition and starts implementation, since /goal triggers immediate action on submit. Use when starting an unattended implementation session for an OpenSpec change. Not for: archiving, verifying, or syncing changes (use opsx-archive / opsx-verify / opsx-sync).'
allowed-tools: 'Bash, Read, Glob'
---

# opsx-apply-goal

Goal-condition generator for OpenSpec change implementation sessions. Reads the
change artifacts and emits a single `/goal <condition>` command — with the
opsx:apply kickoff folded into the condition text — to paste into a fresh
session so Claude drives the change to completion unattended.

> **Why single-paste:** Claude Code's `/goal` triggers immediate action as soon
> as it is submitted — there is no window to paste a follow-up `/opsx:apply`
> command afterward. So the kickoff instruction ("invoke the opsx:apply skill")
> is embedded as the first sentence of the `/goal` condition itself, and the
> whole thing is delivered as one paste. Do not split this back into a
> `/goal` step followed by a separate `/opsx:apply` step — that leaves no
> input window for the second command.
>
> **Sentinel strategy:** the goal always checks `ls .claude/artifacts/sessions/.pending-*`
> rather than enumerating specific reviewers — self-calibrating across all 7 dhpk
> sentinel slots regardless of which files were edited. See
> `references/detection.md` for the rationale and detection-flag table.

## When NOT to Use

- Archiving a completed change → use `opsx-archive`
- Verifying implementation matches artifacts → use `opsx-verify`
- Syncing delta specs to main specs → use `opsx-sync`
- Change is already in `openspec/changes/archive/` (already archived)
- You want to run implementation now in this session (just run `/opsx:apply <change-id>` directly)

## Step 1 — Parse arguments

From `$ARGUMENTS`:
- `CHANGE_ID` = first non-flag token (required)
- `CUSTOM_TURNS` = integer after `--turns`, if present
- `MAX_DURATION` = value after `--max-duration` (e.g. `30m`, `2h`), if present.
  Absent → no wall-clock stop is emitted (behavior unchanged).
- `DRY_RUN` = `true` if `--dry-run` present
- `MIN_COVERAGE` = integer percent after `--min-coverage`, if present. Opt-in
  escape hatch: forces a coverage gate at this threshold even when the project
  has no native coverage config. Requires a detected test runner (`HAS_TEST=true`);
  ignored with a Block A note otherwise. Overrides any detected `COVERAGE_THRESHOLD`.
- `CODEX` = `on` if `--codex` is present, else `off` (codex-free default, per the dhpk `--codex` convention). Stated explicitly in the emitted goal's Part 0 so the orchestrator does not have to guess the session's cross-model setting.
- `SMOKE_FLAG` = `off` if `--no-smoke` is present, else `on` if `--smoke` is present, else `auto`. When both `--smoke` and `--no-smoke` are passed, `--no-smoke` wins (`SMOKE_FLAG=off`). This flag drives `HAS_SMOKE` resolution in Step 4 with precedence `--no-smoke` > `--smoke` > detection.

Missing `CHANGE_ID` → print usage and stop:
```
Usage: /dhpk:opsx-apply-goal <change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--codex] [--smoke|--no-smoke] [--dry-run]
Example: /dhpk:opsx-apply-goal fix-spec-select-empty-gplist-overflow
```

## Step 2 — Locate change directory

```bash
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ACTIVE="$ROOT/openspec/changes/$CHANGE_ID"
ARCHIVE="$ROOT/openspec/changes/archive/$CHANGE_ID"
```

1. `$ACTIVE` exists → `CHANGE_DIR=$ACTIVE` (proceed)
2. `$ARCHIVE` exists → warn and stop:
   ```
   [WARN] '$CHANGE_ID' is already archived — it may be complete.
   Path: openspec/changes/archive/$CHANGE_ID
   If you need to re-implement, move it back to openspec/changes/ first.
   ```
3. Neither exists → error and stop:
   ```
   [ERROR] Change '$CHANGE_ID' not found.
   Available active changes:
   ```
   Then `ls "$ROOT/openspec/changes/"` (excluding `archive/`)

## Step 3 — Read change artifacts

Use Read tool (not Bash cat) to read:
- **`$CHANGE_DIR/tasks.md`** (required — fail if missing)
- **`$CHANGE_DIR/proposal.md`** (required — fail if missing)
- **`$CHANGE_DIR/design.md`** (optional — read if it exists)

Extract:
- `TOTAL_TASKS` = count of lines matching `^- \[`
- `OPEN_TASKS`  = count of lines matching `^- \[ \]`
- `DONE_TASKS`  = count of lines matching `^- \[x\]`

## Step 4 — Detect verification-gate scope and non-automatable tasks

From combined text of `proposal.md` + `design.md` + `tasks.md`, set boolean
flags `HAS_PHPUNIT`, `HAS_JEST`, `HAS_PYTEST`, `HAS_SWIFT_TEST`, `HAS_OTHER_TEST`.
A flag is `true` when at least one positive signal matches AND no negative
override matches. See `references/detection.md` for the full signal/override table.

If no test-runner flag is `true` → `HAS_TEST=false` (doc-only / harness-only
changes; no test line in Part 3).

Then, from the same combined text, set `HAS_BUILD` and `HAS_LINT` the same way
(positive signal AND no negative override) — see `references/detection.md`
§Build/lint gates. These are independent of `HAS_TEST`: a build-only change can
have `HAS_BUILD=true` while `HAS_TEST=false`. If none of test / build / lint is
detected — and `HAS_SMOKE` (computed next) is also false — omit Part 3 entirely.
A detected `HAS_SMOKE=true` keeps Part 3 (with only the smoke line) even when no
test / build / lint gate is present.

Then set `HAS_SMOKE` — an opt-in **read-only live-runtime probe** gate — delegated
to `references/detection.md` §Drivable system. Detection is biased toward **high
precision**: a false positive deadlocks an unattended session against a system it
cannot actually drive, while a false negative merely means one fewer gate this run.
Resolution follows `SMOKE_FLAG` from Step 1:
- `off` (`--no-smoke`) → `HAS_SMOKE=false` regardless of any detected signal.
- `on` (`--smoke`) → `HAS_SMOKE=true` even when no launch command is derivable; in
  that case still emit the Block A note that the runtime could not be driven this
  session (the §Drivable system "--smoke without a derivable launch command" case).
- `auto` (no flag) → `HAS_SMOKE=true` ONLY on a **strong** signal (an explicit
  runtime-verification task in `proposal.md`/`tasks.md`, a dispatched `e2e-runner`
  task, or a derivable launch command from repo config). Any non-strong auto
  result — a **weak** signal (a compose file with no derivable launch command, a
  generic dev-server script with no stated port) **or no drivable signal at all**
  (a plugin/library repo with no running system, e.g. dhpk itself) — leaves
  `HAS_SMOKE=false` and adds the Block A hint: "weak or no drivable signal
  detected — pass `--smoke` to enable". The hint therefore fires on every
  detection-driven off state, which is what makes Block A's `off (no strong
  signal, hint emitted)` value accurate (it is used only for detection-off, never
  for the explicit `--no-smoke` off).

Additionally, scan each task line in `tasks.md` for non-automatable signals
(see `references/detection.md` §Non-automatable tasks). For each matching task:
- Add it to `SKIP_TASKS[]` list (full task text)
- Set `HAS_SKIP_TASKS=true`

These tasks require human verification and must be **excluded from Part 3**.
They still count toward Part 1 (all checkboxes must be `[x]` before the goal
satisfies — the implementer marks them manually after out-of-band verification).

## Step 5 — Calculate turn budget

`--turns N` provided → `TURN_BUDGET = N`.

Otherwise:
```
TURN_BUDGET = max(20, min(120, OPEN_TASKS × 4 + 20))
```
Each open task averages 2–4 turns; the +20 buffer covers reviewer invocations
and sentinel-clearance turns.

## Step 6 — Build goal condition string

Read `DISPATCH_ON` = `${CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH:-on}` —
true unless the value is exactly `off`.

Compose `GOAL_CONDITION` by joining the following parts with `,\n`.

**Part 0 (always, first — kickoff instruction):** this is what makes the
single-paste design work — `/goal` acts on this text immediately, so the
first thing Claude reads must be the action to take, not just the stop
condition.

`DISPATCH_ON=false` (`orchestration_dispatch=off`) — byte-identical to
pre-change output, no dispatch clause:
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
Continue until all of the following hold,
```

`DISPATCH_ON=true` (default) — the same kickoff with one dispatch directive
appended before the transition into the stop conditions:
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
You are the orchestrator: dispatch implementation
per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §Implementation dispatch —
mechanical/multi-file clear-spec work to dhpk:fast-worker (including multi-file
same-semantic artifact/doc consistency corrections, ≥3 files), reasoning-heavy
work to dhpk:deep-reasoner, RED/E2E specs that must run against a live server to
dhpk:e2e-runner; edit inline only for ≤2-file unambiguous diffs and your own
bookkeeping (tasks.md checkboxes, sentinels); when unsure, dispatch; never use
general-purpose. Before dispatching a write worker on a task resting on an
unverified behavioral premise (bug-repro condition, algorithm correctness,
data-shape/plan assumption), first verify the premise with the probe that can
actually run it — code/algorithm/data-shape premises with dhpk:deep-reasoner,
runtime/browser/environment behavior premises with dhpk:e2e-runner or a scratch
executable probe. Apply the Repository Discovery Gate before finalizing new DB,
SQL, query-builder, criteria, model-persistence, or repository-like code:
explicit project hard rules cannot be deferred because a prior design chose a cheaper implementation;
comply with the hard rule or stop for a human-approved
exception. <CODEX_STATEMENT>. After each worker returns, verify its
output per that section (re-surface the report, cross-check git diff, confirm
the sentinels). Continue until all of the following hold,
```
Substitute `<CODEX_STATEMENT>` with the session's CODEX setting from Step 1 (state it explicitly, never leave the orchestrator to infer it):
- `CODEX=on` → `CODEX is ON for this session: at a contradiction-arbitration point where two agents' conclusions directly conflict, run a cross-model (Codex) doubt cycle per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle rather than skipping it; and PROACTIVELY, before finalizing a high-stakes solo design edit or decision that has no inter-agent conflict to arbitrate — the goal-template generator itself, an SSOT policy file, the deferral of a spec'd requirement, first-seen query/repository patterns, framework-internal hacks or private-state resets, or explicit-rule deferrals — run a parallel dhpk:codex-bridge independent review per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §CODEX=on high-stakes parallel peer path, so the declared CODEX=on capability fires on the session's riskiest edits and not only at two-agent contradiction points`
- `CODEX=off` → `CODEX is OFF for this session: at a contradiction-arbitration point where two agents' conclusions directly conflict, announce "cross-model doubt skipped (CODEX=off)" per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle rather than performing a cross-model pass`
This reuses the existing skip-announced policy at `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §In-flight doubt cycle rather than introducing new wording there.

**Part 1 (always):**
```
All checkboxes in openspec/changes/<CHANGE_ID>/tasks.md are [x] (Claude confirmed in conversation)
```

**Part 2 (always — universal sentinel check):**
```
Claude ran `ls .claude/artifacts/sessions/.pending-* 2>/dev/null || echo NONE`
and confirmed the output is NONE in conversation (all pending reviewer sentinels cleared)
```

**Part 2b (always — unresolved reviewer verdict sidecar check):**
```
Claude ran `test ! -s .claude/artifacts/sessions/.unresolved-verdict && echo NONE || cat .claude/artifacts/sessions/.unresolved-verdict`
and confirmed the output is NONE in conversation (no unresolved reviewer verdict sidecar entries)
```

**Part 3 (verification gates — emit one line per detected gate; omit the whole
part only if none of test / build / lint is detected AND `HAS_SMOKE=false`):**

Test runners (only if `HAS_TEST=true`):
- `HAS_PHPUNIT` → `phpunit output shows 0 errors, 0 failures`
- `HAS_JEST` → `jest output shows 0 failed`
- `HAS_PYTEST` → `pytest output shows 0 failed`
- `HAS_SWIFT_TEST` → `swift test output shows 0 failures`
- `HAS_OTHER_TEST` → use the specific command and "0 failures" phrasing from tasks.md

**Pre-existing-failure rule** (applies to every test-runner line above): a runner also satisfies its gate when the only remaining failures are **proven pre-existing** — they still fail after `git stash` of this change's edits (so they are not change-introduced) and are unrelated to the change — provided each such failure is named in the completion summary. A failure that **disappears** when the change is stashed is change-introduced and still blocks. This keeps the full-suite run (so regressions the change causes anywhere are still caught) without letting one unrelated pre-existing red block the goal forever. Do NOT narrow the gate to only the change's own spec — that would miss regressions elsewhere.

**Pre-existing-warnings rule** (harness validators, e.g. `scripts/validate/validate-harness.sh`): a validator result of **PASS-with-warnings** counts as green for this gate when every remaining warning is **proven pre-existing** — present and identical on a `git stash`-ed clean HEAD, unrelated to the change, and named in the completion summary. A warning that **disappears** when the change is stashed is change-introduced and still blocks (mirroring the pre-existing-failure rule above). `validate-harness.sh` currently exits non-zero (2) on warnings-only; the gate SHALL NOT treat that non-zero exit alone as a failure when the `PASS (with warnings)` line and the pre-existing proof are both present.

Coverage (emit when `HAS_TEST=true` AND (`HAS_COVERAGE=true` OR `MIN_COVERAGE` is
set) — see `references/detection.md`): emit the test line using the runner's
coverage invocation (`COVERAGE_CMD`) so the runner enforces the threshold, folded
into that one line. Threshold precedence: `MIN_COVERAGE` (operator flag) overrides
a detected `COVERAGE_THRESHOLD`. When the project has no native coverage config but
`MIN_COVERAGE` is set, derive `COVERAGE_CMD` from the detected runner (jest →
`jest --coverage`, phpunit → `phpunit --coverage-text`, pytest →
`pytest --cov --cov-fail-under=<N>`, swift → `swift test --enable-code-coverage`).
Examples: `jest --coverage output shows 0 failed AND coverage thresholds met`, or
`pytest --cov output shows 0 failed AND total coverage ≥ <threshold>%`. Keep it one
verifiable line (replaces the plain test line for that runner). Otherwise emit the
plain `0 failed` line and add no coverage condition. If `MIN_COVERAGE` is set but
`HAS_TEST=false`, ignore it and note in Block A (no runner to measure coverage).

Build / lint (only if detected — conditional, never forced):
- `HAS_BUILD` → `build output shows 0 errors`
- `HAS_LINT` → `lint output shows 0 errors`

Smoke gate (a **read-only live-runtime probe**, emitted ONLY when `HAS_SMOKE=true`
— omit this line entirely when `HAS_SMOKE=false`). Satisfied by exactly one of two
branches:
- (a) `dhpk:smoke-tester` was dispatched with one concrete scenario (the
  orchestrator sources the scenario from the change's claimed user-visible
  behavior in `proposal.md`/`tasks.md` — the agent never invents its own scope),
  its report's **first line is `Verdict: PASS`**, and the key observed value from
  that report was pasted into the conversation; OR
- (b) a self-escaping hatch — a one-line note was pasted stating why the system
  could not be driven this session (launch command failed / no runtime available)
  together with the failing command's output.
A `Verdict: FAIL` report does NOT satisfy the gate. Branch (b) mirrors the
pre-existing-failure hatch above: a named, evidenced exception, never a silent
skip — a bare "couldn't run it" claim without the failing command's output does
not satisfy it. The hatch prevents a strong-signal detection from deadlocking an
unattended session when the runtime is genuinely unreachable this session.

**Part 4 (always — stop limits):**

Emit the turn line always. Emit the wall-clock line **only if `MAX_DURATION` is
set** (when absent, omit that line — behavior unchanged):
```
OR stop after <TURN_BUDGET> turns
OR stop after <MAX_DURATION> wall-clock elapsed
OR stop immediately when an explicit project hard-rule conflict cannot be
resolved by strict compliance without human input; write
openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md with the rule,
conflicting decision with file:line evidence, and why compliance is blocked,
then end the turn without continuing or waiting
and list in conversation, then write the same three items into
openspec/changes/<CHANGE_ID>/.resume-note.md:
(1) unchecked task items
(2) output of ls .claude/artifacts/sessions/.pending-*
(3) a one-line next-focus hint
```
The `.resume-note.md` carry-forward lets a follow-up session resume cleanly via
`opsx-load-context` (which checks for it before all other context tiers).

## Step 6b — Enforce the 4000-character paste limit

Claude Code's `/goal` input has a practical paste limit around 4000
characters — a `GOAL_CONDITION` at or beyond that cannot be submitted at
all. Measure before Step 7 emits anything, and shrink if needed:

1. `GOAL_LENGTH` = character count of the full composed `GOAL_CONDITION`
   from Step 6 (Part 0 + Part 1 + Part 2 + Part 2b + Part 3 + Part 4,
   joined exactly as Step 6 specifies).
2. `GOAL_LENGTH <= 4000` → proceed to Step 7 unmodified. `GOAL_MODE = full`.
3. `GOAL_LENGTH > 4000` → rebuild **Part 0 only** using the **compact**
   variant below (same `DISPATCH_ON` branch, same `<CODEX_STATEMENT>`
   substitution point but using the **compact** `CODEX_STATEMENT` variant).
   Parts 1, 2, 2b, 3, 4 are unchanged — their length scales with the
   change itself (task counts, detected gates), not with fixed prose, so
   there is nothing to compact there. Recompute `GOAL_LENGTH`.
   - `GOAL_LENGTH <= 4000` now → proceed to Step 7. `GOAL_MODE = compacted`.
   - `GOAL_LENGTH > 4000` still → `GOAL_MODE = blocked`. In Step 7, emit
     Block A only, then the hard-stop notice — do **not** print Block B,
     C, or C2.

### Part 0 — compact variant

Preserves every safety-relevant clause (hard-rule carve-out, dispatch-table
pointer + never-general-purpose, premise-verification-before-dispatch, the
Repository Discovery Gate, verify-worker-output-after) and drops
illustrative examples only.

`DISPATCH_ON=false` compact — identical to the full text (already short,
nothing to compact):
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
Continue until all of the following hold,
```

`DISPATCH_ON=true` compact:
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation (ordinary implementation judgment calls only —
never an explicit project hard-rule conflict bypass). You are the
orchestrator: dispatch implementation per
${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §Implementation dispatch
(mechanical/clear-spec work to dhpk:fast-worker, reasoning-heavy work to
dhpk:deep-reasoner, RED/E2E specs to dhpk:e2e-runner; inline only for
≤2-file unambiguous diffs plus bookkeeping; when unsure, dispatch; never
general-purpose). Verify an unresolved behavioral premise with the matching
probe (dhpk:deep-reasoner for code/algorithm/data-shape,
dhpk:e2e-runner or a scratch probe for runtime/browser/environment) before
dispatching a write worker on it. Apply the Repository Discovery Gate before
finalizing new DB/query/repository-like code: explicit project hard rules
cannot be deferred because a prior design chose a cheaper implementation;
comply or stop for a human-approved exception. <CODEX_STATEMENT>. Verify
each worker's output (report, git diff, sentinels) before continuing.
Continue until all of the following hold,
```

### CODEX_STATEMENT — compact variant

- `CODEX=on` → `CODEX is ON for this session: run a cross-model (Codex)
  doubt cycle at a contradiction-arbitration point rather than skipping
  it, and PROACTIVELY run a parallel dhpk:codex-bridge independent review
  before finalizing a high-stakes solo design edit or decision with no
  inter-agent conflict to arbitrate (the goal-template generator, an SSOT
  policy file, a spec'd-requirement deferral, first-seen query/repository
  patterns, framework-internal hacks or private-state resets, or
  explicit-rule deferrals), per
  ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle
  and §CODEX=on high-stakes parallel peer path`
- `CODEX=off` → identical to the full-text variant (already short):
  `CODEX is OFF for this session: at a contradiction-arbitration point
  where two agents' conclusions directly conflict, announce "cross-model
  doubt skipped (CODEX=off)" per
  ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle
  rather than performing a cross-model pass`

## Step 7 — Emit output

### Block A — Analysis summary

```
╔══════════════════════════════════════════════════════════════╗
║  opsx-apply-goal: <CHANGE_ID>
╠══════════════════════════════════════════════════════════════╣
║  Tasks       : <DONE_TASKS>/<TOTAL_TASKS> done, <OPEN_TASKS> open
║  Test runners: <detected runners, or "none detected">
║  Coverage    : <enforced threshold <T> (config | --min-coverage) | not enforced (pass --min-coverage N) | not enforced (no test runner) | --min-coverage ignored (no test runner)>
║  Smoke gate  : <on (signal) | on (--smoke) | off (--no-smoke) | off (no strong signal, hint emitted)>
║  Sentinels   : universal check (all 7 slots, self-calibrating)
║  Turn budget : <TURN_BUDGET>  (formula: <OPEN_TASKS> × 4 + 20, cap 20–120)
║  Manual tasks: <N skipped, or "none">
║  Goal length : <GOAL_LENGTH>/4000 chars  <full | compacted | ⚠ BLOCKED>
╚══════════════════════════════════════════════════════════════╝
```

The `Goal length` row reflects `GOAL_MODE` from Step 6b: `full` (unmodified
Part 0), `compacted` (Part 0/CODEX_STATEMENT swapped for the compact
variant, same rules, shorter wording), or `⚠ BLOCKED` (still over 4000
after compacting — see below, no `/goal` is emitted this run).

If `HAS_SKIP_TASKS=true`, append after the box:

```
⚠  <N> task(s) require human verification — exempt from auto-goal (Part 3):
   • <task text, truncated to 72 chars>
   • ...
   Mark these [x] manually after out-of-band verification before the session ends.
```

If `GOAL_MODE = blocked`, stop here — do **not** print Block B, C, or C2.
Print this hard-stop notice instead and end the skill's output:

```
✖ Goal condition is <GOAL_LENGTH> characters — <GOAL_LENGTH - 4000> over the
  4000-character paste limit even after compacting. Adjust and re-run:
  • turn off the orchestration_dispatch project setting (removes the dispatch directive, the largest single block)
  • drop --codex (removes the CODEX statement)
  • drop --smoke / pass --no-smoke (removes the smoke-gate line)
  • fewer verification gates detected → consider splitting into smaller changes
No /goal command was emitted this run.
```

Otherwise (`GOAL_MODE = full` or `compacted`), continue with Block B below.

### Block B — Session setup

```
━━━ STEP 1 — Open a new implementation session ━━━━━━━━━━━━━━━
/new

━━━ STEP 2 — Set the goal AND start implementation (single paste) ━━
```

Print the `/goal` command in a fenced code block. This one paste both sets
the stop condition and kicks off implementation — `GOAL_CONDITION` already
opens with the Part 0 kickoff sentence, so there is nothing further to paste
after this. When `GOAL_MODE = compacted`, this is the compacted `GOAL_CONDITION`
from Step 6b (same rules, shorter wording) — not the full-text example shown
earlier in this skill:
```
/goal <GOAL_CONDITION>
```

### Block C — Reminders

```
━━━ NOTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• /goal acts immediately on submit — there is no window to paste a follow-up
  command, which is why the /goal string above already embeds the opsx:apply
  kickoff. Paste it as-is; do not split it into two steps.
• Pre-flight before an unattended loop: clean git / worktree (a rollback path
  exists), branch or worktree isolation in place, and a quality gate (test /
  build / lint) detected above — if none is detected the loop has no safety net,
  so add one or supervise the run
• Clear stale / orphaned sentinels first (a leaked or unknown .pending-*
  blocks the goal's NONE check):
  bash "$CLAUDE_PLUGIN_ROOT/scripts/hooks/reap-stale-sentinels.sh" --threshold-minutes 60 --clear
• Brownfield with no baseline specs: if openspec/specs/ is empty, run
  /spec-mine (spec-miner agent) first so change deltas have a baseline truth
  to reference — then start the goal loop
• /goal resets on /new or /clear — re-run this command in the new session
• Sentinel check is self-calibrating: the goal satisfies when ls outputs
  NONE, regardless of which reviewers fired during implementation
• Worker dispatch (dhpk:deep-reasoner / dhpk:fast-worker, when
  orchestration_dispatch=on) does not change the sentinel gate: fast-worker
  edits converge through the same universal `ls .pending-*` check in Part 2 —
  no separate check is added or needed for worker-produced edits
• You are the orchestrator (the expensive tier); routing mechanical / multi-file
  clear-spec work to dhpk:fast-worker is the point of dispatch, not an optional
  nicety — inline is a ≤2-file exception plus your own bookkeeping, and when
  unsure between inline and a worker, dispatch
• Haiku evaluator reads the conversation only — Claude must explicitly paste
  the ls output and test results into conversation for evaluation to work
• Combine with /auto mode for a fully unattended goal loop
• Turn budget ran out: /goal clear, then re-run with --turns N
  — worker dispatch shifts turn consumption (fewer main-loop implement turns,
  more dispatch/collect turns); the formula above is unchanged this release,
  so re-tune with --turns N if the default misfits under dispatch
• --max-duration ran out: same recovery — /goal clear, then re-run
• Smoke gate (opt-in): a read-only live-runtime probe (dhpk:smoke-tester) drives
  the real running system with one concrete scenario and observes the result —
  high-precision detection (strong signals only; --smoke forces on, --no-smoke
  suppresses), so it never deadlocks a non-drivable repo (plugin/library repos
  with no running system)
• Goal length capped at 4000 chars (Claude Code's practical /goal paste limit,
  see Step 6b): over the cap, Part 0's dispatch directive is auto-compacted
  (same rules, shorter wording) — check the Block A "Goal length" row; if still
  over after compacting, no /goal is emitted and Block A's hard-stop notice
  lists which setting or flag to adjust and re-run
```

If `HAS_COVERAGE=false` AND `MIN_COVERAGE` is unset AND `HAS_TEST=true`, append one NOTES line:

```
• Coverage gate OFF (no coverage threshold configured) — new-code coverage is
  NOT gated; author tests via feature-dev / tdd-guide, add a native coverage
  threshold (jest coverageThreshold / phpunit <coverage> min / pytest
  --cov-fail-under), or pass --min-coverage N to opsx-apply-goal to force it this run
```

### Block C2 — Monitor (always printed; read-only)

Print a snippet the operator can paste into a **second terminal** to watch
progress without touching the running session. Pure reads, no side effects:

```
━━━ MONITOR (run in a SECOND terminal, read-only) ━━━━━━━━━━━━
# open vs done tasks (re-run to watch progress)
grep -c '^- \[ \]' openspec/changes/<CHANGE_ID>/tasks.md   # open
grep -c '^- \[x\]' openspec/changes/<CHANGE_ID>/tasks.md   # done
# pending reviewer sentinels (NONE = all cleared)
ls .claude/artifacts/sessions/.pending-* 2>/dev/null || echo NONE
# unresolved reviewer verdicts (NONE = no blocker sidecar)
test ! -s .claude/artifacts/sessions/.unresolved-verdict && echo NONE || cat .claude/artifacts/sessions/.unresolved-verdict
```

Stall read: if two consecutive checks show the same `open` count with no new
commits — or the session keeps hitting the *same* failure signature (identical
error / stack trace) — it is stuck; stop and re-scope rather than let it loop.
Judgement is the operator's; the probe only reports data, it never intervenes.

If `DRY_RUN=true`, stop here.

If `DRY_RUN=false`, add:

```
━━━ THIS SESSION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Commands above are ready. /goal does not carry across sessions —
run STEP 2 in the new session after /new.
This session will NOT auto-run /goal or opsx:apply.
```

## Verification

- [ ] Block A shows correct task counts, detected runners, and manual-task count
- [ ] Block B `/goal` string is entirely in English
- [ ] Block B `/goal` string opens with the Part 0 opsx:apply kickoff sentence
      before the stop conditions — single paste, no separate STEP 3
- [ ] Part 0 dispatch clause: posture-first when `DISPATCH_ON=true` — names the
      session as orchestrator, routes mechanical/multi-file clear-spec work to
      dhpk:fast-worker (including the multi-file, ≥3-file same-semantic
      artifact/doc consistency example) and reasoning-heavy work to
      dhpk:deep-reasoner, bounds inline to ≤2-file unambiguous diffs plus
      bookkeeping, says "when unsure, dispatch", forbids general-purpose,
      instructs verifying an unverified behavioral premise with the matching
      probe before a write dispatch — code/algorithm/data-shape premises to
      dhpk:deep-reasoner AND runtime/browser/environment premises to
      dhpk:e2e-runner or a scratch probe, both branches present — references
      the Repository Discovery Gate and states that explicit project hard rules
      cannot be deferred because a prior design chose a cheaper implementation,
      the §Implementation dispatch verify procedure (re-surface report /
      cross-check git diff / confirm sentinels) anchored at
      `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (not a bare relative
      path), and states the session's CODEX setting explicitly (`CODEX is ON`
      or `CODEX is OFF` per Step 1's `--codex` detection) — and when `CODEX is
      ON`, the CODEX statement also carries the proactive high-stakes-peer clause
      (a parallel dhpk:codex-bridge independent review before finalizing a
      high-stakes solo design edit or decision, including first-seen
      query/repository patterns, framework-internal hacks, and explicit-rule
      deferrals, per §CODEX=on high-stakes parallel peer path); absent —
      Part 0 retains the no-dispatch behavior except for the explicit hard-rule
      carve-out —
      when `orchestration_dispatch=off`
- [ ] Sentinel check in Part 2 uses `ls .claude/artifacts/sessions/.pending-*` (not reviewer names)
- [ ] Part 2b checks `.unresolved-verdict` and requires output `NONE`
- [ ] Non-automatable tasks appear in Block A warning, NOT in Part 3
- [ ] `--max-duration` set → Part 4 has the wall-clock line; absent → no such line
- [ ] Part 3 emits build/lint gate lines only when `HAS_BUILD` / `HAS_LINT` detected
- [ ] Part 3 emits a coverage gate when `HAS_COVERAGE=true` OR `--min-coverage N` set (with `HAS_TEST=true`); `--min-coverage` overrides a detected threshold and is ignored (Block A note) when no test runner is detected
- [ ] Part 4 instructs writing `.resume-note.md` with items (1)(2)(3) on stop
- [ ] Part 4 hard-rule stop clause writes `openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md` with rule, conflicting decision with file:line evidence, and why compliance is blocked, then ends the turn
- [ ] Part 0 says "without stopping for confirmation" covers ordinary implementation judgment calls only and never an explicit project hard-rule conflict
- [ ] Block C2 Monitor snippet is present and read-only (grep + ls only)
- [ ] Block C NOTES include the unattended-loop pre-flight (rollback path / isolation / quality gate)
- [ ] `--dry-run` stops after Block C2 Monitor (no "THIS SESSION" block)
- [ ] Archived change → warn and stop (no goal emitted)
- [ ] Missing `tasks.md` → fail with clear error message
- [ ] Part 3 emits the smoke gate line if and only if `HAS_SMOKE=true` (strong signal or `--smoke`); the line is omitted entirely when `HAS_SMOKE=false`
- [ ] `--no-smoke` suppresses the smoke line regardless of detected signal strength; Block A `Smoke gate` row reports exactly one of `on (signal)` / `on (--smoke)` / `off (--no-smoke)` / `off (no strong signal, hint emitted)`
- [ ] Block A `Goal length` row is always present and reports one of `full` / `compacted` / `⚠ BLOCKED`, matching `GOAL_MODE`
- [ ] Part 0 compact variant is used only when the full `GOAL_CONDITION` exceeds 4000 characters, and preserves the hard-rule carve-out, dispatch-table pointer, never-general-purpose rule, premise-verification rule, and Repository Discovery Gate sentence
- [ ] `GOAL_MODE = blocked` (still over 4000 after compacting) suppresses Block B, C, and C2 entirely and prints the hard-stop notice with all four setting/flag-adjustment bullets instead
