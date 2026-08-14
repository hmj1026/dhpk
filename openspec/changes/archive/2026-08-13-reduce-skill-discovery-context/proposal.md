## Why

The discovery-budget gate currently reports 18 surface violations across 15 unique skills, so always-visible descriptions consume more context than the publication contract allows. The release needs a single, testable discovery contract now: concise metadata for every surface, conditional loading for version-specific detail, and compatibility-preserving routes for existing callers.

## What Changes

- Add a `skill-discovery-context-budget` capability that defines initial-discovery word/token budgets, measures every publication surface, and fails strict validation unless all 15 violating skills are remediated and the report has zero violations.
- Add a shared Laravel version router for 5.4 through 11 plus Mix, with conditional version references; retain each legacy Laravel skill ID as a concise compatible alias that routes to the shared guidance.
- Add a shared PHPUnit version router for 9, 10, and 11 with conditional version references; retain each legacy PHPUnit skill ID as a concise compatible alias.
- Preserve progressive loading: always-visible metadata contains only routing, scope, and safety cues; version/framework mechanics remain conditional references loaded after selection.
- Require deterministic projection parity across Claude and Codex publication surfaces, including alias identity, metadata, and source fingerprints, with invocation tests for every retained legacy ID.
- Record evidence and a follow-up for React/Next consolidation; do not merge React or Next skills in this change.
- Preserve distinct audit, judge, stocktake, GitNexus, investigation, and review roles; no role is merged merely to reduce description size.
- **BREAKING** changes are not permitted: existing skill IDs, supported invocation forms, and publication-surface eligibility remain callable and stable.

## Capabilities

### New Capabilities

- `skill-discovery-context-budget`: Defines the discovery-visible metadata budget, progressive-loading boundary, version-router/alias contract, deterministic projection parity, and zero-violation verification gate.

### Modified Capabilities

- `skill-routing-guidance`: Requires concise canonical routing summaries, stable legacy aliases, conditional version references, and distinct role routing while preserving existing invocation identifiers.

## Impact

- Canonical skill metadata and conditional reference layout under `skills/`, plus the Laravel and PHPUnit module publication mappings.
- Distribution inventory and Claude/Codex projection generators, including metadata fingerprints and alias-resolution data.
- Context-budget, projection-parity, and invocation-compatibility validators/tests; strict CI must report zero violations across all declared surfaces.
- OpenSpec planning may complete before `harden-agent-architecture-governance`, but implementation is blocked until that change's inventory/plan contracts are implemented and verified.
- React/Next skill sources and publication mappings are evidence-only follow-up scope and are not changed by this capability.
