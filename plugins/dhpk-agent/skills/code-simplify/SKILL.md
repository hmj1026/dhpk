---
name: code-simplify
description: "Use when cleaning changed code for reuse, simplicity, efficiency, and the right abstraction level without changing behavior. Not for correctness review, broad redesign, or unbounded cleanup. Output: four-angle findings, applied/skipped changes, and baseline/final test evidence with degraded status when needed."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Code simplification

This is a behavior-preserving quality pass over the resolved change scope.
Use `$ARGUMENTS` when a target is explicit; otherwise review the current
change. Keep fixes inside that scope and leave correctness verdicts to a
read-only review workflow such as `$change-verdict --mode code`.

## When NOT to Use

- A bug, security issue, or correctness concern needs judging: use the relevant
  review or diagnosis workflow first.
- The requested change is a feature or architecture redesign rather than a
  cleanup of existing changes.
- The target cannot be resolved, has no changes, or its baseline test fails
  without explicit acceptance of that known failure.

## Workflow

1. **Resolve the scope.** An explicit target always wins:
   - Existing file/directory: review its full contents and run
     `git diff HEAD -- "$ARGUMENTS"`; keep the path quoted after `--`.
   - Pull request number, URL, or `#number`: verify it and gather
     `gh pr diff "$ARGUMENTS"`.
   - Branch or commit ref: verify it, identify its upstream or repository
     default branch, compute `git merge-base <target> <base>`, then gather the
     target diff with `git diff <merge-base>...<target>`.
   - Anything else is `BLOCKED`; never fall back to the current branch for an
     invalid explicit target.

   Without an explicit target, try `git diff @{upstream}...HEAD`, then
   `git diff main...HEAD`, then `git diff HEAD~1`. If the worktree is dirty or
   the range is empty, also include `git diff HEAD`. Stop with `nothing to
   simplify` when the resolved scope has no changes.
2. **Establish the baseline.** Resolve the repository’s relevant test command,
   run it before editing, and record the exact command and result. Stop when it
   fails unless the caller explicitly accepts that known failure.
3. **Review four angles.** If the host can fan out registered read-only
   workers, dispatch four independent workers concurrently with the same scope
   and exactly one angle each. If fan-out is unavailable, the current worker is
   nested, or one reviewer fails, perform only the missing angles inline and
   mark the result degraded. Each finding records `file`, `line`, a one-line
   summary, and its concrete cost.

   | Angle | Look for |
   | --- | --- |
   | Reuse | New code reimplementing an existing helper or pattern |
   | Simplification | Derivable state, copy-paste variation, deep nesting, dead code |
   | Efficiency | Repeated computation/I/O, sequential independent work, retained closures |
   | Altitude | Symptom patches or special cases where shared infrastructure is the root fix |

4. **Apply safely.** Deduplicate findings at the same line or mechanism. Apply
   only behavior-preserving findings inside the resolved scope. Skip findings
   that change intended behavior, require out-of-scope files, or are false
   positives, and record each reason.
5. **Handle heavy cleanup explicitly.** A file over 800 lines, cross-file
   deduplication, or a multi-module dead-code sweep needs a documented scoped
   process. If registered `worker` or `architect` roles are available, map the
   escalation to those roles (worker for bounded edits, architect for
   cross-module design). Otherwise perform only small, evidence-backed batches
   in the current scope and defer the rest with a concrete handoff. Never
   substitute an unregistered role or claim that a delegated cleanup ran.
6. **Close the loop.** Run the exact baseline test command again. A failing
   final test leaves the task incomplete and the result `BLOCKED`; do not claim
   the cleanup is safe.

## Output

Use the following report and state whether the review was a full fan-out, a
mixed degradation, or a single-pass fallback:

```markdown
## Refactoring Summary

Execution Mode: 4-agent fan-out | degraded: single-pass | degraded: mixed

### Applied

- [file:line] <summary> — Cost: <concrete cost> — Fix: <change>

### Skipped

- [file:line] <summary> — Reason: <behavior change | out of scope | false positive>

## Test Results

- Baseline: PASS/FAIL — `<command>`
- Final: PASS/FAIL/NOT_RUN — `<same command>`
```

For a wholly inline review, say clearly that it was a single-pass review, not
the four-worker fan-out. Keep successful angle results when only one reviewer
fails.

## Verification

- [ ] Scope resolution and fallback order are recorded; invalid explicit input
      did not silently become the current branch.
- [ ] Baseline and final use the exact same test command, with failures and
      accepted known failures stated explicitly.
- [ ] Reuse, Simplification, Efficiency, and Altitude were each reviewed, or
      each missing angle is named in degraded evidence.
- [ ] Every applied change is behavior-preserving and in scope; every skipped
      finding has a reason.
- [ ] Heavy cleanup has a worker/architect handoff or a documented scoped
      fallback and deferred work; no unregistered role is claimed.

## References

- `references/refactor-contract.md` — finding, degradation, heavy-cleanup, and
  handoff details used when the inline workflow needs the extended contract.
- Native `git`, `gh`, `rg`, file reads, and the repository’s test command are
  the portable scope and verification tools.
