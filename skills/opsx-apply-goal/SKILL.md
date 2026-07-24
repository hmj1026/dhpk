---
name: opsx-apply-goal
argument-hint: '<change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--worker=<claude|codex|agy|auto>] [--codex] [--smoke|--no-smoke] [--dry-run]'
description: 'Unattended OpenSpec goal generator. Use when: an existing change-id needs a bounded fresh-session implementation goal. Not for: authoring, applying in the current session, verifying, syncing, or archiving. Output: an analysis summary plus one pasteable /goal condition, or a hard-stop report.'
allowed-tools: 'Bash, Read, Glob'
effort: low
---

# opsx-apply-goal

This skill has one job: turn an existing OpenSpec change into a bounded
`/goal <condition>` command. It reads the change artifacts, folds the
`opsx:apply` kickoff into the condition, and emits one command for a fresh
session to run the change unattended.

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

## References

| File | Read when |
|------|-----------|
| `scripts/analyze-change.sh` | Step 1 — deterministic argument normalization, change-dir location, checkbox counts, and turn budget |
| `scripts/goal-context.js` | Step 1 — helper I/O for fast-worker selection, E2E detection, and the task digest |
| `references/detection.md` | Step 2 — test/build/lint/coverage/smoke signal tables, non-automatable-task signals, and sentinel rationale |
| `references/gate-contracts.md` | Step 3 — compact evidence contracts that every emitted gate must preserve |
| `references/goal-templates.md` | Steps 3–4 — verbatim Part 0–4 `/goal` condition templates, including the single full variant |
| `references/output-blocks.md` | Output — complete Block A/B/C/C2 contract, hard-stop branch, and session handoff |

## When NOT to Use

- Archiving a completed change → use `opsx-archive`
- Verifying implementation matches artifacts → use `opsx-verify`
- Syncing delta specs to main specs → use `opsx-sync`
- Change is already in `openspec/changes/archive/` (already archived)
- You want to run implementation now in this session (just run `/opsx:apply <change-id>` directly)

The output is a generated execution contract, not approval, implementation, or
verification evidence.

## Step 1 — Analyze the change (deterministic)

Run the analyzer with `$ARGUMENTS` verbatim; it normalizes arguments (incl. the
`--no-smoke > --smoke > auto` precedence), locates the change dir, counts the
checkboxes, and computes the turn budget:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/opsx-apply-goal/scripts/analyze-change.sh" $ARGUMENTS
```

It prints a `# schema=v1` KEY=VALUE block. Act on `STATUS`:

- `STATUS=missing` → print the `MESSAGE` and the `AVAILABLE_CHANGES` list, then stop.
- `STATUS=archived` → print the `MESSAGE` (already archived — may be complete) and stop.
- `STATUS=error` → print the `MESSAGE` (missing `tasks.md`/`proposal.md`) and stop.
- Exit code 2 → missing `CHANGE_ID`; print the usage line the script emitted and stop.
- `STATUS=active` → read the remaining keys and continue: `CHANGE_DIR`, `HAS_DESIGN`,
  `TOTAL_TASKS`, `OPEN_TASKS`, `DONE_TASKS`, `TURN_BUDGET`, `TURN_BUDGET_SOURCE`,
  `SMOKE_FLAG`, `CODEX`, `DRY_RUN`, `MAX_DURATION`, `MIN_COVERAGE`,
  `FAST_WORKER_REQUESTED`, `FAST_WORKER_SELECTED`, `FAST_WORKER_AGENT`,
  `FAST_WORKER_ORDER`, `FAST_WORKER_FALLBACK`, `FAST_WORKER_REJECTED`,
  `FAST_WORKER_CLAUSE`, `HAS_E2E`, and `TASK_DIGEST`.

`analyze-change.sh` invokes the sibling `goal-context.js` helper after the
deterministic fields. The helper accepts `--tasks=<path>`, `--proposal=<path>`,
and `--worker=<backend>`, writes `FAST_WORKER_*`, `HAS_E2E`, and `TASK_DIGEST`
fields to stdout, writes warnings to stderr, and exits non-zero on an input or
helper failure. Treat a missing helper tail as an analyzer failure, not as a
partial result.

The analyzer parses and strips
`--worker=<claude|codex|agy|auto>` before analyzing the change, using the same
normalization contract as its other invocation flags. Resolve the effective backend with
precedence **flag > userConfig > shipped default** (`claude`). An invalid flag
prints one warning line and falls back to the configured userConfig/default
resolution; it never fails change analysis.

The analyzer computes the turn budget as
`max(20, min(120, OPEN_TASKS × 4 + 20))` unless `--turns N` overrides it. Each
open task averages 2–4 turns; the +20 buffer covers reviewer invocations and
sentinel-clearance turns. Gate detection follows because it needs judgment the
analyzer deliberately does not attempt.

