# Revise mode

Revise trims and validates one existing `.claude/` or `.codex/` harness while
preserving trigger semantics. It is a diagnostic plan by default; a fix is an
approved, per-finding change.

## Invocation

```text
$harness-govern revise [--dir .claude|.codex] [--dry-run] [<approved fix scope>]
```

Resolve the directory with `harness-directory-contract.md`; never fall back to
an empty or alternate harness. The three scripts below receive the selected
directory explicitly.

## Procedure

1. Run `scripts/harness-inventory.sh --dir <HARNESS_DIR>`. Project-local hook
   execution is a separate approval: only then run
   `scripts/harness-scenarios.sh --dir <HARNESS_DIR> --execute-hooks` and
   `scripts/test-harness.sh --dir <HARNESS_DIR> --execute-hooks`. If a suite
   already fails, stop and report the pre-existing regression before proposing
   edits.
2. Compare the inventory with the stable G1-G13 taxonomy in the scripts and
   identify the smallest approved fixes. Read the relevant harness files
   before changing them; keep trigger and guard logic in its owning hook.
3. In `--dry-run`, report the ranked gap plan and exact paths without writes.
   Reject any harness root except the physical repository-local `.claude` or
   `.codex` directory; never follow a symlinked root.
   After approval, apply one fix at a time and rerun its matching deterministic
   check. Do not change product code or invent a new gap ID.
4. Run all three scripts again and compare baseline versus post-fix counts.
   Keep deferred, conflicting, and unavailable checks visible.

## Output contract

```markdown
Active Harness: <dir>; Main Rule: <path>
Baseline: inventory=<...>; scenarios=<PASS/FAIL>; tests=<PASS/FAIL>
Gap table: G1-G13 with severity, path, action
Fixes: planned / applied / manual / failed
Post-fix: exact commands, exit codes, and count deltas
Deferred: <items or none>
Gate: PASS / FAIL / BLOCKED / NOT_RUN
Next action: <one action>
```

`PASS` requires the selected baseline and final checks to satisfy their own
acceptance criteria. A baseline failure is `BLOCKED` or `FAIL`, never a clean
starting point. A report never claims that a reviewer, commit, or release ran.

## Completion

Revise is complete when the selected harness is identified, every baseline and
post-fix result is evidenced, each applied fix has a matching check, and all
deferred items have reasons. Read the directory contract and scripts only when
this mode is selected; do not load health, fill, budget, or sync procedures.
