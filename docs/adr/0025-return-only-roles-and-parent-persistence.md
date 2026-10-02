# Return-only roles and parent persistence

Status: accepted design; implementation pending

Return-only Roles (reviewer, reasoner, and planner Roles, and agents such
as the architect, that have no declared working-tree write grant) return
their deliverable to the parent and never save it themselves. When a contract needs a saved record, an authorized parent saves
the returned Review Result verbatim, together with a hash of the returned text,
and the save is checked against that text. A failed or mismatched save leaves
the result unresolved; it is never a pass. The user decided this on 2026-10-02
for every Host, through the local OpenSpec change
`prepare-marketplace-workflow-plugin` (tasks 4.6 and 4.7).

Reviewers used to write their own artifacts. No reviewer agent has a Write
tool, and Codex runs them in a read-only sandbox, so that rule contradicted
their declared permissions, and the Codex generator added a review-write duty
even to roles that promise no artifact. The existing review evidence checks
validate path, hash, identity, and verdict, not authorship, so moving the write
to the parent keeps the current path and hash checks; the Review Result gains
reviewer-run and implementer identities so Self-Review is detectable.

## Considered options

- Child writes its own artifact (status quo): contradicts read-only grants on
  every Host.
- Change only the Codex projection: leaves one Role with different output
  contracts per Host, against role parity.
- Parent records only the verdict: cannot show that the saved verdict is the
  one the reviewer returned.

## Consequences

- A Return-only Role that tries to save its own deliverable makes an
  Authority Attempt (see `CONTEXT.md`), whether or not the Host allows it.
- Each Review Result is bound to the reviewed tree, reviewer Role, reviewer run
  identity, implementer identity, and contract version, so stale results and
  Self-Review are detectable.
- Canonical role text, contract documents, the Codex generator, and every
  generated projection change together; generated copies are regenerated, not
  edited by hand.
- Where the deliverable is stored (for example a plan or ADR) is decided by the
  calling flow, not by the role contract.
