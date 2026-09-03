# distribution-projection-contract Specification

## Purpose

Define the deterministic, inventory-bound projection compiler, artifact-store,
and stage-bound verification contracts used by generated distribution surfaces.

## Requirements

### Requirement: Distribution compilation is pure and deterministic

The distribution layer SHALL expose a single `compileDistribution(inputs) -> DistributionPlan` contract. Compilation MUST validate boundary inputs, accept all selection context explicitly (including profile ID, stable-ID allowlist, compatibility mode, and selection-policy version), select entries only from the distribution inventory, resolve declared transforms and ownership, and return an immutable plan without reading undeclared ambient state or writing to the filesystem. Equivalent normalized inputs MUST produce the same plan and selection fingerprints and ordered output intents.

#### Scenario: Equivalent inputs compile identically

- **WHEN** canonical source fingerprints, inventory data, projection rules, profile selection, compatibility mode, and compiler version are unchanged
- **THEN** repeated compilation returns byte-equivalent normalized plans with the same plan and selection fingerprints

#### Scenario: Profile selection is undeclared

- **WHEN** a profile-aware adapter chooses membership without passing the normalized profile selector, stable-ID allowlist, and its closure to compilation
- **THEN** compilation rejects the boundary input and produces no materialization plan

#### Scenario: Compilation attempts an undeclared selection

- **WHEN** an adapter, directory layout, generated manifest, or profile alias implies a component that is absent from the selected inventory surface
- **THEN** compilation returns a structured validation error naming the undeclared component and produces no materialization plan

#### Scenario: Compiler observes ambient filesystem state

- **WHEN** a projection would require an undeclared directory scan, host configuration, clock value, or environment value to determine its outputs
- **THEN** compilation fails until that value is supplied explicitly through `inputs`

### Requirement: Distribution plans carry complete projection intent

A `DistributionPlan` SHALL carry its schema/compiler version, input and inventory fingerprints, target surface, normalized profile/compatibility identity, ordered canonical selected stable IDs, any declared emitted stable-ID set, selection-policy and selection fingerprints, canonical source identities, transforms, physical ownership, normalized destination paths, content fingerprints, and symlink policy. The canonical selection fingerprint SHALL subsume the normalized profile definition, inventory/source inputs, policy version, and canonical ordered IDs; a surface selection fingerprint MAY additionally bind emitted IDs and the surface transform. The plan MUST contain enough information for materialization and atomic activation to execute without re-selecting packages or inventing projection policy.

#### Scenario: Materializer receives a complete plan

- **WHEN** a valid profile or compatibility plan is passed to materialization
- **THEN** every output path, owner, transform, canonical/emitted stable ID, expected content fingerprint, profile/selection identity, and link policy is already declared in the plan

#### Scenario: Plan omits projection provenance

- **WHEN** an output intent lacks a stable source ID, canonical source identity, profile/selection identity, transform identity, or expected fingerprint
- **THEN** compilation returns a structured incomplete-plan error before any output can be written

#### Scenario: Adapter emits metadata not in the plan

- **WHEN** a materializer or adapter emits metadata that is not declared by the accepted distribution plan
- **THEN** the projection gate rejects the output and reports the undeclared metadata without publishing it

### Requirement: Materialization is isolated behind ProjectionArtifactStore

The distribution layer SHALL expose `materializeDistribution(plan, adapter, artifactStore) -> DistributionArtifact`. `ProjectionArtifactStore` SHALL be the only projection-pipeline port permitted to create directories, write files, create permitted links, stage outputs, replace generated roots, or calculate post-write filesystem observations. The materializer MUST follow the plan exactly, MUST NOT perform inventory selection, consumer verification, or active-root replacement, and MUST return a complete staged candidate for a separate activation gate to evaluate.

#### Scenario: Plan materializes successfully

- **WHEN** the adapter renders every planned output and the artifact store confirms the staged writes match the plan
- **THEN** materialization returns a staged `DistributionArtifact` bound to the plan and selection fingerprints and containing the physical output manifest and observed fingerprints without changing the active root

#### Scenario: Adapter emits an unplanned output

- **WHEN** the adapter attempts to write a destination or stable ID absent from the plan
- **THEN** the artifact store rejects the operation, leaves the accepted artifact unpublished, and returns a structured scope error

#### Scenario: Materialization fails before publication

- **WHEN** a write, link, digest, receipt, or atomic replacement fails in the staging area
- **THEN** the previously accepted generated surface and active receipt remain intact and the result identifies the failed planned output

#### Scenario: Activation waits for required evidence

- **WHEN** a staged artifact has not yet received `PASS` evidence for every inventory-declared required runtime surface
- **THEN** the separate activation gate leaves the prior active root and receipt unchanged and reports the missing or non-pass surface rows

### Requirement: Symlink behavior is explicit and fail-closed

