---
name: spec-mine
description: "Use when extracting one capability’s behavioral baseline from a brownfield codebase into openspec/specs/<capability>/spec.md. Not for mining every module, refactoring, or applying a change. Output: the spec path, capability, Last verified commit, deferred files, or UNAVAILABLE when the required spec-miner role is not registered."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Behavioral spec mining

Extract one capability’s existing behavior into the OpenSpec baseline. `$ARGUMENTS`
is an optional capability name or path to mine first. The deliverable is only
`openspec/specs/<capability>/spec.md`; this skill does not mine inline.

## When NOT to Use

- A change delta must be designed or applied: use the relevant OpenSpec
  authoring or implementation workflow.
- The request is a broad architecture review, refactor, or test-generation
  pass.
- More than one capability is requested at once: ask which capability to mine
  first so the baseline stays reviewable.

## Workflow

1. **Pre-flight.** Run a native read-only check equivalent to
   `ls openspec/specs 2>/dev/null`. Confirm this is (or should become) an
   OpenSpec project. If `openspec/` is absent, ask before creating it. Never
   scatter specs outside `openspec/specs/`.
2. **Dispatch the required role.** Use the host’s registered role-dispatch
   mechanism for the exact `spec-miner` role, passing `$ARGUMENTS` unchanged.
   The role owns the sampling budget, metadata rules, and flat
   Requirement/Invariant output. Do not silently substitute another role,
   model, or reasoning level. If the role registry is unavailable or does not
   expose `spec-miner`, stop with `UNAVAILABLE`; do not mine inline.
3. **Relay evidence.** Return the role’s written
   `openspec/specs/<capability>/spec.md` path, capability name, `Last verified`
   commit stamp, and every `<!-- deferred: ... -->` file list. Keep unavailable,
   failed, partial, and completed states distinct.

## Output

```markdown
## Spec Mining Result

- Status: COMPLETE | UNAVAILABLE | BLOCKED
- Capability: <name or unresolved>
- Spec: openspec/specs/<capability>/spec.md | not written
- Last verified: <date and commit hash, or unavailable>
- Deferred: <files or none>
- Reason / next action: <exact handoff>
```

`UNAVAILABLE` means the required registered role cannot be reached; it is not a
successful spec extraction and must not be relabeled as one. A missing
OpenSpec project is `BLOCKED` pending the user’s decision.

## Verification

- [ ] `openspec/` presence and the pre-flight result are recorded.
- [ ] The exact `spec-miner` role was registered and received unchanged input,
      or `UNAVAILABLE` was reported without substitution.
- [ ] The artifact path is exactly
      `openspec/specs/<capability>/spec.md` when complete.
- [ ] Capability, `Last verified` commit, deferred files, and role status are
      relayed without claiming unobserved writes.
- [ ] No `.claude/artifacts/` report or unrelated file was created by this
      workflow.

## References

- `references/spec-miner-contract.md` — portable role contract and artifact
  format; load it when validating a delegated result or an unavailable state.
- Native `ls`, `rg`, and file reads are sufficient for pre-flight; the required
  role owns code exploration and the only permitted artifact write.
