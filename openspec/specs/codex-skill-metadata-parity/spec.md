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

Every Codex-visible skill SHALL continue to provide the exact canonical
`agents/openai.yaml` contract with `interface.display_name`,
`interface.short_description`, and a `$<skill-name>` default prompt. The same
skill's portable Agent Plugins projection SHALL use only Agent Skills
frontmatter and SHALL not require `openai.yaml` for standard discovery. The
stable inventory ID, public name, and any client-specific adaptation SHALL be
recorded in surface-scoped provenance.

#### Scenario: Standard client ignores Codex metadata safely

- **WHEN** an Agent Plugins client discovers a projected skill containing
  Codex-only `agents/openai.yaml`
- **THEN** the client loads the standard `SKILL.md` contract without treating
  `openai.yaml` as portable frontmatter or a required invocation mechanism

#### Scenario: Codex default prompt drifts

- **WHEN** a Codex `openai.yaml` default prompt names a `$<name>` different from
  the canonical public skill name
- **THEN** the Codex metadata gate fails with both the source ID and metadata
  path, while the portable package check remains independently reportable

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

For every `portable-family` skill, the canonical public name SHALL be the unprefixed inventory name. Codex `agents/openai.yaml` default prompts, portable Agent Skills frontmatter, generated package paths, receipts, and documentation MUST use that exact name without injecting or stripping a client-specific prefix; the host plugin namespace remains separate from the skill identity.

#### Scenario: Codex metadata names a reborn family
- **WHEN** Codex metadata is generated for one of the six capability families
- **THEN** its default prompt names `$skill-scope`, `$skill-forge`, `$flow-guide`, `$flow-drive`, `$change-verdict`, or `$code-trace` exactly as selected by the corresponding stable ID

#### Scenario: Client adds a legacy prefix
- **WHEN** a generated client package changes a portable-family public name to `dhpk-<name>`
- **THEN** metadata-parity validation fails with the stable ID, canonical name, and emitted name
