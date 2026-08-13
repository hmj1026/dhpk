## Why

dhpk's distribution generators, validators, and orchestration controls have grown as separate surface-specific implementations, so ownership boundaries and evidence semantics are implicit and increasingly easy to drift. We need an explicit architecture contract now so new platform projections and agent lifecycle changes can evolve without breaking existing consumers or weakening review enforcement.

## What Changes

- Introduce a contract-first distribution projection pipeline that separates deterministic planning, filesystem materialization, and consumer-specific verification behind `DistributionCompiler`, `ProjectionArtifactStore`, and adapter interfaces.
- Make the distribution inventory the sole selection and projection-policy source, including an explicit symlink policy and stable provenance for every materialized artifact.
- Preserve all current generated output and CLI behavior through characterization tests, then migrate one independently shippable surface at a time.
- Retain Sentinel as the enforcement core for review debt and verdict gates while assigning dispatch, handoff, retry, and lifecycle coordination to orchestration.
- Require evidence to bind the compiled plan, materialized artifact, verification stage, consumer adapter, and current dispatch/review wave.
- Preserve the closed projection evidence verdict vocabulary while keeping lifecycle summary codes separate from `EvidenceResult`.
- No breaking public behavior is intended; any observed output or exit-code difference blocks migration until explicitly approved as a separate contract change.

## Capabilities

### New Capabilities

- `distribution-projection-contract`: Defines the deep projection interfaces, deterministic plan and artifact contracts, artifact-store boundary, adapter responsibilities, symlink policy, and staged evidence result.

### Modified Capabilities

- `distribution-surface-governance`: Makes the distribution inventory the authoritative projection input and requires every generated surface to use the shared projection contract without changing current outputs.
- `implementation-dispatch`: Clarifies that orchestration owns agent dispatch, handoff, retry, and acceptance while Sentinel remains the independent enforcement boundary.
- `orchestration-evidence-lifecycle`: Extends durable evidence identity across dispatch, materialization, verification stage, consumer adapter, and review-wave closure.

## Impact

- Distribution source and policy: `manifests/distribution-inventory.json`, `scripts/lib/distribution-inventory.js`, and new shared projection modules under `scripts/lib/`.
- Existing generators and verifiers under `scripts/ci/` for Agent Plugin, Codex native, and Cursor projections.
- Orchestration and Sentinel contracts under `skills/dhpk-execution-policy/`, `rules/`, and `scripts/hooks/`; Sentinel clearing/enforcement logic remains in its existing core.
- Characterization and migration coverage under `tests/`, including byte-for-byte artifacts, diagnostics, exit codes, symlink handling, and evidence freshness.
- No dependency replacement, public CLI split, or concurrent v2 surface is introduced; migration extends the existing single-version contracts.
