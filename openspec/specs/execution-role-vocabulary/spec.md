# execution-role-vocabulary Specification

## Purpose

Keep Role, Provider, authority and transport identities distinct, with canonical configuration and projections, explicit runtime evidence, and fail-closed retirement diagnostics.

## Requirements

### Requirement: Role, provider, execution class, and transport are distinct

The repository SHALL maintain one canonical vocabulary in which Host, Provider,
Model, Role, authority/execution class, and Transport are separate fields. The
canonical Roles SHALL be `planner`, `reasoner`, `worker`, and `reviewer`.
Provider-bound names such as `codex-worker` and `agy-worker` MAY remain only as
compatibility inputs or Adapter metadata. A Role string alone SHALL never be
treated as runtime execution evidence.

#### Scenario: Codex worker identity is explicit

- **WHEN** a write-capable Codex dispatch is normalized
- **THEN** its request identifies Provider `codex-cli`, Role `worker`,
  workspace-write authority, Model/Effort when selected, and Transport
  independently

#### Scenario: The same Role uses another Provider

- **WHEN** an equivalent worker request is dispatched through Claude Code or
  AGY
- **THEN** its Role remains `worker` while Provider and Transport change

#### Scenario: Reviewer is not a worker

- **WHEN** a peer review is normalized
- **THEN** it identifies Role `reviewer` and read-only authority, and no
  Provider name infers write authority

### Requirement: Legacy role names are handled through one fail-closed compatibility seam

The role resolver SHALL reject retired execution names `codex-fast-worker`,
`codex-deep-reasoner`, and `agy-fast-worker` with `BLOCKED` and retirement
guidance naming `codex-worker`, `codex-reasoner`, and `agy-worker`, respectively.
Canonical roles SHALL retain authority, Provider constraints, resolver/source ID,
and exact SHA-256 evidence from the shared runner contract. Unknown, retired,
and ambiguous names SHALL fail closed without guessing a replacement. REQ-7.

The earlier `consolidate-flow-drive-runtime` retirement of standalone
`codex-bridge` remains effective. This change SHALL preserve its `BLOCKED`
execution behavior and SHALL NOT restore a skill, agent or executable alias.
Passive legacy timeout settings remain distinct from execution-role admission.

#### Scenario: Previously retired bridge remains blocked

- **WHEN** a caller requests `codex-bridge` with missing, read-only or workspace-write mode
- **THEN** normalization returns `BLOCKED` and no execution context is published

#### Scenario: Alias is observable and executable

Historical scenario identifier retained for archive reconciliation; this scenario now requires the retired alias to remain observable only as a BLOCKED diagnostic and never executable.

- **WHEN** a caller attempts the formerly executable `codex-bridge` alias
- **THEN** the previous retirement takes precedence: the request remains observable as a `BLOCKED` input and no executable role or context is produced

#### Scenario: Alias warning is bounded

- **WHEN** the previously retired bridge is requested repeatedly
- **THEN** each request remains `BLOCKED`, no executable alias deprecation warning is emitted, and no dispatch occurs

#### Scenario: Dual-use bridge alias is mode-qualified

- **WHEN** the historical dual-use bridge is requested with read-only, workspace-write, or missing mode
- **THEN** every mode is `BLOCKED`; mode qualification cannot restore a role retired by the earlier approved change

#### Scenario: Unknown role fails closed

- **WHEN** a caller supplies a Role outside the canonical and remaining alias
  sets
- **THEN** normalization returns `BLOCKED` and does not choose a Provider or
  Role implicitly

#### Scenario: Retired forwarder name fails closed

- **WHEN** a caller requests `codex-fast-worker`, `codex-deep-reasoner`, or
  `agy-fast-worker`
- **THEN** normalization returns `BLOCKED` with a retirement diagnostic naming
  `codex-worker`, `codex-reasoner`, or `agy-worker` and does not dispatch

### Requirement: Canonical names drive new configuration and generated surfaces

The repository SHALL ensure that selector outputs, new handoffs/receipts,
Role-specific configuration lookup, generated Role files, indexes, manifests,
and parity metadata SHALL use
Provider-neutral canonical Role IDs. Retired wrapper entry points
`codex-fast-worker`, `codex-deep-reasoner`, and `agy-fast-worker` SHALL NOT be
translated as executable aliases. Passive legacy timeout keys MAY be translated with canonical-key precedence and an observable legacy-source diagnostic; this does not admit a retired execution role. Historical logs, immutable release assets, and fixtures SHALL not
be rewritten solely to remove old names. REQ-7.

#### Scenario: Canonical config wins over legacy config

- **WHEN** both canonical and remaining-legacy keys are present for one Role
- **THEN** the canonical value is selected and the legacy source is reported
  without changing historical records

#### Scenario: Generated projections contain no duplicate provider Roles

- **WHEN** canonical generators run
- **THEN** they emit the canonical Role set once, retired forwarder names are
  absent from generated role files, and retired `codex-bridge` produces no executable projection

#### Scenario: Native reviewer publication waits for runtime proof

- **WHEN** a Host lacks verified evidence for its native read-only reviewer
  capability
- **THEN** publication remains capability-gated and reports the missing
  capability instead of inferring it from a Provider name

### Requirement: Alias retirement is a separate, evidence-backed decision

The elapsed one-release aliases `codex-fast-worker`, `codex-deep-reasoner`,
and `agy-fast-worker` SHALL be retired by this approved change, which records
active-caller inventory, migration guidance, release-note impact, and consumer
verification. Prior `codex-bridge` retirement SHALL remain intact. The user
explicitly reaffirmed that prior retirement during apply on 2026-10-15. REQ-7.

#### Scenario: Alias removal is not implicit

- **WHEN** canonical forwarder migration tests pass after the user's explicit decision to preserve the earlier approved bridge retirement
- **THEN** `codex-bridge` remains `BLOCKED` and its retired skill and agent remain absent; this is preservation of an explicit retirement, not a new implicit removal

#### Scenario: Elapsed forwarders are retired by this change

- **WHEN** this change's retirement validation passes for `codex-fast-worker`,
  `codex-deep-reasoner`, and `agy-fast-worker`
- **THEN** those names no longer resolve as aliases and remaining callers
  receive fail-closed successor guidance
