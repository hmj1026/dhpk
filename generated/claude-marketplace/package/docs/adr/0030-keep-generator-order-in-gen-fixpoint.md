# Keep generator order in gen-fixpoint

Status: accepted

## Context

The in-checkout generators (`sync-skill-resources`, supporting-asset digest
refresh, `catalog`, `gen-skill-usage`, `gen-cursor-sync`, `gen-codex-agents`,
`gen-claude-manifest`, `gen-claude-marketplace-package`) run in a fixed order
in `scripts/ci/gen-fixpoint.js`, repeated until a pass changes nothing. An
architecture review on 2026-11-01 proposed replacing this with generators that
declare their inputs and outputs so a module computes the order, on the
assumption that the inventory digests and the managed skill-resource copies
form a cycle.

A measurement on a throwaway worktree disproved the assumption. Five single
edits (a supporting-asset source, a managed-copy source, `skill-usage.js`, a
`SKILL.md` description, an agent file) each converged in one changing pass
plus one confirming pass. No later generator writes bytes that an earlier one
reads. `sync-skill-resources` reads only skill identity from the inventory,
never its digests. The only real ordering constraint is that supporting
digests are refreshed before `gen-skill-usage`, which hashes the whole
inventory; the current order satisfies it.

## Decision

Keep the ordered list and the convergence loop in `gen-fixpoint`. Do not
introduce declared generator dependencies or a computed generation graph.

## Consequences

- The "refresh after X" commits that preceded `gen-fixpoint` were caused by
  generators being run by hand, not by a cycle; running `gen-fixpoint` before
  commit is the fix.
- A future generator that reads another generator's output must be placed
  after it in the list. If a change ever needs more than two passes to
  converge, that is the signal to revisit this decision.
- Distribution packages under `plugins/` remain outside `gen-fixpoint`
  because they need a clean checkout.

## Related decisions

- [ADR-0009 — Distribution projection and orchestration ownership](0009-distribution-projection-and-orchestration-ownership.md)
