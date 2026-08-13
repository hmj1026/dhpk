# agent-plugin-portable-package Specification

## Purpose
TBD - created by archiving change align-agent-plugin-platform-support. Update Purpose after archive.
## Requirements
### Requirement: Portable publication has a canonical Agent Plugins manifest

The generated `agent-plugin` surface SHALL be a self-contained package whose
root contains exactly one portable `plugin.json` manifest. The manifest MUST
include the canonical Agent Plugins 1.0.0 `$schema` identifier and a valid
lowercase plugin `name`, and MUST use only the portable top-level fields
allowed by the Agent Plugins schema. Codex `interface`, `skills`, and other
client-specific fields SHALL NOT be placed in the portable manifest.

#### Scenario: Standard package manifest validates

- **WHEN** the generator creates `plugins/dhpk-agent/`
- **THEN** `plugin.json` contains the Agent Plugins 1.0.0 schema identifier,
  `name: "dhpk"`, optional portable metadata, and no unknown top-level fields

#### Scenario: Legacy Codex fields are not portable fields

- **WHEN** a candidate portable manifest contains `interface`, `skills`, or a
  missing/unsupported `$schema`
- **THEN** the portable validator rejects the candidate and identifies the
  client-specific or missing field without treating the legacy Codex package as
  a valid standard package

### Requirement: Portable skills follow the fixed Agent Skills projection

Every skill published on `agent-plugin` SHALL be an immediate child directory
of `skills/` with a regular `SKILL.md`. Its frontmatter SHALL satisfy the Agent
Skills specification: `name` and `description` are required, the name matches
the directory, and optional fields use only the standard fields or a nested
metadata map. Claude-only invocation fields and Codex `agents/openai.yaml`
policy SHALL remain outside the portable frontmatter contract.

#### Scenario: Canonical skill is projected without client policy leakage

- **WHEN** a canonical `skills/dhpk-*/SKILL.md` has a valid name/description,
  `metadata.dhpk-invocation-class`, and Claude-only fields such as
  `disable-model-invocation`
- **THEN** the generated portable skill preserves the standard name,
  description, body, and allowed resources while moving or omitting
  client-only policy according to the projection rules

#### Scenario: Invalid sibling does not invalidate the whole package

- **WHEN** one projected skill has invalid Agent Skills frontmatter but sibling
  skills are valid
- **THEN** validation reports and skips only that skill, while the package and
  valid sibling skills remain independently inspectable

### Requirement: Portable MCP configuration is schema-versioned and isolated

If the `agent-plugin` package includes `mcp.json`, it SHALL use the matching
Agent Plugins MCP schema and closed top-level `mcpServers` contract. Each entry
MUST declare a supported transport and remain within the package/data boundary;
an invalid entry SHALL not disable valid skills or sibling servers. A package
without `mcp.json` SHALL remain valid.

#### Scenario: Package has no MCP integration

- **WHEN** no canonical MCP server is selected for dhpk
- **THEN** the generated package omits `mcp.json` and still passes portable
  package validation

#### Scenario: One MCP entry is invalid

- **WHEN** one server entry has an unsupported transport or an escaping path
- **THEN** the validator skips that entry, reports the reason, and keeps valid
  skills and independent MCP entries discoverable

### Requirement: Portable package paths are contained and deterministic

All discovered, read, and executable package paths SHALL resolve inside the
filesystem-resolved package root. The generator SHALL reject absolute paths,
parent-relative escapes, and symlink/junction targets outside the root, and
shall produce byte-stable package content, manifest metadata, and provenance
for identical inventory, source, and version inputs.

#### Scenario: Escaping projection is rejected

- **WHEN** a candidate manifest or skill resource resolves outside
  `plugins/dhpk-agent/`
- **THEN** the package gate fails before publication and names the escaping
  path

#### Scenario: Repeated generation is stable

- **WHEN** the generator runs twice with unchanged canonical sources, inventory,
  generator version, and release version
- **THEN** package files, manifest, selected IDs, and fingerprints are
  byte-identical

### Requirement: Client extensions do not expand the portable core

Client-specific manifest data SHALL use a stable reverse-domain namespace under
`extensions`, and client-specific files SHALL use a matching top-level
namespace directory. Unsupported namespaces SHALL be ignored by portable
clients. The dhpk standard package SHALL not depend on an extension for its
portable skill behavior.

#### Scenario: Unknown extension is present

- **WHEN** a package contains an extension namespace not implemented by a
  client
- **THEN** the client ignores that namespace and still loads valid portable
  skills and MCP configuration

#### Scenario: Client policy is required for a feature

- **WHEN** a feature needs Claude, Codex, or Cursor-specific lifecycle,
  invocation, hook, or UI behavior
- **THEN** that feature is emitted in the owning client projection or namespace
  and is not added as an unknown portable top-level manifest field

