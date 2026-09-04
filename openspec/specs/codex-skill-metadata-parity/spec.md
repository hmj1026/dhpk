# codex-skill-metadata-parity Specification

## Purpose
Define the cross-harness metadata contract that keeps canonical skill
classification, portable Agent Plugins projections, Claude restrictions, and
Codex metadata aligned while reporting structural evidence separately from
runtime callability.

## Requirements

### Requirement: Claude and Codex invocation restrictions agree
For every Distributed Skill available to both harnesses, an explicit-only classification SHALL produce Claude `disable-model-invocation: true` and Codex `policy.allow_implicit_invocation: false`. An implicit-eligible classification SHALL not retain either restrictive flag.

#### Scenario: Claude is explicit-only but Codex is implicit
- **WHEN** a shared skill is explicit-only in canonical and Claude metadata but Codex metadata permits implicit invocation
- **THEN** metadata-parity validation fails with both metadata locations

#### Scenario: Implicit-eligible skill retains stale restriction
- **WHEN** a skill is classified implicit-eligible but one harness still disables implicit invocation
- **THEN** metadata-parity validation fails until the stale restriction is removed

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
- **THEN** the Codex metadata gate fails with both the source identity and metadata
  path, while the portable package check remains independently reportable

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

### Requirement: Callable-surface claims use discovered content

Codex, Agent Plugins, and Cursor documentation SHALL list a skill, agent,
command, rule, hook, or MCP server as callable only when that exact surface
has verified discovered content. A plugin manifest, marketplace entry,
generated file, or installed/enabled status alone SHALL not prove runtime
callability. Claims SHALL identify the surface and evidence state.

#### Scenario: Portable package is present but not loaded

- **WHEN** `plugins/dhpk-agent/plugin.json` exists but no supported client load
  or package discovery check has run
- **THEN** documentation reports structural/package status only and does not
  claim the skill is callable in Codex or Cursor

#### Scenario: Cursor-native component is unavailable

- **WHEN** a Cursor rule or hook is generated but the client cannot load that
  component type
- **THEN** the report marks the component `SKIP_INCOMPATIBLE` or `UNAVAILABLE`
  with a fallback and excludes it from parity counts

### Requirement: Cross-harness classification changes are atomic

A change to a shared skill's invocation class or public family identity SHALL update its canonical frontmatter, inventory name style, Claude metadata, Codex metadata, route documentation, selected profiles, generated projections, receipts, and parity tests in the same implementation change. A retired predecessor SHALL disappear from every generated harness in the same wave that its successor appears.

#### Scenario: Only Claude metadata is updated
- **WHEN** a classification or capability-family replacement modifies one harness but leaves another harness, profile, receipt, or route document stale
- **THEN** the standard validation suite fails before release and identifies every divergent identity

### Requirement: Claude-only commands do not invent Codex parity
An unpaired Distributed Command SHALL be validated against its own canonical class and Claude restriction. Validation SHALL NOT require fabricated Codex metadata unless a corresponding Codex skill is actually distributed.

#### Scenario: Command has no Codex counterpart
- **WHEN** an unpaired command-only entry is classified and no corresponding Codex skill exists
- **THEN** Claude validation applies and Codex parity is reported as not applicable

### Requirement: Client policy metadata is namespaced and non-authoritative for portable behavior

Client policy metadata SHALL remain namespaced and non-authoritative for portable behavior.
Claude invocation flags, Codex `policy.allow_implicit_invocation`, Cursor rule frontmatter,
and other client controls remain in their owning surface.
The portable skill may retain dhpk classification as a nested metadata value,
but no client policy field may be interpreted as a portable Agent Skills
requirement.

#### Scenario: One client changes invocation policy

- **WHEN** an explicit-only classification changes for Claude or Codex
- **THEN** the owning metadata, parity checks, and route documentation change
  together without adding a non-standard portable frontmatter field

#### Scenario: Portable metadata is consumed by multiple clients

- **WHEN** Codex and Cursor load the same portable skill
- **THEN** both clients can use the standard name/description/body while
  ignoring unimplemented policy metadata without changing skill identity

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
