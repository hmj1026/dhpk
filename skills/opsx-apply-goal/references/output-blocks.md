# opsx-apply-goal — Step 7 emit catalog (Block C NOTES, hard-stop notice, monitor)

Used by Step 7 of the `opsx-apply-goal` skill. SKILL.md keeps the Block A box
skeleton and the Block B `/goal` framing inline (they are the core emit
contract); this file holds the longer literal bodies: the Block C NOTES catalog,
the hard-stop notice, and the Block C2 monitor snippet. Print these verbatim.

---

## Block C — Reminders (NOTES)

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
• Goal length capped at 4,000 UTF-8 bytes (the unit `wc -c` measures; Claude
  Code's practical /goal paste limit, see Step 6b): the normal target is 3,400
  bytes — check the Block A "Goal length" row; a measurement over the cap is a
  should-never-fire template regression: no /goal is emitted and Block A's
  hard-stop notice reports the measured length and lists which setting or flag
  to adjust and re-run
```

If `HAS_COVERAGE=false` AND `MIN_COVERAGE` is unset AND `HAS_TEST=true`, append one NOTES line:

```
• Coverage gate OFF (no coverage threshold configured) — new-code coverage is
  NOT gated; author tests via feature-dev / tdd-guide, add a native coverage
  threshold (jest coverageThreshold / phpunit <coverage> min / pytest
  --cov-fail-under), or pass --min-coverage N to opsx-apply-goal to force it this run
```

---

## Hard-stop notice (`GOAL_MODE = blocked`)

When `GOAL_MODE = blocked`, print this instead of Block B/C/C2 and end the
skill's output:

```
✖ Goal condition is <GOAL_LENGTH> UTF-8 bytes — <GOAL_LENGTH - 4000> over the
  4,000-byte paste limit. This should never fire with the bounded Part 0
  (the normal target is <=3,400 bytes) — treat it as a template
  regression to fix, or adjust and re-run:
  • turn off the orchestration_dispatch project setting (removes the dispatch directive, the largest single block)
  • drop --codex (removes the CODEX statement)
  • drop --smoke / pass --no-smoke (removes the smoke-gate line)
  • fewer verification gates detected → consider splitting into smaller changes
No /goal command was emitted this run.
```

---

## Block C2 — Monitor (always printed unless blocked; read-only)

A snippet the operator can paste into a **second terminal** to watch progress
without touching the running session. Pure reads, no side effects:

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
