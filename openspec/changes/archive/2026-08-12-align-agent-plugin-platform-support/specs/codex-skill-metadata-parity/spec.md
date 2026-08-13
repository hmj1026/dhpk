## MODIFIED Requirements

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

## ADDED Requirements

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
