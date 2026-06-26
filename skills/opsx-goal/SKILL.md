---
name: opsx-goal
argument-hint: '<change-id> [--turns N] [--dry-run]'
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
- `DRY_RUN` = `true` if `--dry-run` present

Missing `CHANGE_ID` → print usage and stop:
```
Usage: /dhpk:opsx-goal <change-id> [--turns N] [--dry-run]
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

## Step 4 — Detect test-runner scope and non-automatable tasks

From combined text of `proposal.md` + `design.md` + `tasks.md`, set boolean
flags `HAS_PHPUNIT`, `HAS_JEST`, `HAS_PYTEST`, `HAS_SWIFT_TEST`, `HAS_OTHER_TEST`.
A flag is `true` when at least one positive signal matches AND no negative
override matches. See `references/detection.md` for the full signal/override table.

If no flag is `true` → `HAS_TEST=false` (doc-only / harness-only changes; omit
Part 3 from the goal condition).

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

**Part 3 (only if `HAS_TEST=true`)** — one line per detected runner:
- `HAS_PHPUNIT` → `phpunit output shows 0 errors, 0 failures`
- `HAS_JEST` → `jest output shows 0 failed`
- `HAS_PYTEST` → `pytest output shows 0 failed`
- `HAS_SWIFT_TEST` → `swift test output shows 0 failures`
- `HAS_OTHER_TEST` → use the specific command and "0 failures" phrasing from tasks.md

**Part 4 (always — turn limit):**
```
OR stop after <TURN_BUDGET> turns and list in conversation:
(1) unchecked task items
(2) output of ls .claude/artifacts/sessions/.pending-*
```

## Step 7 — Emit output

### Block A — Analysis summary

```
╔══════════════════════════════════════════════════════════════╗
║  opsx-goal: <CHANGE_ID>
╠══════════════════════════════════════════════════════════════╣
║  Tasks       : <DONE_TASKS>/<TOTAL_TASKS> done, <OPEN_TASKS> open
║  Test runners: <detected runners, or "none detected">
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
• /goal resets on /new or /clear — re-run this command in the new session
• Sentinel check is self-calibrating: the goal satisfies when ls outputs
  NONE, regardless of which reviewers fired during implementation
• Haiku evaluator reads the conversation only — Claude must explicitly paste
  the ls output and test results into conversation for evaluation to work
• Combine with /auto mode for a fully unattended goal loop
• Turn budget ran out: /goal clear, then re-run with --turns N
```

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
- [ ] `--dry-run` stops after Block C (no "THIS SESSION" block)
- [ ] Archived change → warn and stop (no goal emitted)
- [ ] Missing `tasks.md` → fail with clear error message
