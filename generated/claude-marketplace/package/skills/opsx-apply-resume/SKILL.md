---
name: opsx-apply-resume
argument-hint: '[<change-id>]'
description: 'Save and resume a long-running OpenSpec apply session from a live worktree, preserving optional gates and host-specific handoff artifacts. Not for: starting a new proposal, changing the external OpenSpec workflow, or treating a commit as a prerequisite. Output: a saved/resumed handoff report with lifecycle and next-action evidence.'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# OpenSpec Apply Resume

`$opsx-apply-resume` is the explicit handoff capability behind
`/dhpk:opsx-apply-resume`. It snapshots enough live state to cross a context
boundary and restores it later; the live worktree remains the source of truth.
`$SKILL_DIR` denotes the physical directory containing the selected `SKILL.md`;
it is path notation, not an ambient environment variable or repository-root
lookup. Resolve it once before invoking a package-local helper and keep the
consumer's current working directory unchanged.

## When to Use

- An explicit invocation requests Save while a long-running apply session is
  approaching its context limit.
- An explicit invocation requests Resume after a context/session boundary.
- A previous handoff is in `saved` or `consuming` state and needs recovery.

## When NOT to Use

- Creating, designing, verifying, or archiving an OpenSpec change.
- Replacing the external `openspec-apply-change` Skill or modifying its files.
- Reverting, deleting, or stashing uncommitted work to make a handoff look
  clean.

## Host and package resolution

1. Detect the current Host from the native runtime; do not add a public host
   flag. Claude uses `.claude/artifacts/apply-resume/latest.md`; Codex uses
   `.dhpk/artifacts/apply-resume/latest.md`.
2. Resolve the handoff path once and pass it explicitly to every package-local
   helper and context loader. Resolve helper executors from
   `"$SKILL_DIR/scripts/"`; helpers must never rediscover a path from their
   current directory or a parent/peer Skill. A missing
   helper/reference is `BLOCKED_RESOURCE_MISSING`.
3. Load only [Save](references/save.md) or [Resume](references/resume.md)
   after phase detection. Keep optional providers undisclosed until their
   branch is selected.

## Workflow

1. Parse an optional `change-id`; priority is argument, latest visible apply
   invocation, then the Host's native selection prompt. If no change can be
   selected, stop `BLOCKED`.
2. Run the package-local phase detector with the explicit handoff path. A
   recent save is a confirmation boundary; `consuming` is a recovery boundary.
3. Follow exactly one phase reference. Save writes a new `latest.md`; Resume
   loads it, validates the change, and archives it only after successful
   continuation.
4. Keep optional commit, precommit, compact, and memory providers visibly
   optional. Their absence or failure never erases live files or invalidates a
   handoff summary.
5. Hand successful continuation to the available canonical
   `openspec-apply-change` Skill. Claude may use native Skill dispatch; Codex
   invokes the available projected skill directly. If it is unavailable,
   report `UNAVAILABLE` and keep the handoff recoverable; never edit the
   external skill or substitute `/opsx:apply` as a Skill ID.

## Host boundary

Claude may recommend `/fork`, `/new`, and `/model` in its save report. Codex
does not require or emit those Claude commands: its report names the next
session/turn and optional model metadata without changing models. Both Hosts
must preserve the same handoff frontmatter, phase states, optional-provider
semantics, and live-worktree rule.

## Output

Return:

```text
Host → Save | Resume → explicit handoff path → change-id
State → saved | consuming | consumed | BLOCKED | UNAVAILABLE | NOT_RUN
Evidence → commit/precommit/compact/memory/provider details
Next action → one recoverable Host-appropriate continuation
```

Include `commit: SKIPPED` when no explicit commit was requested; it is valid
evidence, not a failure. A failed apply leaves `latest.md` in `consuming`
state for manual recovery. Redact observation content, credentials, and
private paths beyond the declared artifact path.

## Verification

- [ ] Host path and explicit handoff path were resolved before helper calls.
- [ ] Exactly one phase ran and its state transition is recorded.
- [ ] Live worktree truth and uncommitted files were preserved.
- [ ] Optional provider states are distinct from required apply evidence.
- [ ] External OpenSpec continuation used an available canonical skill only;
      no external skill or alias was modified.
- [ ] The terminal state and one next action are explicit.

## References

- [references/save.md](references/save.md) — snapshot, optional gates, and
  handoff write contract.
- [references/resume.md](references/resume.md) — load, context fallback,
  consuming state, external continuation, and archive contract.
