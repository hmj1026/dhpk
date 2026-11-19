# Delivery core

Load this reference after a feature or bug route is selected. It is the shared
implementation contract; route-specific design or investigation remains in the
calling skill.

1. Read the execution kernel, then load only the selected implementation and
   review references. Use the canonical execution policy's context-tier section
   to choose `cold`, `bounded`, or justified `full` inheritance.
2. For a cold handoff, send the five-part packet defined by the worker role:
   goal/non-goals, owned files, settled constraints, verification/acceptance,
   and task/attempt identity with evidence pointers.
3. Keep the change uncommitted; `/precommit` is a quality gate, not permission
   to commit.
4. Verify the scoped result, dispatch the recommended reviewers, and report
   unavailable checks and unfixed CRITICAL findings as blockers.

**Completion criterion:** the route has one selected implementation path,
scoped verification evidence, and no unfixed CRITICAL reviewer finding.
