# Flow and usage ownership

Status: accepted

## Context

The 0.53 consolidation left two kinds of discovery mixed together. Workflow
guidance, route selection, and implementation were exposed through overlapping
Flow modes, while Codex users had to inspect full skill procedures to learn a
skill's arguments. The remaining Laravel, PHPUnit, and harness predecessors
also made the public catalogue larger than the capability surface they
actually provided.

The repository now has 65 active canonical skills, nine portable families, and
one standalone commit owner. A consumer needs a small, stable way to discover
the public grammar without receiving the target procedure or its authority.

## Decision

Use these ownership boundaries:

- `flow-guide` owns read-only `help`, `route`, `rules`, `next`, and `close`.
  `help` reads the generated inventory usage catalogue or one usage card;
  `route --go` may only hand off one available implicit-eligible target.
- `flow-drive` is explicit-only and mode-free. It accepts only a confirmed
  specification or OpenSpec change for implementation. Proposal authoring is
  owned by the external `$openspec-propose` skill.
- The inventory `usage` object is the sole public grammar source for Codex
  syntax, actions, options, input kind, authority, and examples. Generated
  `agents/openai.yaml` metadata remains limited to its supported interface
  fields and derives its prompt from the same identity.
- `git-smart-commit` keeps its existing public name and stable ID. `agy-commit`
  is retired as a duplicate backend-specific entry; AGY remains an explicit
  worker option where the commit owner supports it.
- Laravel and PHPUnit retain their stable IDs while their public names become
  `laravel` and `phpunit`. Version-specific notes are selectors, not separate
  discovery skills. The five harness predecessors become modes of
  `harness-govern`: `health`, `budget`, `fill`, `revise`, and `sync`.
- OnePassword session setup is an operator action (`op signin`), not a
  rediscoverable dhpk skill. Credentials and interactive authentication remain
  outside generated projections and documentation examples.

The inventory and generated projections remain the lifecycle and publication
SSOT. Documentation explains how to reach that contract but does not create
aliases or add skills to the catalogue.

## Consequences

- `$flow-guide help` lists available Codex-invokable names; `$flow-guide help
  <skill>` reveals one concise usage card. Users can discover parameters
  without loading procedure references.
- Nine family entries are easier to recognize: six existing task families
  plus `laravel`, `phpunit`, and `harness-govern`. Stable IDs and retirement
  rows preserve migration diagnostics without preserving aliases.
- `flow-guide` can advise without acquiring write authority, and
  `flow-drive` cannot be mistaken for a classifier or proposal author.
- Generated catalogue drift is a build failure. A local help card, static
  metadata check, or package generation result does not prove runtime or
  release support.

## Migration and rollback

The 0.54 migration is alias-free. The 21 new predecessor rows point to a
family selector, `git-smart-commit`, `$openspec-propose`, or the `op signin`
operator action and roll back to 0.53.0. Existing 0.47.0, 0.52.0, and 0.53.0
ledger sections remain historical. Rollback means pinning and reinstalling the
prior release through its ownership-aware installation path; it does not mean
recreating a retired package in the current release.

## Related decisions

- [ADR-0009 — Distribution projection and orchestration ownership](0009-distribution-projection-and-orchestration-ownership.md)
- [OpenSpec authoring handoff](../agent-guidance/openspec-authoring.md)
- [Feasibility comparison handoff](../agent-guidance/feasibility-comparison.md)
- [Skill platform migration](../skill-platform-migration.md)
