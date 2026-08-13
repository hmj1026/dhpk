## Context

PR #177 merged the context-budget reduction and currently reports 133 discovery-visible entries, 45 optional entries, and zero violations. The checked-in inventory already contains `skill_routing_families`, selectors, aliases, and projection metadata, while the old active task residue is incomplete and cannot be validated as a change. The implementation must finish the routing behavior without creating a second manifest or changing the public skill IDs.

## Decisions

### Inventory-owned normalized routing contract

`manifests/distribution-inventory.json` remains the only policy source. `scripts/lib/distribution-inventory.js` validates family IDs, router IDs, selectors, safe repository-relative reference paths, alias uniqueness, invocation classes, surface membership, and one-to-one alias resolution. A new pure helper may normalize the validated family data, but it must accept the inventory object and return frozen deterministic data; it may not scan directories to infer policy.

The normalized family record is:

```text
{
  id, routerId, invocationClass, surfaces,
  selectors: { selector: safeReferencePath },
  aliases: [{ id, selector, invocationClass, surfaces }]
}
```

Selectors are exact strings. Laravel Mix is `mix`; Laravel majors are `5.4`, `6`, `7`, `8`, `9`, `10`, and `11`; PHPUnit selectors are `9`, `10`, and `11`. An alias must resolve to exactly one family and selector. Ambiguous, missing, unsafe, unsupported, or conflicting records fail closed.

### Progressive loading

The initial frontmatter description remains the routing contract: purpose, positive trigger, exclusion/boundary, expected output, and safety/authorization cue. `resolveSkillRoutingReference` returns only the selected reference path after an explicit selector or a caller-provided version constraint. It never loads sibling reference bodies and never treats optional discovery visibility as runtime activation.

### Projection parity

Claude and Codex projection generators consume the same normalized family/alias view. A pure parity report compares sorted stable IDs, public names, family/router IDs, selector targets, invocation classes, surfaces, discovery budgets, and canonical source fingerprints. Repeated generation from unchanged inputs must produce byte-identical canonical JSON. Existing client-specific transformations remain explicit and do not become a second alias list.

### React/Next and runtime evidence

React 18/19 and Next.js 15.5/16 remain separate entries and mappings. A regression test fails if any ID or source mapping is merged or removed. Runtime probes use the existing closed vocabulary (`PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, `UNAVAILABLE`); static parity is not runtime evidence.

### OpenSpec delivery

The archived discovery delta is synchronized into `openspec/specs/skill-routing-guidance/spec.md` and a new `openspec/specs/skill-discovery-context-budget/spec.md`. Because `openspec/` is ignored, the delivery commit uses an explicit `git add -f` allowlist for the new change artifacts and these two canonical specs only.

## Dependency order

```text
SSOT spec sync
      │
      ▼
RED contract + normalized router ───────┐
      │                                  │
      ├── Laravel/PHPUnit references     │
      ├── progressive-loading tests      │
      └── React/Next guard               │
                                         ▼
                           Claude/Codex parity + repeat generation
                                         │
                                         ▼
                             full gates → review → PR/CI
```

Shared inventory and generated outputs have one writer and are reconciled only after independent workers finish.

## Rollback

Revert the feature branch or restore the previous inventory and canonical descriptions, regenerate projections, and rerun the pre-change context-budget and projection tests. Do not delete legacy source/reference paths. Runtime support claims remain unchanged if probes are unavailable.
