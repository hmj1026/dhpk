# skill-usage-discovery Specification

## Purpose

Define one inventory-owned, machine-readable usage contract for every skill
that Codex can invoke, then expose that contract through progressive help and
deterministic host/documentation projections without duplicating procedure
content from the canonical skill.

## Requirements

### Requirement: Codex-invokable skills declare an inventory-owned usage contract

Every skill selected by the `codex-native` or `codex-sync` surface SHALL have
one normalized `usage` object in the distribution inventory. The object SHALL
contain `display_name`, `summary`, `syntax`, `input_kind`,
`invocation_class`, `effect_authority`, `inputs`, `actions`, `options`, and
`examples`. `inputs`, `actions`, and `options` MAY be empty arrays, but every
input SHALL contain a unique `id`, `syntax`, `value_kind`, `required`, and
`summary`, with optional `default`, `enum_values`, and `applies_to` fields;
every action SHALL contain a unique `id`, `summary`, `syntax`, `input_kind`,
and `effect_authority`; every option SHALL contain a unique `id`, `syntax`,
`value_kind`, `required`, and `summary`, with optional `default`,
`enum_values`, `legacy`, and `applies_to` fields. Every example SHALL contain
exactly `prompt` and `summary`. `syntax` and every example prompt SHALL begin
with `$` plus the inventory public skill name, and
`usage.invocation_class` SHALL equal the canonical invocation class. The usage
object and child records are closed schemas: unsupported fields, duplicate
IDs, unknown `applies_to` action IDs, invalid enum defaults, empty examples,
or child effect authority above the parent maximum SHALL fail. Skills not
selected by either Codex surface MAY omit `usage`.

#### Scenario: A positional input lacks meaning metadata

- **WHEN** a Codex skill declares an input without `value_kind`, `required`, or
  `summary`
- **THEN** inventory validation fails with the skill identity and missing field

#### Scenario: A legacy option is exposed as canonical

- **WHEN** an option marked `legacy` is used as the only primary syntax or
  example for a skill
- **THEN** validation fails or requires an explicit compatibility annotation
  that preserves a canonical alternative

#### Scenario: A Codex skill has no usage contract

- **WHEN** a skill is selected by `codex-native` or `codex-sync` without one of
  the required usage fields
- **THEN** inventory validation fails with the stable ID and missing field

#### Scenario: Usage invocation class disagrees with canonical policy

- **WHEN** a Codex-invokable skill declares `usage.invocation_class:
  implicit-eligible` but its canonical invocation class is `explicit-only`
- **THEN** usage validation fails before any projection is generated

#### Scenario: Usage grammar contains duplicate names

- **WHEN** two inputs, actions, or two options in one usage contract have the
  same `id`
- **THEN** validation fails and identifies the owning skill and duplicate

#### Scenario: A non-Codex skill omits usage

- **WHEN** a skill is not selected by either Codex surface and has no `usage`
  object
- **THEN** the usage-contract gate does not require a fabricated Codex grammar

### Requirement: Usage help is progressively disclosed and read-only

The `flow-guide help` action SHALL list the available Codex-invokable skills
when no skill is supplied and SHALL return one usage card when a public skill
name is supplied. A card SHALL expose the inventory `syntax`, positional
inputs, input kind, actions, options, enum values, legacy markers, examples,
invocation class, maximum effect authority, and the evidence state of the
generated catalog. Help SHALL not load the target skill's procedural
references, invoke the target, or grant authority. An unknown name and a
known non-Codex skill SHALL produce distinct diagnostics.

#### Scenario: User requests one usage card

- **WHEN** a user invokes `$flow-guide help flow-drive`
- **THEN** the result returns the Worker Selector syntax,
  `--worker-target=<provider>/<model>[:<effort>]`, bounded retired-option
  diagnostics, and explicit-only authority without loading implementation
  procedures

#### Scenario: Usage card exposes enum values

- **WHEN** an option or input declares `enum_values`
- **THEN** the rendered card shows the allowed values and its summary

#### Scenario: User requests the available usage catalog

- **WHEN** a user invokes `$flow-guide help` without a skill name
- **THEN** the result lists Codex-invokable public names in deterministic order
  with a concise usage summary and no target execution

#### Scenario: Help receives a non-Codex skill

- **WHEN** a user requests `$flow-guide help` for a known skill absent from
  both Codex surfaces
- **THEN** the result reports `not-codex-invokable` and does not invent a usage
  contract

#### Scenario: Help receives an unknown name

- **WHEN** a user requests `$flow-guide help` for a name absent from the
  inventory
- **THEN** the result reports `unknown-skill` and does not resolve a prefix or
  legacy alias

### Requirement: Usage projections have one deterministic source

A generator SHALL compile normalized inventory usage records in public-name
order into the Codex help catalog, supported OpenAI default prompts,
applicable Claude Argument Hints, and the dedicated English and Traditional
Chinese usage documentation. Generated artifacts SHALL identify the source
inventory revision and SHALL fail parity validation when manually edited
content or ordering diverges. Argument Hints SHALL remain compact syntax
projections; parameter meaning SHALL remain in structured metadata and Usage
Cards. Broad hand-maintained cheat sheets MAY link to the generated guide but
SHALL not become a second usage source of truth.

