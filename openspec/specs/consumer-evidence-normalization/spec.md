# consumer-evidence-normalization Specification

## Purpose

Define the stage-bound consumer evidence contract, preserve installation and
runtime observations independently, and validate versioned acceptance reports
without executing consumer processes or synthesizing native runtime proof.

## Requirements

### Requirement: Consumer evidence has one stage-bound per-surface contract

The release evidence layer SHALL normalize every supported consumer result into a stage-bound record containing the surface, adapter identity/version when available, verdict/status, commands, environment, artifacts, diagnostics, failure reasons, and applicable `DistributionPlan` and `DistributionArtifact` fingerprints. Normalization MUST preserve the producer's positive and non-positive evidence rather than flattening it into an opaque reason string.

#### Scenario: Platform probe result is normalized

- **WHEN** a consumer platform probe returns a surface result with status, commands, diagnostics, and artifact metadata
- **THEN** the normalized result retains those fields under the surface evidence record with its stage and adapter identity

#### Scenario: Projection-bound evidence includes identity

- **WHEN** a consumer check validates a generated projection tied to a plan and artifact
- **THEN** the normalized result records the exact plan and artifact fingerprints and rejects stale or missing bindings where the check requires them

#### Scenario: Probe diagnostics are not discarded

- **WHEN** a producer returns bounded diagnostics, errors, environment, or observed outputs
- **THEN** normalization retains the redacted bounded values in machine-readable evidence

### Requirement: Consumer evidence normalization is adapter-based

The canonical evidence module SHALL validate and map producer results but MUST NOT execute consumer processes, mutate consumer state, or infer runtime support from structural package validation. Surface-specific probes and release helpers remain execution adapters behind the normalization seam.

#### Scenario: Structural validation passes without a runtime probe

- **WHEN** package validation succeeds but the configured consumer route is not executed
- **THEN** structural evidence remains separate and the consumer result is `NOT_RUN`, `UNAVAILABLE`, `BLOCKED`, or another applicable non-pass state

#### Scenario: Normalization receives an invalid result

- **WHEN** a producer omits a required stage, surface, or verdict/status field
- **THEN** the mapper returns a structured normalization failure and does not synthesize a consumer `PASS`

### Requirement: Compatibility fields remain stable during normalization

The first migration wave SHALL preserve existing top-level release evidence fields, artifact wording and ordering, workflow parsing, receipt semantics, and process exit codes. New per-surface evidence MAY be additive, but legacy consumers MUST continue to receive their characterized fields until each producer passes parity and rollback gates.

#### Scenario: Legacy release consumer reads normalized output

- **WHEN** a migrated producer emits normalized evidence through the release gate
- **THEN** existing top-level fields and exit behavior match the characterization fixture while additive per-surface evidence is available

#### Scenario: Producer parity fails

- **WHEN** normalization changes a characterized field, diagnostic, artifact string, ordering, or exit code
- **THEN** the producer remains on its prior mapping path and the new mapping does not become authoritative

### Requirement: Evidence and lifecycle verdicts remain separate

