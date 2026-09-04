## MODIFIED Requirements

### Requirement: Distribution plans carry complete projection intent

A `DistributionPlan` SHALL carry its schema/compiler version, input and inventory fingerprints, target surface, normalized profile/compatibility identity, ordered canonical selected stable IDs, any declared emitted stable-ID set, selection-policy and selection fingerprints, canonical source identities, transforms, physical ownership, normalized destination paths, content fingerprints, symlink policy, and the inventory-owned usage/provenance identity for every emitted skill. The usage identity SHALL include the normalized usage schema version and usage fingerprint; the normalized usage contract SHALL include display name, summary, syntax, input kind, invocation class, maximum effect authority, actions, options, and examples. The provenance identity SHALL include inventory revision, canonical source identity and digest, source owner, transform identity, lifecycle/retirement state, public name, invocation class, and the external-package-ledger fingerprint. The canonical selection fingerprint SHALL subsume the normalized profile definition, inventory/source inputs, policy version, and canonical ordered IDs; a surface selection fingerprint MAY additionally bind emitted IDs, usage fingerprints, provenance, and the surface transform. The plan MUST contain enough information for materialization and atomic activation to execute without re-selecting packages, regenerating usage metadata, or inventing projection policy.

#### Scenario: Materializer receives a complete plan

- **WHEN** a valid profile or compatibility plan is passed to materialization
- **THEN** every output path, owner, transform, canonical/emitted stable ID, public name, invocation class, lifecycle state, usage contract/fingerprint, provenance identity, expected content fingerprint, profile/selection identity, external-ledger fingerprint, and link policy is already declared in the plan

#### Scenario: Plan omits projection provenance

- **WHEN** an output intent lacks a stable source ID, canonical source identity, profile/selection identity, transform identity, usage contract or fingerprint, external-ledger fingerprint, or expected content fingerprint
- **THEN** compilation returns a structured incomplete-plan error before any output can be written

#### Scenario: Adapter emits metadata not in the plan

- **WHEN** a materializer or adapter emits metadata, usage fields, provenance, or a public identity that is not declared by the accepted distribution plan
- **THEN** the projection gate rejects the output and reports the undeclared field without publishing it

### Requirement: Verification returns stage-bound evidence

The distribution layer SHALL expose `verifyDistribution(stage, artifact, consumerAdapter) -> EvidenceResult`. Verification MUST use a declared verification stage and consumer adapter, MUST NOT mutate the accepted artifact, and MUST return structured evidence binding the stage, adapter identity/version, target surface, profile/compatibility identity, selected stable IDs, plan, artifact, selection fingerprints, usage/provenance fingerprints, checked claims, observed outputs, verdict, and diagnostics. `EvidenceResult.verdict` MUST remain exactly `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE`; lifecycle summary codes are not valid projection verdicts. A passing structural, package, budget, or rollback stage MUST NOT be promoted to consumer-runtime support without an independent configured runtime stage.

#### Scenario: Structural verification passes

- **WHEN** the requested structural stage confirms a profile materialized output manifest, usage/provenance metadata, and fingerprints against the plan
- **THEN** the evidence result records a passing structural verdict without upgrading any runtime support tier

#### Scenario: Consumer verification uses stale artifact identity

- **WHEN** the requested profile, selection, usage, provenance, or artifact fingerprint differs from the artifact identity observed by the consumer adapter
- **THEN** verification returns a stale-evidence failure and does not reuse an earlier passing verdict

#### Scenario: Adapter does not support a requested stage

- **WHEN** a consumer adapter cannot execute the declared verification stage
- **THEN** the result uses the configured non-pass support state such as `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE` rather than reporting success

## ADDED Requirements

### Requirement: Projection metadata is usage- and provenance-bound

Every generated projection SHALL derive each skill's usage contract and provenance from the same inventory revision used for selection. A projection MAY transform presentation for its declared surface, but it MUST preserve the normalized usage meaning, canonical source identity, ownership, retirement state, and external-package-ledger identity. Usage or provenance changes MUST alter the relevant fingerprint and require an explicit inventory or source change; output-byte or entry-count equality alone is insufficient evidence of parity.

#### Scenario: Usage and provenance are projected consistently

- **WHEN** two surfaces compile the same selected canonical IDs from the same inventory revision
- **THEN** their normalized usage contracts and provenance identities match for equivalent entries, and each plan records the same inventory and external-ledger fingerprints

#### Scenario: Usage metadata drifts silently

- **WHEN** a surface changes syntax, actions, options, examples, invocation class, or effect authority without a declared source or inventory change
- **THEN** projection validation fails with the affected stable ID and usage-fingerprint mismatch before publication

#### Scenario: Ownership provenance drifts silently

- **WHEN** a surface changes canonical source identity, owner, transform, lifecycle/retirement state, public name, invocation class, or external-package-ledger fingerprint without a declared policy change
- **THEN** projection validation fails with the affected stable ID and provenance-field mismatch before publication

### Requirement: Retired identities are excluded from projection plans

The compiler SHALL reject retired stable IDs, retired version-specific aliases, and historical public names as selected projection inputs. They MUST NOT appear in generated discovery, profile, package, or consumer-runtime artifacts. A dhpk-owned diagnostic MAY identify the canonical successor and selector, but that diagnostic MUST NOT create an emitted entry or executable compatibility alias.

#### Scenario: Version alias reaches the compiler

- **WHEN** a selection or surface membership input contains one of the retired Laravel/PHPUnit version-specific IDs or its historical public name
- **THEN** compilation fails closed with a retirement diagnostic naming the canonical family and selector, and produces no materialization intent

#### Scenario: Retired alias appears in an artifact

- **WHEN** a generated manifest, package, or staged artifact contains a retired stable ID, old path, symlink, or discovery entry
- **THEN** projection validation fails before publication and reports the surface, path, and retired identity