#### Scenario: Inventory usage changes

- **WHEN** an input, action, option, or legacy marker changes in the inventory
  usage contract
- **THEN** the generator updates every applicable usage artifact or the parity
  gate fails with the stale artifact and source record

#### Scenario: A generated usage card is manually changed

- **WHEN** a generated Codex help card differs from the normalized inventory
  record without a generator input change
- **THEN** validation fails and reports the source and generated paths

#### Scenario: A Host lacks live argument completion

- **WHEN** a Host does not expose a documented interactive Argument Hint UI
- **THEN** the generated usage contract remains valid and the Usage Card is
  the supported parameter-discovery path

#### Scenario: Procedure detail is added to a usage contract

- **WHEN** a skill author puts safety procedures or completion instructions in
  inventory `usage` instead of the canonical `SKILL.md` or conditional
  references
- **THEN** the usage schema rejects the unsupported field and keeps the
  procedural content in the skill-owned source

### Requirement: Marketplace usage catalogs bind to the reviewed publication selection

When supplied a compiled marketplace publication view, the usage compiler SHALL select exactly its public stable IDs, validate their inventory-owned usage records, and record the selection digest. IDs MUST be unique inventory identities, and invalid publication views SHALL fail closed. Without a publication view, the existing Codex-surface selection remains the compatibility behavior. A bundled child or Host-only entry MUST NOT be promoted into the common public usage list by scanning directories.

#### Scenario: A marketplace view selects a skill outside a legacy Codex allowlist

- **WHEN** a valid compiled publication view selects that inventory skill
- **THEN** the marketplace usage catalog includes its validated public usage independently of legacy surface membership

#### Scenario: A publication view has duplicate or unknown stable IDs

- **WHEN** the compiler receives duplicate or non-inventory public IDs
- **THEN** it rejects the view without emitting a partial usage catalog

### Requirement: Consolidated families accept natural task input

SCF-REQ-003: The consolidated families SHALL use `$<inventory-public-name> <natural-language-task>` as their default task interface. Short actions SHALL be optional conveniences, including `test`, `build`, and `icon` for `swift`; `check`, `setup`, and `rollout` for `js-static-checks`; and `pending` and `deps` for `change-verdict`. Callers SHALL NOT need to enumerate every responsibility, action, scope, and version selector before describing a task. Entry instructions SHALL remain concise indexes and SHALL load only task-relevant internal resources. Inventory usage and generated help SHALL preserve the applicable invocation class and mode-specific authority; help SHALL grant no execution authority.

#### Scenario: User describes a task directly

- **WHEN** a caller supplies a clear natural-language family task without a short action
- **THEN** the family selects the matching bounded procedure and only its required resources without demanding a complete selector list

#### Scenario: Short action is used

- **WHEN** a caller uses a supported optional short action
- **THEN** the same task boundary, selected resources, output, and authority apply as for the equivalent natural-language request

#### Scenario: Usage projection is regenerated

- **WHEN** a selected family's usage metadata changes
- **THEN** applicable generated cards, prompts, hints, and guides reflect its inventory public name and action authority without publishing predecessor aliases or procedural reference bodies

### Requirement: Consolidated families clarify target scope and version before dependent work

SCF-REQ-004: A consolidated family SHALL identify the target package or subproject before resolving version-dependent guidance. An intentional explicit version override SHALL take precedence; otherwise resolution SHALL use reliable target project lock, manifest, or configuration evidence with its applicable precision. Installed runtimes SHALL describe execution environments rather than establish target compatibility. If missing, conflicting, or ambiguous scope/version evidence affects the task, the family MUST ask for clarification and wait before loading version-specific references or taking dependent actions. It MUST NOT guess the newest version. Migration tasks SHALL establish both inferred or declared source and explicit target versions; cross-version tasks SHALL group resources by their established targets rather than apply one version's rules to all targets. Runtime version resolution SHALL remain independent of dhpk publication manifests.

#### Scenario: Project has no version evidence

- **WHEN** a version-dependent task has no intentional override or reliable target project evidence
- **THEN** the family asks for the target version and waits without loading version-specific guidance or starting dependent work

#### Scenario: Constraint range or evidence is ambiguous

- **WHEN** a range spans incompatible supported versions or lock/configuration evidence conflicts
- **THEN** the family explains the unresolved evidence and waits for clarification rather than silently selecting a version

#### Scenario: Monorepo target is unspecified

- **WHEN** multiple subprojects could own the task and their relevant versions differ
- **THEN** the family asks which package or subproject is targeted before selecting version-specific resources

#### Scenario: Intentional override is supplied

- **WHEN** a caller explicitly requests a target version for the selected package
- **THEN** that override selects the matching resources while detected source/runtime information remains separately identified

#### Scenario: Migration target is missing

- **WHEN** a migration task permits source-version detection but supplies no target version
- **THEN** the family asks for the target and waits before selecting target guidance or making target-dependent changes

#### Scenario: Task covers multiple explicit targets

- **WHEN** a caller establishes distinct versions for multiple target packages
- **THEN** the family loads and applies resources per target and does not substitute one version's guidance for the others
