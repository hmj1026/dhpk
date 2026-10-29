---
name: code-simplify
argument-hint: '[<target>]'
description: 'Use when cleaning changed code for reuse, simplicity, efficiency, and the right abstraction level without changing behavior. Not for correctness review, broad redesign, or unbounded cleanup. Output: four-angle findings, applied/skipped changes, and baseline/final test evidence.'
allowed-tools: 'Read, Grep, Glob, Edit, Bash'
metadata:
  dhpk-capability-id: dhpk.skill.code-simplify
  dhpk-name-style: portable-skill
  dhpk-invocation-class: implicit-eligible
  dhpk-next: "{\"PASS\":\"none\",\"FAIL\":\"none\",\"BLOCKED\":\"none\",\"NOT_RUN\":\"none\",\"UNAVAILABLE\":\"none\"}"
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
3. **Review four angles.** The current Host and Model review all four angles
   directly in one pass as the standard path. When requested and supported by
   the Host, optional read-only subagents may review separate angles. Complete
   missing angles inline and record any angle that remains unreviewed. Each
   finding records `file`, `line`, a one-line summary, and its concrete cost.

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
   process. Work in small, evidence-backed batches within the current scope;
   defer out-of-scope design decisions with a concrete handoff to the caller.
6. **Close the loop.** Run the exact baseline test command again. A failing
   final test leaves the task incomplete and the result `BLOCKED`; do not claim
   the cleanup is safe.

## Output

Use the following report and record the actual execution mode:

```markdown
## Refactoring Summary

Execution Mode: current Host/Model single-pass | optional fan-out | mixed

### Applied

- [file:line] <summary> — Cost: <concrete cost> — Fix: <change>

### Skipped

- [file:line] <summary> — Reason: <behavior change | out of scope | false positive>

## Test Results

- Baseline: PASS/FAIL — `<command>`
- Final: PASS/FAIL/NOT_RUN — `<same command>`
```

Record the reviewed angles and any missing evidence. Single-pass execution is
standard; optional fan-out supplies independent observations when used.
Return control to the caller after delivering findings and verification.

## Verification

- [ ] Scope resolution and fallback order are recorded; invalid explicit input
      did not silently become the current branch.
- [ ] Baseline and final use the exact same test command, with failures and
      accepted known failures stated explicitly.
- [ ] Reuse, Simplification, Efficiency, and Altitude were each reviewed, or
      each missing angle is named in incomplete evidence.
- [ ] Every applied change is behavior-preserving and in scope; every skipped
      finding has a reason.
- [ ] Heavy cleanup has a documented bounded process and deferred work is
      handed back to the caller.

## References

- `references/refactor-contract.md` — finding, execution, heavy-cleanup, and
  handoff details used when the inline workflow needs the extended contract.
- Native `git`, `gh`, `rg`, file reads, and the repository’s test command are
  the portable scope and verification tools.
