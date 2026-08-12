# cursor-plugin-projection Specification

## Purpose
TBD - created by archiving change align-agent-plugin-platform-support. Update Purpose after archive.
## Requirements
### Requirement: Cursor can consume the portable Agent Plugin unchanged

The generated `agent-plugin` package SHALL be documented and tested as the
portable Cursor path for skills and MCP. A Cursor installation of that package
MUST use the root `plugin.json` format and SHALL NOT require a `.cursor-plugin`
manifest or a duplicate skill rewrite.

#### Scenario: Cursor loads the standard package

- **WHEN** Cursor is given the generated `plugins/dhpk-agent/` directory
- **THEN** Cursor discovers the valid `skills/` and optional `mcp.json` content
  without a Cursor-only manifest, and the report records a portable Cursor
  `PASS` only after an actual client or supported fixture proves discovery

#### Scenario: Cursor tooling is unavailable

- **WHEN** no supported Cursor CLI, local plugin loader, or test fixture is
  available
- **THEN** the report is `UNAVAILABLE` or `BLOCKED`, never `PASS`, and the
  portable package remains documented as structurally conformant only

### Requirement: Cursor-native components use a separate Cursor Plugin surface

The optional `cursor-plugin` surface SHALL be generated as a Cursor Plugin
with `.cursor-plugin/plugin.json`. It MAY include `skills`, `mcpServers`,
`rules`, `agents`, `commands`, `hooks`, and `variables` using Cursor's manifest
and component contracts. Cursor-only components SHALL NOT be added to the
closed portable Agent Plugins manifest. Portable skills SHALL be consumed from
the shared standard Agent Plugin package by default; a physical Cursor
`skills/` projection requires an explicit inventory overlay row.

#### Scenario: Cursor-native package has full component discovery

- **WHEN** the Cursor generator selects a rule, agent, command, hook, or
  variable from the canonical inventory
- **THEN** the package contains valid Cursor frontmatter/configuration and its
  manifest resolves only relative paths inside the package

### Requirement: Shared portable skills have one physical project owner

The capability matrix SHALL mark identical Cursor portable skills as `shared`
when the standard Agent Plugin package is their physical owner. In that mode,
the Cursor native package SHALL not contain a second physical `skills/` tree. Its
provenance SHALL record the shared source surface and selected stable IDs, while
the standard Agent Plugin package remains the sole physical owner. A
Cursor-specific skill copy is valid only for an explicit `overlay` matrix row
that records the transform and fallback.

#### Scenario: Cursor uses the default shared skill store

- **WHEN** `plugins/dhpk-agent/skills/` is selected as the shared portable store
- **THEN** `plugins/dhpk-cursor/` contains no `skills/` directory, and its
  provenance points to the Agent Plugin surface without claiming a second
  generated skill owner

#### Scenario: Cursor needs an environment-specific skill adaptation

- **WHEN** the matrix declares a Cursor `overlay` row for a stable skill ID
- **THEN** only that explicitly selected skill is materialized under the Cursor
  package, with a recorded transform, fallback, and independent fingerprint

#### Scenario: Portable package does not promise Cursor-native features

- **WHEN** a consumer installs only `agent-plugin`
- **THEN** documentation and validation report skills/MCP support only and do
  not claim rules, agents, commands, hooks, or variables are available

### Requirement: Cursor projection preserves canonical identity and policy

Cursor skill, agent, command, and rule projections SHALL preserve stable
inventory IDs and public names, while adapting only the frontmatter and
runtime fields required by Cursor. Any omitted Claude/Codex lifecycle behavior
MUST be recorded in the projection matrix with a reason and fallback.

#### Scenario: Cursor frontmatter needs adaptation

- **WHEN** a canonical agent contains Claude-only frontmatter or a command uses
  Claude namespace syntax
- **THEN** the generated Cursor file retains its public identity, removes
  unsupported fields, and records the adapted invocation/fallback rather than
  copying an invalid definition

#### Scenario: A capability cannot be represented

- **WHEN** a Claude hook or Codex agent feature has no Cursor equivalent
- **THEN** the Cursor report marks that capability `SKIP_INCOMPATIBLE` with the
  source capability and reason, and the package gate does not call it parity

### Requirement: Cursor variables and hooks are safe and reviewable

Cursor `variables` SHALL declare schemas only and SHALL never contain secret
values. Generated hooks SHALL use supported event names, package-contained
commands, and explicit failure behavior. A hook or variable that cannot be
validated SHALL block the Cursor-native publication.

#### Scenario: Secret is embedded in a Cursor package

- **WHEN** a generated manifest or MCP config contains a literal token or
  credential instead of a declared variable placeholder
- **THEN** the Cursor package gate fails and reports the secret-bearing path

#### Scenario: Hook references an escaping command

- **WHEN** `hooks/hooks.json` invokes an absolute or parent-relative command
- **THEN** validation fails before publication and the package is not reported
  as Cursor-compatible

### Requirement: Cursor marketplace and local-install evidence is explicit

The Cursor projection SHALL document its local path, marketplace manifest (if
used), version, source commit, inventory digest, and consumer result. A static
manifest or marketplace listing SHALL not count as runtime discovery evidence.

#### Scenario: Local smoke succeeds

- **WHEN** the projection is loaded from Cursor's documented local plugin path
  and all selected components are discoverable
- **THEN** the evidence records the exact package, client version, component
  counts, and `PASS`

#### Scenario: Marketplace metadata exists without a client probe

- **WHEN** `.cursor-plugin/marketplace.json` is valid but no local or live Cursor
  load was executed
- **THEN** the result remains `NOT_RUN`/`UNAVAILABLE` and cannot graduate
  Cursor support

