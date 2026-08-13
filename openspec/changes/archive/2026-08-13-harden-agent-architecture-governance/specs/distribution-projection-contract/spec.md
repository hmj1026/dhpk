## ADDED Requirements

### Requirement: Distribution compilation is pure and deterministic

The distribution layer SHALL expose a single `compileDistribution(inputs) -> DistributionPlan` contract. Compilation MUST validate boundary inputs, select entries only from the distribution inventory, resolve declared transforms and ownership, and return an immutable plan without reading undeclared ambient state or writing to the filesystem. Equivalent normalized inputs MUST produce the same plan fingerprint and ordered output intents.

#### Scenario: Equivalent inputs compile identically

- **WHEN** canonical source fingerprints, inventory data, projection rules, and compiler version are unchanged
- **THEN** repeated compilation returns byte-equivalent normalized plans with the same plan fingerprint

#### Scenario: Compilation attempts an undeclared selection

- **WHEN** an adapter, directory layout, or generated manifest implies a component that is absent from the selected inventory surface
- **THEN** compilation returns a structured validation error naming the undeclared component and produces no materialization plan

#### Scenario: Compiler observes ambient filesystem state

- **WHEN** a projection would require an undeclared directory scan, host configuration, clock value, or environment value to determine its outputs
- **THEN** compilation fails until that value is supplied explicitly through `inputs`

### Requirement: Distribution plans carry complete projection intent

A `DistributionPlan` SHALL carry its schema/compiler version, input and inventory fingerprints, target surface, ordered stable IDs, canonical source identities, transforms, physical ownership, normalized destination paths, content fingerprints, and symlink policy. The plan MUST contain enough information for materialization to execute without re-selecting packages or inventing projection policy.

#### Scenario: Materializer receives a complete plan

- **WHEN** a valid plan is passed to materialization
- **THEN** every output path, owner, transform, expected content fingerprint, and link policy is already declared in the plan

#### Scenario: Plan omits projection provenance

- **WHEN** an output intent lacks a stable source ID, canonical source identity, transform identity, or expected fingerprint
- **THEN** compilation returns a structured incomplete-plan error before any output can be written

### Requirement: Materialization is isolated behind ProjectionArtifactStore

The distribution layer SHALL expose `materializeDistribution(plan, adapter, artifactStore) -> DistributionArtifact`. `ProjectionArtifactStore` SHALL be the only projection-pipeline port permitted to create directories, write files, create permitted links, stage outputs, replace generated roots, or calculate post-write filesystem observations. The materializer MUST follow the plan exactly; it MUST NOT perform inventory selection, consumer verification, or direct filesystem mutation outside the artifact store.

#### Scenario: Plan materializes successfully

- **WHEN** the adapter renders every planned output and the artifact store confirms the staged writes match the plan
- **THEN** materialization returns a `DistributionArtifact` bound to the plan fingerprint and containing the physical output manifest and observed fingerprints

#### Scenario: Adapter emits an unplanned output

- **WHEN** the adapter attempts to write a destination or stable ID absent from the plan
- **THEN** the artifact store rejects the operation, leaves the accepted artifact unpublished, and returns a structured scope error

#### Scenario: Materialization fails before publication

- **WHEN** a write, link, digest, or atomic replacement fails in the staging area
- **THEN** the previously accepted generated surface remains intact and the result identifies the failed planned output

### Requirement: Symlink behavior is explicit and fail-closed

Every projection SHALL declare a symlink policy in inventory-owned projection rules. The default policy SHALL be `forbid`. A permitted link MUST be relative, MUST resolve within the declared artifact ownership root, MUST have a stable source/output identity, and MUST be represented in both `DistributionPlan` and `DistributionArtifact`; absolute links, escaping targets, ambient links discovered during traversal, and undeclared dereferencing MUST be rejected.

#### Scenario: Projection contains an undeclared symlink

- **WHEN** a canonical source or staged output contains a symlink but the selected projection policy is `forbid`
- **THEN** compilation or materialization fails with the link path and no accepted artifact is published

#### Scenario: Declared relative link remains within its owner

- **WHEN** the inventory explicitly permits a relative link whose normalized target remains inside the declared artifact ownership root
- **THEN** the plan records the link intent and materialization verifies the created link without silently copying or dereferencing it

#### Scenario: Link target escapes its owner

- **WHEN** a declared or encountered link resolves outside its artifact ownership root
- **THEN** the projection fails closed regardless of whether the target exists

### Requirement: Verification returns stage-bound evidence

The distribution layer SHALL expose `verifyDistribution(stage, artifact, consumerAdapter) -> EvidenceResult`. Verification MUST use a declared verification stage and consumer adapter, MUST NOT mutate the accepted artifact, and MUST return structured evidence binding the stage, adapter identity/version, plan and artifact fingerprints, checked claims, observed outputs, verdict, and diagnostics.

#### Scenario: Structural verification passes

- **WHEN** the requested structural stage confirms the materialized output manifest and fingerprints against the plan
- **THEN** the evidence result records a passing structural verdict without upgrading any runtime support tier

#### Scenario: Consumer verification uses stale artifact identity

- **WHEN** the requested artifact fingerprint differs from the artifact identity observed by the consumer adapter
- **THEN** verification returns a stale-evidence failure and does not reuse an earlier passing verdict

#### Scenario: Adapter does not support a requested stage

- **WHEN** a consumer adapter cannot execute the declared verification stage
- **THEN** the result uses the configured non-pass support state such as `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE` rather than reporting success

### Requirement: Projection contracts use one structured result strategy

Compilation, materialization, and verification SHALL return explicit success or structured failure results with stable codes, stage, affected stable IDs/paths, and causal diagnostics. Core projection contracts MUST NOT mix exceptions, `null`, process exits, and ad hoc `{error}` payloads as caller-visible failure strategies. Existing CLIs SHALL translate the structured result at their interface boundary while preserving characterized messages, ordering, and exit codes.

#### Scenario: Core operation rejects invalid input

- **WHEN** any projection stage rejects input or execution
- **THEN** its caller receives a structured failure result and no partially successful value

#### Scenario: Existing CLI exposes the failure

- **WHEN** a migrated CLI receives a structured projection failure corresponding to a characterized legacy failure
- **THEN** the CLI emits the same observable diagnostic and exit code as the legacy implementation

### Requirement: Projection migration is characterization-gated

Each existing distribution surface SHALL be characterized before it is routed through the shared projection contracts. A migrated surface MUST preserve selected stable IDs, output paths, bytes, ordering, transforms, ownership, link behavior, diagnostics, and exit codes for the same inputs. A behavior difference SHALL block that surface's migration unless an additive or breaking contract change is separately approved.

#### Scenario: Characterized surface is unchanged

- **WHEN** the legacy and contract-based pipelines run against the same fixtures
- **THEN** their normalized plans, materialized artifacts, diagnostics, and process outcomes match the characterized contract

#### Scenario: One migrated surface drifts

- **WHEN** a staged migration changes any characterized observable for one consumer surface
- **THEN** that surface remains on the prior implementation while independently migrated surfaces remain shippable
