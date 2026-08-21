# consumer-evidence-normalization Specification

## Purpose
TBD - created by archiving change normalize-consumer-evidence. Update Purpose after archive.
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
