# execution-role-vocabulary Specification

## Purpose
TBD - created by archiving change canonicalize-cli-role-vocabulary. Update Purpose after archive.

## Requirements

### Requirement: Role, provider, execution class, and transport are distinct

The repository SHALL maintain one canonical vocabulary in which provider/backend
(`claude`, `codex`, `agy`), role, execution class, and transport are separate
fields. The canonical CLI role IDs SHALL be `codex-worker`, `codex-reasoner`,
`codex-reviewer`, and `agy-worker`; `fast-worker`, `deep-reasoner`, and
`code-reviewer` retain their existing Claude/lifecycle meanings. A role string
alone SHALL never be treated as runtime execution evidence.

#### Scenario: Codex worker identity is explicit

- **WHEN** a write-capable Codex dispatch is normalized
- **THEN** its request identifies backend `codex`, role `codex-worker`, a
  workspace-write mode, and its transport independently

#### Scenario: Reviewer is not a worker

- **WHEN** a Codex peer review is normalized
- **THEN** it identifies role `codex-reviewer` and read-only mode, and no
  selector or receipt infers write authority from the provider name

### Requirement: Legacy role names resolve through one compatibility seam

The role resolver SHALL accept `codex-fast-worker`, `codex-deep-reasoner`,
`codex-bridge`, and `agy-fast-worker` as one-release aliases for the canonical
IDs. It SHALL return requested/effective role plus authority, resolver/source
ID, and the exact `dhpk.role-contract.v1` SHA-256 evidence defined by the shared
runner contract, emit at most one bounded deprecation warning per session, and
return `BLOCKED` for unknown or ambiguous names without guessing a replacement.

#### Scenario: Alias is observable and executable

- **WHEN** a caller requests `codex-fast-worker`
- **THEN** normalization records `requested_role=codex-fast-worker`,
  `effective_role=codex-worker`, and a deprecation diagnostic before dispatch

#### Scenario: Alias warning is bounded

- **WHEN** the same legacy name is used repeatedly in one session
- **THEN** the resolver emits one warning and does not multiply log noise

#### Scenario: Dual-use bridge alias is mode-qualified

- **WHEN** `codex-bridge` is requested with explicit `read-only` mode
- **THEN** normalization records effective role `codex-reviewer` and read-only
  authority
- **AND WHEN** the same alias is requested with explicit `workspace-write` mode
- **THEN** normalization records effective role `codex-worker` and
  workspace-write authority
- **AND WHEN** mode is missing or contradicts the resolved authority
- **THEN** normalization returns `BLOCKED` without choosing either role

#### Scenario: Unknown role fails closed

- **WHEN** a caller supplies a role outside the canonical and alias sets
- **THEN** normalization returns `BLOCKED` and does not choose a provider or
  role implicitly

### Requirement: Canonical names drive new configuration and generated surfaces

Selector outputs, new handoffs/receipts, role-specific configuration lookup,
generated role files, indexes, manifests, and parity metadata SHALL use
canonical role IDs. Legacy configuration keys and wrapper entry points MAY be
translated for one release, with canonical-key precedence and an observable
legacy-source diagnostic. Historical logs, immutable release assets, and
fixtures SHALL not be rewritten solely to remove old names.

#### Scenario: Canonical config wins over legacy config

- **WHEN** both canonical and legacy keys are present for one role
- **THEN** the canonical value is selected and the legacy source is reported
  without changing historical records

#### Scenario: Generated projections contain no duplicate alias roles

- **WHEN** the canonical generators run
- **THEN** they emit the canonical direct-role set once, while aliases remain
  boundary compatibility inputs and do not create duplicate projections

#### Scenario: Native reviewer publication waits for runtime proof

- **WHEN** the first canonical-role rollout runs without verified installed-CLI
  evidence for the native `codex-reviewer` read-only contract
- **THEN** `codex-reviewer` remains an internal shared-runner role for existing
  Claude/Cursor orchestrator callers and is not emitted as a native direct role
- **AND** Codex-host direct routing reports it capability-gated and unavailable

### Requirement: Alias retirement is a separate, evidence-backed decision

The one-release aliases SHALL remain until a later approved change records
active-caller inventory, migration guidance, release-note impact, and consumer
verification. This change SHALL not silently remove or reinterpret an alias.

#### Scenario: Alias removal is not implicit

- **WHEN** canonical migration tests pass but no retirement change is approved
- **THEN** legacy aliases continue to resolve with their bounded deprecation
  diagnostic