Consumer evidence normalization MUST NOT merge `dhpk-install` lifecycle aggregate codes with release evidence verdicts. The canonical per-surface evidence vocabulary remains `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, and `UNAVAILABLE`; lifecycle summaries retain their separate contract. A legacy surface-matrix `WARN` MAY remain in the compatibility top-level aggregate or a dedicated `legacySurfaceStatus`/`warnings` field, but MUST NOT become a ninth canonical evidence verdict.

#### Scenario: Lifecycle is install-pass but consumer is blocked

- **WHEN** installation completes structurally but consumer proof is blocked
- **THEN** the result preserves distinct install-lifecycle and consumer-evidence outcomes without upgrading either contract

#### Scenario: Unavailable client is reported

- **WHEN** a supported consumer is unavailable in the verification environment
- **THEN** its evidence remains `UNAVAILABLE` or the applicable non-pass state and is not rewritten as a runtime `PASS`

#### Scenario: Codex surface warning remains compatibility metadata

- **WHEN** the legacy Codex duplicate-surface matrix returns `WARN` while the release gate retains its characterized aggregate behavior
- **THEN** normalization preserves `WARN` as legacy surface status and warning metadata, uses only the closed canonical verdict vocabulary for the per-surface evidence result, and does not present the surface as a clean supported install

### Requirement: REQ-849-03 Versioned consumer acceptance preserves observations

A CONSUMER report that includes `acceptance` SHALL use `schemaVersion: 2` and
the exact acceptance fields `verdict`, `requiredChecks`, and `excludedChecks`.
Each check SHALL retain `id`, `surface`, `kind`, `reason`, `status`, and
`evidenceRef`. The normalizer SHALL preserve the observed status instead of
rewriting installation or runtime evidence to agree with acceptance. A check's
reference SHALL resolve to an observed object on the same surface whose status
exactly matches the check status. A passing check MUST have a resolving
reference. For a declared requirements-file check, `evidenceRef` SHALL use the
stable path `surfaceResults.<surface>.requirementEvidence.checkN`, where `N`
is its one-based position in the input `checks` array. The referenced evidence
object SHALL retain the validated requirement ID in its `id` field; the ID is
not embedded in the reference path.

`requiredChecks` SHALL be non-empty. Each list SHALL contain at most 100 checks
with unique IDs across both lists. The normalized acceptance verdict SHALL be
derived from required checks only: any required `FAIL` produces `FAIL`; if no
required check fails but any required status is not `PASS`, the verdict is
`BLOCKED`; otherwise it is `PASS`. The CONSUMER stage verdict SHALL equal the
acceptance verdict. Excluded check outcomes and their reasons remain visible
but do not satisfy or fail a required check. The accepted field and status
contract is specified in the
[consumer acceptance contract](../../../docs/contracts/consumer-acceptance.md).

#### Scenario: Required installation PASS and excluded runtime NOT_RUN coexist

- **WHEN** a selected installation check passes and its separately observed
  native runtime check is `NOT_RUN`
- **THEN** the report can have an overall acceptance PASS with installation in
  `requiredChecks` and runtime in `excludedChecks`
- **AND** the runtime observation remains `NOT_RUN` with a reference to that
  observation

#### Scenario: Unconfigured optional surface remains excluded

- **WHEN** the unscoped consumer gate finds no local marker for an unrequested
  optional surface
- **THEN** the report retains that surface in `excludedChecks` as
  `NOT_CONFIGURED` with the absent-marker reason
- **AND** normalization preserves that observed state without invoking an
  adapter or changing the acceptance verdict

#### Scenario: Empty configured scope remains blocked

- **WHEN** an unscoped report has no configured consumer target
- **THEN** it retains a required `scope.configuration` check with
  `surface: "consumer-scope"`, status `BLOCKED`, and `evidenceRef: null`
- **AND** excluded `NOT_CONFIGURED` surface rows do not produce a vacuous PASS
- **AND** `scope.configuration` represents missing scope, not a hidden Host

#### Scenario: Absent optional surface does not create a missing-scope check

- **WHEN** an unscoped report has a configured target whose installation
  check passes and another optional surface has no marker
- **THEN** the absent optional surface remains excluded as `NOT_CONFIGURED`
- **AND** no required Host or `scope.configuration` check is added

#### Scenario: Acceptance reference has a mismatched status

- **WHEN** an acceptance check references a missing surface, a different
  surface, a dangling evidence path, or an observed status different from its
  own status
- **THEN** normalization fails with a structured validation error and does not
  accept the report

### Requirement: REQ-849-04 Historical consumer evidence remains unsynthesized

Historical consumer reports without an acceptance object SHALL retain their
original versioning and status semantics. Normalization MUST NOT synthesize a
schema-v2 acceptance object or a `runtimeVerified` claim when reading those
reports. Installation PASS alone MUST NOT establish top-level
`runtimeVerified: true`; a v2 input may retain that claim only when valid,
current native capability evidence supports it. The #849 consumer gate emits no
such claim because it does not execute a native runtime check.

#### Scenario: Historical evidence is normalized without acceptance

- **WHEN** a historical report has no acceptance object or schemaVersion
- **THEN** its existing evidence remains readable under its original status
  contract and no acceptance is synthesized

#### Scenario: Installation success cannot establish runtime verification

- **WHEN** a v2 report contains passing installation evidence but no valid
  identity-matched native capability evidence
- **THEN** normalization rejects or removes an unsupported `runtimeVerified:
  true` value and preserves the raw runtime state