Every projection SHALL declare a symlink policy in inventory-owned projection rules. The default policy SHALL be `forbid`. The closed policy vocabulary SHALL be `forbid`, `contained-relative`, and `declared-source-relative`. A `contained-relative` link MUST resolve within the declared artifact ownership root. A `declared-source-relative` link MUST be owned by the destination root and resolve within the canonical source root bound to the plan; this mode exists for the retained `codex-sync` checkout-to-project compatibility route. Every permitted link MUST be relative, MUST have a stable source/output identity, and MUST be represented in both `DistributionPlan` and `DistributionArtifact`; absolute links, escaping targets, ambient links discovered during traversal, and undeclared dereferencing MUST be rejected after the current absolute-link behavior is characterized.

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

The distribution layer SHALL expose `verifyDistribution(stage, artifact, consumerAdapter) -> EvidenceResult`. Verification MUST use a declared verification stage and consumer adapter, MUST NOT mutate the accepted artifact, and MUST return structured evidence binding the stage, adapter identity/version, target surface, profile/compatibility identity, selected stable IDs, plan, artifact, and selection fingerprints, checked claims, observed outputs, verdict, and diagnostics. `EvidenceResult.verdict` MUST remain exactly `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE`; lifecycle summary codes are not valid projection verdicts.

#### Scenario: Structural verification passes

- **WHEN** the requested structural stage confirms a profile materialized output manifest and fingerprints against the plan
- **THEN** the evidence result records a passing structural verdict without upgrading any runtime support tier

#### Scenario: Consumer verification uses stale artifact identity

- **WHEN** the requested profile, selection, or artifact fingerprint differs from the artifact identity observed by the consumer adapter
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

Each existing distribution surface SHALL be characterized before it is routed through the shared projection contracts. A migrated surface MUST preserve selected stable IDs, output paths, bytes, ordering, transforms, ownership, link behavior, diagnostics, and exit codes for the same inputs. A profile-scoped Claude surface MUST additionally characterize profile closure, scoped roots, compatibility output, and rollback behavior. A behavior difference SHALL block that surface's migration unless an additive or breaking contract change is separately approved.

#### Scenario: Characterized profile surface is unchanged

- **WHEN** the legacy unscoped Claude path and the contract-based profile pipeline run against the same compatibility fixture
- **THEN** their normalized plans, materialized artifacts, diagnostics, and process outcomes match the characterized compatibility contract

#### Scenario: One migrated surface drifts

- **WHEN** a staged migration changes any characterized observable for one consumer surface or profile
- **THEN** that surface/profile remains on the prior implementation while independently migrated surfaces remain shippable

#### Scenario: Characterized surface is unchanged

- **WHEN** a migrated surface produces the same selected IDs, output paths, bytes, ordering, transforms, ownership, diagnostics, and exit status as its characterization fixture
- **THEN** the surface passes the equivalence gate and may proceed to the shared projection pipeline

#### Scenario: Rollback is required

- **WHEN** a migrated surface fails equivalence, verification, or publication checks
- **THEN** the prior characterized implementation remains authoritative and the migration can be rolled back without mutating canonical sources

### Requirement: Surface selection policy is compiler-owned

The distribution compiler SHALL resolve surface membership from the inventory-owned `projection_contract` policy before any surface adapter expands output. Each migrated surface MUST declare its selection source and precedence. Adapters MUST receive selected canonical IDs and MUST NOT reselect membership from directories, generated manifests, or consumer-native output.

#### Scenario: Declared policy selects a surface

- **WHEN** a migrated surface has a valid inventory policy and its referenced membership data resolves
- **THEN** the compiler returns the deterministic selected canonical IDs and the adapter receives only those IDs for expansion

#### Scenario: Adapter attempts independent selection

- **WHEN** a migrated surface adapter discovers an inventory entry not present in the compiler-selected IDs
- **THEN** the compiler or validation gate rejects the extra entry and no accepted artifact includes it

#### Scenario: Policy is missing or unsupported

- **WHEN** a migrated surface lacks a declared selection policy or names an unsupported policy source or precedence
- **THEN** compilation returns a structured policy validation failure before materialization

### Requirement: Projection intent binds external ownership provenance

Every compiler-owned distribution plan SHALL include the normalized `external_skill_packages` fingerprint alongside its inventory fingerprint before profile or surface selection is materialized. A plan SHALL preserve selected protected skills as existing canonical inputs and SHALL NOT interpret the ledger as a request to discover, download, adapt, or publish new upstream content.

#### Scenario: Projection compiles protected existing skills
- **WHEN** a selected surface includes one or more stable IDs protected by the external ledger
- **THEN** its plan binds the ledger fingerprint and emits the inventory-selected canonical packages without content transformation beyond the surface's already declared transform

#### Scenario: Projection omits ownership provenance
- **WHEN** a compiler or adapter emits a plan or evidence record without the current external ledger fingerprint
- **THEN** validation fails before materialization and leaves the prior publication artifact unchanged
