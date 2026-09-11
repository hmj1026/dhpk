# execution-role-vocabulary Specification

## Purpose

TBD - created by archiving change canonicalize-cli-role-vocabulary. Update Purpose after archive.

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

### Requirement: Legacy role names resolve through one compatibility seam

The role resolver SHALL accept `codex-fast-worker`, `codex-deep-reasoner`,
`codex-bridge`, and `agy-fast-worker` as one-release compatibility aliases. It
SHALL return the canonical Provider-neutral Role plus any legacy Provider
constraint, authority, resolver/source ID, and exact SHA-256 evidence defined by
the shared runner contract. It SHALL emit at most one bounded deprecation
warning per session and return `BLOCKED` for unknown or ambiguous names without
guessing a replacement.

#### Scenario: Alias is observable and executable

- **WHEN** a caller requests `codex-fast-worker`
- **THEN** normalization records the requested alias, effective Role `worker`,
  compatibility Provider constraint `codex-cli`, and a deprecation diagnostic
  before dispatch

#### Scenario: Alias warning is bounded

- **WHEN** the same legacy name is used repeatedly in one session
- **THEN** the resolver emits one warning and does not multiply log noise

#### Scenario: Dual-use bridge alias is mode-qualified

- **WHEN** `codex-bridge` is requested with explicit `read-only` mode
- **THEN** normalization records effective Role `reviewer` and read-only
  authority
- **AND WHEN** the same alias is requested with explicit `workspace-write` mode
- **THEN** normalization records effective Role `worker` and workspace-write
  authority
- **AND WHEN** mode is missing or contradicts the resolved authority
- **THEN** normalization returns `BLOCKED` without choosing either Role

#### Scenario: Unknown role fails closed

- **WHEN** a caller supplies a Role outside the canonical and alias sets
- **THEN** normalization returns `BLOCKED` and does not choose a Provider or
  Role implicitly

### Requirement: Canonical names drive new configuration and generated surfaces

The repository SHALL ensure that selector outputs, new handoffs/receipts,
Role-specific configuration lookup, generated Role files, indexes, manifests,
and parity metadata SHALL use
Provider-neutral canonical Role IDs. Legacy Provider-bound configuration keys
and wrapper entry points MAY be translated for one release, with canonical-key
precedence and an observable legacy-source diagnostic. Historical logs,
immutable release assets, and fixtures SHALL not be rewritten solely to remove
old names.

#### Scenario: Canonical config wins over legacy config

- **WHEN** both canonical and legacy keys are present for one Role
- **THEN** the canonical value is selected and the legacy source is reported
  without changing historical records

#### Scenario: Generated projections contain no duplicate provider Roles

- **WHEN** canonical generators run
- **THEN** they emit the canonical Role set once, while compatibility aliases
  remain boundary inputs and do not create duplicate projections

#### Scenario: Native reviewer publication waits for runtime proof

- **WHEN** a Host lacks verified evidence for its native read-only reviewer
  capability
- **THEN** publication remains capability-gated and reports the missing
  capability instead of inferring it from a Provider name

### Requirement: Alias retirement is a separate, evidence-backed decision

The one-release aliases SHALL remain until a later approved change records
active-caller inventory, migration guidance, release-note impact, and consumer
verification. This change SHALL not silently remove or reinterpret an alias.

#### Scenario: Alias removal is not implicit

- **WHEN** canonical migration tests pass but no retirement change is approved
- **THEN** legacy aliases continue to resolve with their bounded deprecation
  diagnostic
