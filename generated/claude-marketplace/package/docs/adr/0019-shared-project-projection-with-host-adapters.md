# Shared project projection with Host adapters

Status: accepted

The project-local `.agents/skills` tree is a generated Shared Project Projection, not a universal native configuration root. One compiler plan and one Projection Receipt own the portable skill content; Claude, Codex, Cursor, and AGY integrate through Host Adapters that may render different physical shapes while preserving the same stable IDs, source fingerprints, and ownership boundary.

## Decision

- `portable-core` is an explicit, evidence-gated allowlist. It is not inferred by unioning Host inventories and is not an implicit expansion of the Claude-oriented `minimal` profile.
- `.agents/.dhpk-installed.json` is the sole lifecycle authority. A legacy `.agents/skills/.dhpk-projection.json` may remain as a generated manifest or compatibility input, but it cannot independently own updates or removal.
- AGY direct-file output is self-contained by default. A sibling-package reference is allowed only after a passing consumer probe; a pointer into the source checkout is never a supported runtime contract.
- Host-native agents, rules, commands, hooks, MCP, and policy remain under their existing native projections. Removing one Host binding cannot remove shared content still used by another binding.
- Lifecycle candidate classification is separate from command outcome. `legacy-unbound`, foreign checkout, modified managed content, and empty/incidental paths are observed states; update and removal fail closed when ownership is not proven.
- Structural/package validation and Consumer Evidence remain separate. Missing or failed probes are reported per Host and do not invalidate unrelated projections, but they cannot be promoted to runtime support.

## Consequences

The same canonical skill selection can serve multiple Providers without creating a second authored catalog. Generated AGY files may duplicate portable body content, and migration requires explicit adoption for legacy receipts, but updates, rollback, foreign-content preservation, and support claims remain attributable to one plan and one owner.

This decision refines the compiler-centered projection boundary in [ADR-0009](0009-distribution-projection-and-orchestration-ownership.md) and preserves the support tiers and Claude-first ownership policy in [ADR-0003](0003-curate-dhpk-distribution-surfaces.md).

## Terminology

- **Provider** is the execution backend or model service selected by a Host;
  it remains a separate field from the client surface.
- **Host** is a client integration surface such as Claude, Codex, Cursor, or
  AGY. A **Host Adapter** is its generated integration and does not own a
  second authored skill catalog.
- **Consumer Evidence** is the observed discovery or runtime result for an
  adapter. Static structure and package validation do not imply runtime
  support.
- **AGY** is the repository's short name for the Antigravity client surface.
