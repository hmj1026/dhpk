# Canonical skill disposition

Use this page to resolve current skill disposition ownership.

- `manifests/distribution-inventory.json` owns stable identity, active discovery,
  surfaces, successors, migration, and rollback facts.
- [Skill platform migration](../skill-platform-migration.md) owns retirement,
  successor modes, direct-host invocation, and version-pin rollback.
- [Writing for agents](writing-for-agents.md) owns the shared authoring contract.

The former 102/103-package disposition table was a historical disposition
snapshot, not a live route registry. Its full development record is retained
locally at `docs/evidence/skill-disposition.md`. Baseline Keep or Merge-pointer
labels do not override the current inventory or migration ledger. Retired
identities do not become discovery aliases.

Generated projections are produced by catalog/projection generators; they are
not canonical disposition rows.