**Completion criterion:** exactly one analyzer status is handled; `missing`,
`archived`, `error`, and exit-2 stop with their reported message, while only an
`active` result with the helper fields continues.

## Step 2 — Detect verification-gate scope and non-automatable tasks

Read `tasks.md` + `proposal.md` (+ `design.md` when `HAS_DESIGN=true`) with the
Read tool. From their combined text, set the gate flags per the signal/override
tables in `references/detection.md`:

- Test runners → `HAS_PHPUNIT` / `HAS_JEST` / `HAS_PYTEST` / `HAS_SWIFT_TEST` /
  `HAS_OTHER_TEST`. None true → `HAS_TEST=false`.
- `HAS_BUILD`, `HAS_LINT` (independent of `HAS_TEST`).
- `HAS_E2E` is supplied by the analyzer from tasks.md + proposal.md using the
  deterministic Playwright / `.spec.js` / `.spec.ts` / browser-journey signals.
- `HAS_COVERAGE` (only when `HAS_TEST=true` AND a fail-threshold is configured);
  capture `COVERAGE_CMD` / `COVERAGE_THRESHOLD`. `MIN_COVERAGE` (operator flag)
  overrides a detected threshold and is ignored — with a Block A note — when
  `HAS_TEST=false`.
- `HAS_SMOKE` — an opt-in read-only live-runtime probe gate, biased toward **high
  precision** (a false positive deadlocks an unattended session against a system
  it cannot drive). Resolve from `SMOKE_FLAG`:
  - `off` → `HAS_SMOKE=false` regardless of signal.
  - `on` → `HAS_SMOKE=true` even with no derivable launch command; add the Block A
    note that the runtime could not be driven this session.
  - `auto` → `HAS_SMOKE=true` ONLY on a **strong** signal (see detection.md
    §Drivable system); any weak-or-no signal → `HAS_SMOKE=false` plus the Block A
    hint "weak or no drivable signal detected — pass `--smoke` to enable".

Also scan each `tasks.md` line for non-automatable signals (detection.md
§Non-automatable tasks). For each match, add its full text to `SKIP_TASKS[]` and
set `HAS_SKIP_TASKS=true`. These require human verification and are **excluded
from Part 3**, but still count toward Part 1 (the implementer marks them `[x]`
manually after out-of-band verification).

**Completion criterion:** every gate flag, derived command or threshold, smoke
mode, and manual-task entry needed by the template has an explicit value.

## Step 3 — Compose the goal condition

Read `DISPATCH_ON` = `${CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH:-on}` — true
unless the value is exactly `off`.

Compose `GOAL_CONDITION` from the verbatim templates in
`references/goal-templates.md`, joining the parts with `,\n`:

- **Part 0** (kickoff, always first — this is what makes single-paste work):
  pick the `DISPATCH_ON=true` or `false` branch, then substitute
  `<CODEX_STATEMENT>` with the `CODEX=on`/`off` text (state the session's CODEX
  setting explicitly — never leave the orchestrator to infer it). Substitute
  the analyzer's `<FAST_WORKER_CLAUSE>` (already resolved by the shared selector,
  with flag > userConfig > default) and its `TASK_DIGEST`, capped at 200 UTF-8 bytes without splitting a code point. The clause and the entire
  `mechanical → <FAST_WORKER_CLAUSE>;` segment, including its trailing separator,
  are always substituted in the `DISPATCH_ON=true` branch, regardless of what
  the footprint scan finds: mechanical work routinely surfaces mid-session that
  no pre-written tasks.md footprint predicted. Deliberately NOT symmetric with
  `<E2E_ROSTER_CLAUSE>` below — see `references/goal-templates.md` for why.
  Substitute `<E2E_ROSTER_CLAUSE>` with `RED/E2E Playwright → dhpk:e2e-runner;`
  only when `HAS_E2E=true`; otherwise substitute the empty string.
- **Parts 1, 2, 2b** — always (tasks-done, universal `.pending-*` sentinel check,
  `.unresolved-verdict` sidecar check).
- **Part 3** — one line per detected gate (test runners per their flags, coverage,
  build, lint, smoke). Omit Part 3 entirely only when test / build / lint are all
  absent AND `HAS_SMOKE=false`; a lone `HAS_SMOKE=true` keeps Part 3 with just the
  smoke line. The pre-existing-failure / pre-existing-warnings rules and the smoke
  gate's PASS/FAIL + self-escaping-hatch semantics are stated with the templates.
  Substitute `<TURN_BUDGET>` and (only if `MAX_DURATION` is set) the wall-clock
  line in **Part 4**.

**Completion criterion:** every placeholder in Parts 0–4 is resolved from the
analyzer or the detected gate scope, and the condition preserves the compact
gate contracts in `gate-contracts.md`.

## Step 4 — Enforce the 4,000 UTF-8-byte paste limit

