# Native Flow Drive and shared CLI dispatch support

Status: accepted

## Context

Flow Drive's portable skill directory previously owned a CLI invocation
parser, task runner, dispatch wrapper, execution lifecycle, and shared adapter
files used by other native roles. That coupled ordinary task completion to a
second execution engine and made copying one skill depend on bundled harness
resources. The suite still has delegated Codex and AGY roles that require the
shared transport and adapter behavior.

## Decision

Flow Drive is an explicit task/help instruction entry. It accepts one bounded
task, task-file, or confirmed specification/change input and read-only
`--help`, then uses the current Host and Model. Its source directory contains
only the skill instructions, supported Host metadata, distribution declaration,
and migration reference. It owns no parser, external runner, Flow Drive
dispatch API, or execution receipt.

Shared CLI-dispatch transport, adapter, context, and handoff support is owned
outside the skill under `scripts/cli-dispatch/`. Native agent package
generators include that support closure when the projected native agents need
it. Flow Guide may carry generated policy copies that its own retained
delegated-work guidance requires. Neither package creates a second authored
source.

Removed Flow Drive options and programmatic interfaces are listed in the
skill's migration reference, which points to pinned `v0.66.7`. The current
release does not maintain a compatibility execution engine, and its migration
does not claim to resolve defects in the older parser or runner.

## Consequences

- A consumer can copy the complete Flow Drive directory without building dhpk,
  synchronizing resources, resolving a sibling skill, or accessing a dhpk
  checkout.
- The Host instructions own task scope, authorization, consumer conventions,
  observed verification, and precise blocker reporting.
- Other supported delegated routes retain current Host capability and grant
  checks; moving shared files does not weaken authorization or transport
  behavior.
- The distribution inventory, package generators, agent consumers, and
  resource ledgers describe the shared support owner rather than Flow Drive.
- Flow Drive's task completion is terminal and does not require a sibling
  public skill as a follow-on.

## Related decisions

- [ADR-0009 — Distribution projection and orchestration ownership](0009-distribution-projection-and-orchestration-ownership.md)
- [ADR-0010 — Flow and usage ownership](0010-flow-and-usage-ownership.md)
- [ADR-0027 — Codex external dispatch boundary](0027-codex-external-dispatch-boundary.md)
- [ADR-0028 — Public workflow, method, and Project Convention](0028-public-workflow-method-and-project-convention.md)
- [Flow Drive migration reference](../../skills/flow-drive/references/migration.md)
