---
name: opsx-goal
argument-hint: '<change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--dry-run]'
description: 'Generate a /goal condition for an unattended OpenSpec change implementation session. Reads tasks.md + proposal.md, detects test-runner scope, calculates turn budget, and emits the /goal string + /opsx:apply sequence ready to paste into a fresh session. Use when starting an unattended implementation session for an OpenSpec change. Not for: archiving, verifying, or syncing changes (use opsx-archive / opsx-verify / opsx-sync).'
allowed-tools: 'Bash, Read, Glob'
---

# opsx-goal

Goal-condition generator for OpenSpec change implementation sessions. Reads the
change artifacts and emits the `/goal` and `/opsx:apply` commands to run in a
fresh session so Claude drives the change to completion unattended.

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

Missing `CHANGE_ID` → print usage and stop:
```
Usage: /dhpk:opsx-goal <change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--dry-run]
Example: /dhpk:opsx-goal fix-spec-select-empty-gplist-overflow
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
detected, omit Part 3 entirely.

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

Compose `GOAL_CONDITION` by joining the following parts with `,\n`:

**Part 1 (always):**
```
All checkboxes in openspec/changes/<CHANGE_ID>/tasks.md are [x] (Claude confirmed in conversation)
```

**Part 2 (always — universal sentinel check):**
```
Claude ran `ls .claude/artifacts/sessions/.pending-* 2>/dev/null || echo NONE`
and confirmed the output is NONE in conversation (all pending reviewer sentinels cleared)
```

**Part 3 (verification gates — emit one line per detected gate; omit the whole
part only if none of test / build / lint is detected):**

Test runners (only if `HAS_TEST=true`):
- `HAS_PHPUNIT` → `phpunit output shows 0 errors, 0 failures`
- `HAS_JEST` → `jest output shows 0 failed`
- `HAS_PYTEST` → `pytest output shows 0 failed`
- `HAS_SWIFT_TEST` → `swift test output shows 0 failures`
- `HAS_OTHER_TEST` → use the specific command and "0 failures" phrasing from tasks.md

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

**Part 4 (always — stop limits):**

Emit the turn line always. Emit the wall-clock line **only if `MAX_DURATION` is
set** (when absent, omit that line — behavior unchanged):
```
OR stop after <TURN_BUDGET> turns
OR stop after <MAX_DURATION> wall-clock elapsed
and list in conversation, then write the same three items into
openspec/changes/<CHANGE_ID>/.resume-note.md:
(1) unchecked task items
(2) output of ls .claude/artifacts/sessions/.pending-*
(3) a one-line next-focus hint
```
The `.resume-note.md` carry-forward lets a follow-up session resume cleanly via
`opsx-load-context` (which checks for it before all other context tiers).

## Step 7 — Emit output

### Block A — Analysis summary

```
╔══════════════════════════════════════════════════════════════╗
║  opsx-goal: <CHANGE_ID>
╠══════════════════════════════════════════════════════════════╣
║  Tasks       : <DONE_TASKS>/<TOTAL_TASKS> done, <OPEN_TASKS> open
║  Test runners: <detected runners, or "none detected">
║  Coverage    : <enforced threshold <T> (config | --min-coverage) | not enforced (pass --min-coverage N) | not enforced (no test runner) | --min-coverage ignored (no test runner)>
║  Sentinels   : universal check (all 7 slots, self-calibrating)
║  Turn budget : <TURN_BUDGET>  (formula: <OPEN_TASKS> × 4 + 20, cap 20–120)
║  Manual tasks: <N skipped, or "none">
╚══════════════════════════════════════════════════════════════╝
```

If `HAS_SKIP_TASKS=true`, append after the box:

```
⚠  <N> task(s) require human verification — exempt from auto-goal (Part 3):
   • <task text, truncated to 72 chars>
   • ...
   Mark these [x] manually after out-of-band verification before the session ends.
```

### Block B — Session setup

```
━━━ STEP 1 — Open a new implementation session ━━━━━━━━━━━━━━━
/new

━━━ STEP 2 — Set the goal (do this before /opsx:apply) ━━━━━━━
```

Print the `/goal` command in a fenced code block:
```
/goal <GOAL_CONDITION>
```

```
━━━ STEP 3 — Start implementation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/opsx:apply <CHANGE_ID>
```

### Block C — Reminders

```
━━━ NOTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
• Haiku evaluator reads the conversation only — Claude must explicitly paste
  the ls output and test results into conversation for evaluation to work
• Combine with /auto mode for a fully unattended goal loop
• Turn budget ran out: /goal clear, then re-run with --turns N
• --max-duration ran out: same recovery — /goal clear, then re-run
```

If `HAS_COVERAGE=false` AND `MIN_COVERAGE` is unset AND `HAS_TEST=true`, append one NOTES line:

```
• Coverage gate OFF (no coverage threshold configured) — new-code coverage is
  NOT gated; author tests via feature-dev / tdd-guide, add a native coverage
  threshold (jest coverageThreshold / phpunit <coverage> min / pytest
  --cov-fail-under), or pass --min-coverage N to opsx-goal to force it this run
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
run STEP 2 → STEP 3 in the new session after /new.
This session will NOT auto-run /opsx:apply.
```

## Verification

- [ ] Block A shows correct task counts, detected runners, and manual-task count
- [ ] Block B `/goal` string is entirely in English
- [ ] Sentinel check in Part 2 uses `ls .claude/artifacts/sessions/.pending-*` (not reviewer names)
- [ ] Non-automatable tasks appear in Block A warning, NOT in Part 3
- [ ] `--max-duration` set → Part 4 has the wall-clock line; absent → no such line
- [ ] Part 3 emits build/lint gate lines only when `HAS_BUILD` / `HAS_LINT` detected
- [ ] Part 3 emits a coverage gate when `HAS_COVERAGE=true` OR `--min-coverage N` set (with `HAS_TEST=true`); `--min-coverage` overrides a detected threshold and is ignored (Block A note) when no test runner is detected
- [ ] Part 4 instructs writing `.resume-note.md` with items (1)(2)(3) on stop
- [ ] Block C2 Monitor snippet is present and read-only (grep + ls only)
- [ ] Block C NOTES include the unattended-loop pre-flight (rollback path / isolation / quality gate)
- [ ] `--dry-run` stops after Block C2 Monitor (no "THIS SESSION" block)
- [ ] Archived change → warn and stop (no goal emitted)
- [ ] Missing `tasks.md` → fail with clear error message