Claude Code's `/goal` input has a practical paste limit around 4,000 UTF-8 bytes —
the unit measured by `wc -c`; a `GOAL_CONDITION` beyond that cannot be submitted. Measure before Output
(write the composed draft to a scratch file and `wc -c` for an exact count):

1. `GOAL_LENGTH` = UTF-8 byte count of the full composed `GOAL_CONDITION`.
2. `GOAL_LENGTH <= 4000` → `GOAL_MODE = full`; proceed to Output unmodified.
3. `GOAL_LENGTH > 4000` → `GOAL_MODE = blocked`. In Output emit Block A only
   (its `Goal length` row reports the measured length), then the hard-stop
   notice — do **not** print Block B, C, or C2.

There is a single (full) template variant. It targets a normal composed goal of
at most 3,400 UTF-8 bytes, leaving a 600-byte reserve below the hard cap for
bounded variable gate tokens. The blocked branch is a should-never-fire
template regression: if it fires, fix the template or gate fixture — never
trim required safety or verification clauses from the condition.

**Completion criterion:** `GOAL_LENGTH` is measured in UTF-8 bytes and
`GOAL_MODE` is exactly `full` or `blocked`; blocked mode emits no actionable
`/goal` command.

## Output

Read `references/output-blocks.md` and emit its Block A, B, C, and C2 contract
verbatim after substituting the analyzer and gate values. The output is either a
diagnostic hard stop or a complete paste-and-monitor package; it is never a
partially actionable goal. When `DRY_RUN=false`, append the `THIS SESSION` block
defined by that reference; when `DRY_RUN=true`, stop after the C2 monitor.

**Completion criterion:** blocked mode contains only Block A plus the hard-stop
notice; full mode contains Block A, the single-paste Block B, and the required
Block C/C2 material from `output-blocks.md`, with `--dry-run` ending after C2.

## Verification

- [ ] Analyzer run first; `STATUS` handled — `missing`/`archived`/`error`/exit-2 all stop with the script's message; only `active` proceeds
- [ ] Block A shows correct task counts (from the schema block), detected runners, and manual-task count
- [ ] Block B `/goal` string is entirely in English and opens with the Part 0 opsx:apply kickoff sentence before the stop conditions — single paste, no separate STEP 3
- [ ] Part 0 carries the selector-resolved `<FAST_WORKER_CLAUSE>` (including CLI tier and fallback order), ONE consolidated reviewer batch wording, ≤200-byte `<TASK_DIGEST>`, and `<E2E_ROSTER_CLAUSE>` iff `HAS_E2E=true`; the orientation command does not preview tasks.md
- [ ] Part 0 does NOT restate the relocated elaborations (dispatch-verify procedure, premise-verification routing, in-flight doubt cycle, CODEX high-stakes-peer triggers, session-end self-check) — those are present in `rules/execution-policy.md` (§Implementation dispatch, §In-flight doubt cycle, §CODEX=on high-stakes parallel peer path) and bind via the orientation read
- [ ] CODEX statement stated explicitly on one line (`CODEX is ON`/`OFF` per `--codex`); when ON, it points at the execution-policy CODEX sections (including the session-end zero-dispatch self-check) without enumerating the trigger list
- [ ] Part 0 says "without stopping for confirmation" covers ordinary implementation judgment calls only and never an explicit project hard-rule conflict
- [ ] Part 2 uses `ls .claude/artifacts/sessions/.pending-*` (not reviewer names); Part 2b checks `.unresolved-verdict` and requires `NONE`
- [ ] Non-automatable tasks appear in the Block A warning, NOT in Part 3
- [ ] Part 3 emits build/lint lines only when detected; a coverage gate when `HAS_COVERAGE=true` OR `--min-coverage N` set (with `HAS_TEST=true`); the smoke line iff `HAS_SMOKE=true`
- [ ] `--no-smoke` suppresses the smoke line regardless of signal; Block A `Smoke gate` row is exactly one of `on (signal)` / `on (--smoke)` / `off (--no-smoke)` / `off (no strong signal, hint emitted)`
- [ ] `--max-duration` set → Part 4 has the wall-clock line; absent → no such line. Part 4 writes `openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md` with rule, conflicting decision with file:line evidence, and why compliance is blocked, then ends the turn, and writes `.resume-note.md` items (1)(2)(3) on stop
- [ ] Block A `Goal length` row present, reporting the measured UTF-8-byte length and `full` / `⚠ BLOCKED` matching `GOAL_MODE`; a >4000-byte measurement hard-stops (should-never-fire template regression) — no unsafe gate-deleting substitution exists
- [ ] `GOAL_MODE = blocked` suppresses Block B/C/C2 and prints the hard-stop notice with all four adjustment bullets instead
- [ ] Block C2 monitor snippet is read-only (grep + ls only); `--dry-run` stops after it (no "THIS SESSION" block)
