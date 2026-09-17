---
description: 'Clean up the changed code for reuse, simplicity, efficiency, and altitude without changing behavior.'
argument-hint: '[<PR|branch|file|directory>]'
allowed-tools: 'Read, Grep, Glob, Edit, Agent, Bash'
metadata:
  dhpk-invocation-class: implicit-eligible
---

## Scope

An explicit `$ARGUMENTS` target overrides automatic diff discovery. Accept a
pull request, branch, file, or directory and restrict the review to that target.

Without an explicit target, gather the current change:

1. Try `git diff @{upstream}...HEAD`.
2. If that ref cannot be resolved, try `git diff main...HEAD`.
3. If neither range resolves, use `git diff HEAD~1`.
4. If the worktree has uncommitted changes or the range diff is empty, also
   include `git diff HEAD` so pre-commit cleanup is not missed.

Stop with “nothing to simplify” when the resolved scope contains no changes.

## Baseline

Resolve and run the repository's relevant test command before editing. Record
the command and result so the same command can be run after cleanup. Stop when
the baseline fails unless the user explicitly accepts that known failure.

## Review — four cleanup agents

This is a quality pass, not a correctness review. Use
`/dhpk:change-verdict --mode code` for bugs.

Launch **4 independent read-only `Explore` agents** through `Agent` in a single
Agent call so they run concurrently. Give every agent the same resolved diff
and relevant files, plus exactly one angle below. Each finding must contain
`file`, `line`, a one-line `summary`, and the concrete cost: what is duplicated,
wasted, retained, or harder to maintain.

### Reuse

Find new code that reimplements an existing helper or pattern. Search shared
utilities and files adjacent to the change, then name the existing helper to
call instead.

### Simplification

Find redundant or derivable state, copy-paste with slight variation, deep
nesting, and dead code left behind. Name the simpler form that preserves the
same behavior.

### Efficiency

Find redundant computation or repeated I/O, independent operations performed
sequentially, and blocking work added to startup or hot paths. Flag long-lived
objects built from closures or captured environments that retain an enclosing
scope; name the cheaper alternative.

### Altitude

Check whether the change addresses the root cause at the right depth. Flag
special cases layered onto shared infrastructure or symptom patches, and name
the deeper general change.

## Degraded review

When `Agent` is unavailable, the current agent is nested and cannot spawn, or
an individual reviewer fails, complete all four angles yourself in the current
context. Preserve successful agent results and run only missing angles inline
after a partial failure.

The final summary must begin with `degraded:` and state whether the result was
a single-pass review or a mixed review. For a fully inline review, say clearly
that it was a single-pass review, not the full 4-agent fan-out.

## Apply

Wait for every angle, then dedup findings that point at the same line or
mechanism. Apply each remaining finding directly. Skip a finding when its fix
would change intended behavior, require changes well outside the reviewed
scope, or is a false positive. Note each skip without arguing with it.

Run the exact baseline test command again after the cleanup. A failing final
test leaves the command incomplete; report the failure and do not claim the
refactor is safe.

## Delegate (large-scale cleanup)

This command refactors in place within the resolved scope. For heavier cleanup
that spans the codebase, dispatch the `refactor-cleaner` agent
(`subagent_type: dhpk:refactor-cleaner`) instead of inlining:

- a file exceeds **800 lines** and needs splitting
- **cross-file** duplicate logic must be consolidated
- a **dead-code sweep** across multiple modules (unused exports / functions / imports)

The agent owns `gitnexus_impact` / `rename`, deletion proof, dynamic-dispatch
and public-API keep rules, deprecation paths, and small-batch verification.
Relay its summary back.

## Output

```markdown
## Refactoring Summary

Execution Mode: 4-agent fan-out | degraded: single-pass | degraded: mixed

### Applied

- [file:line] <summary> — Cost: <concrete cost> — Fix: <change>

### Skipped

- [file:line] <summary> — Reason: <behavior change | out of scope | false positive>

## Test Results

- Baseline: PASS/FAIL — `<command>`
- Final: PASS/FAIL — `<same command>`
```

## Constraints

- Preserve intended behavior.
- Keep fixes within the reviewed scope.
