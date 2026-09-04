## MODIFIED Requirements

### Requirement: Codex skill metadata is complete and exact

Every Codex-visible skill SHALL provide the supported canonical
`agents/openai.yaml` interface with `display_name`, `short_description`, and a
`default_prompt` that invokes the exact canonical `$<skill-name>`. The
inventory `usage` contract remains the source for public syntax, actions,
options, authority, and generated help; those fields SHALL not be copied into
OpenAI metadata. The same skill's portable Agent Plugins projection SHALL use
only Agent Skills frontmatter and SHALL not require `openai.yaml` for standard
discovery. Stable inventory ID, public name, usage fingerprint, and any
client-specific adaptation SHALL be recorded in surface-scoped provenance.

#### Scenario: Codex default prompt names the wrong skill

- **WHEN** a Codex `default_prompt` invokes a `$<name>` different from the
  canonical public skill name
- **THEN** Codex metadata validation fails with the canonical identity and
  metadata path

#### Scenario: OpenAI metadata omits a required interface field

- **WHEN** a Codex-visible skill lacks `display_name`, `short_description`, or
  `default_prompt`
- **THEN** metadata validation fails before projection parity can pass

#### Scenario: Usage grammar is copied into openai.yaml

- **WHEN** `agents/openai.yaml` declares `usage`, `actions`, `options`,
  `input_kind`, or `authority` as metadata fields
- **THEN** supported-metadata validation fails and directs the fields back to
  the inventory usage contract

#### Scenario: Portable projection ignores Codex-only metadata

- **WHEN** an Agent Plugins client discovers a projected skill containing
  `agents/openai.yaml`
- **THEN** it loads the standard `SKILL.md` contract without treating
  `openai.yaml` as portable frontmatter or a required invocation mechanism

#### Scenario: Standard client ignores Codex metadata safely

- **WHEN** an Agent Plugins client discovers a projected skill containing
  Codex-only `agents/openai.yaml`
- **THEN** it loads the standard `SKILL.md` contract without treating
  `openai.yaml` as portable frontmatter or a required invocation mechanism

#### Scenario: Codex default prompt drifts

- **WHEN** a Codex `openai.yaml` default prompt names a `$<name>` different from
  the canonical public skill name
- **THEN** the Codex metadata gate fails with both the source identity and
  metadata path, while the portable package check remains independently
  reportable

### Requirement: OpenAI metadata uses only supported fields

The canonical `agents/openai.yaml` contract SHALL contain one `interface`
mapping with exactly `display_name`, `short_description`, and
`default_prompt`. It MAY contain one `policy` mapping whose only supported key
is the boolean `allow_implicit_invocation`; explicit-only skills SHALL set it
to `false`, while implicit-eligible skills SHALL omit the restrictive policy.
Unknown top-level mappings, unknown interface keys, unknown policy keys,
custom argument schemas, and client-specific usage fields SHALL fail
validation. OpenAI metadata SHALL remain a projection of inventory identity and
invocation class, not an independent behavior or grammar source.

#### Scenario: Unsupported interface key is added

- **WHEN** `agents/openai.yaml` contains `interface.actions` or another key
  outside the three supported interface fields
- **THEN** metadata validation fails and names the unsupported key

#### Scenario: Unsupported top-level usage block is added

- **WHEN** `agents/openai.yaml` contains a top-level `usage`, `arguments`, or
  custom schema block
- **THEN** metadata validation fails before package generation

#### Scenario: Explicit-only policy is missing

- **WHEN** a Codex-visible skill is explicit-only but its `agents/openai.yaml`
  has no `policy.allow_implicit_invocation: false`
- **THEN** metadata-parity validation fails with the canonical invocation class

#### Scenario: Implicit-eligible skill retains a restrictive policy

- **WHEN** an implicit-eligible skill declares
  `policy.allow_implicit_invocation: false`
- **THEN** metadata-parity validation fails as a stale restriction

### Requirement: Portable-family public names are exact across clients

For every inventory row marked `name_style: portable-family`, the canonical
public name SHALL be the unprefixed inventory name. Codex
`agents/openai.yaml` default prompts, portable Agent Skills frontmatter,
generated package paths, receipts, and documentation MUST use that exact name
without injecting or stripping a client-specific prefix; the host plugin
namespace remains separate from the skill identity. The reviewed portable set
for this change is `skill-scope`, `skill-forge`, `flow-guide`, `flow-drive`,
`change-verdict`, `code-trace`, `laravel`, `phpunit`, and `harness-govern`.

#### Scenario: Codex metadata names a new portable family

- **WHEN** Codex metadata is generated for `laravel`, `phpunit`, or
  `harness-govern`
- **THEN** its default prompt invokes `$laravel`, `$phpunit`, or
  `$harness-govern` exactly and no `dhpk-` prefix is inserted

#### Scenario: Client adds a legacy prefix

- **WHEN** a generated client package changes a portable-family public name to
  `dhpk-<name>`
- **THEN** metadata-parity validation fails with the stable ID, canonical name,
  and emitted name

#### Scenario: Codex metadata names a reborn family

- **WHEN** Codex metadata is generated for a reviewed portable family
- **THEN** its default prompt names the exact unprefixed public identity from
  inventory and never synthesizes a `dhpk-` prefix
