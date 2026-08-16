# agy-cli-subagent-plugin Specification

## Purpose

Define the inventory-owned Antigravity native plugin projection and the
evidence boundary between adapted agent files, AGY discovery, and runtime
Subagent execution.

## Requirements

### Requirement: AGY publication is an explicit inventory surface

The distribution inventory SHALL define an `agy-plugin` surface with a stable
adapter identity, transform version, physical owner, selected component IDs,
and verification stages. The generated package SHALL be derived from canonical
agent, skill, rule, hook, and MCP sources and SHALL be materialized under the
`plugins/dhpk-agy/` source package before installation at
`~/.gemini/config/plugins/dhpk/`.

#### Scenario: Inventory selects a valid AGY package

- **WHEN** the inventory contains valid `agy-plugin` entries and canonical
  sources are present
- **THEN** generation produces one package with stable IDs and no component
  selected only because it happens to exist in a directory

#### Scenario: Undeclared component is present

- **WHEN** an agent, skill, rule, hook, or MCP file exists under the generated
  package but has no `agy-plugin` inventory entry
- **THEN** validation fails and does not publish the package

### Requirement: AGY package layout is schema-valid and contained

An AGY package SHALL contain a `plugin.json` manifest with `name: "dhpk"` and
the required AGY package metadata, plus only declared optional
`mcp_config.json` and `hooks.json` files and the inventory-selected
`rules/`, `skills/`, and `agents/` roots. Every discovered path SHALL resolve
inside the package root; absolute paths, parent escapes, and disallowed
symlinks SHALL fail closed.

#### Scenario: Package has the required roots

- **WHEN** the generator materializes a package from a valid inventory
- **THEN** the manifest and selected roots exist at the expected paths and
  package validation passes structurally

#### Scenario: Package path escapes its owner

- **WHEN** a manifest entry, resource, or symlink resolves outside the AGY
  package root
- **THEN** validation returns a path-escape failure and publishes nothing

### Requirement: Agent frontmatter is adapted without changing canonical sources

The AGY adapter SHALL accept `tools:` as either a YAML/JSON array or a
comma-separated scalar and SHALL emit one deterministic array. It SHALL map
`Read` to `read_file`, `Write` to `write_to_file`, `Edit` to
`replace_file_content`, `Bash` to `run_command`, `Grep` to `grep_search`,
`Glob` to `glob`, `WebSearch` to `search_web`, `WebFetch` to
`read_url_content`, `Agent` and `Skill` to `invoke_subagent`, and normalize
`mcp__server__tool` to `mcp_server_tool`. The adapter SHALL map models as
`opus → pro`, `sonnet → pro`, `fable → flash`, `haiku → flash_lite`, preserve
valid AGY enum values, and use `inherit` when no model is declared.

#### Scenario: Claude-style frontmatter is adapted

- **WHEN** an agent contains `tools: Read, Grep, Glob`, `model: sonnet`, and
  a normal Markdown body
- **THEN** the generated agent contains an array of AGY tool names,
  `model: pro`, and the unchanged body

#### Scenario: Adaptation is idempotent

- **WHEN** the adapter runs twice on an already adapted agent
- **THEN** the second output is byte-identical and reports no further change

#### Scenario: Unknown model is encountered

- **WHEN** an agent declares a model outside the supported AGY enum and the
  compatibility matrix has no alias
- **THEN** adaptation fails with the agent path and model value rather than
  silently selecting a fallback

### Requirement: Unsupported Claude metadata is removed with an audit result

The generated AGY frontmatter SHALL contain only the AGY allowlist
(`name`, `description`, `tools`, and `model`). Claude-only fields such as
`effort`, `maxTurns`, `color`, and `skills` SHALL be removed from the
projection. The adapter result SHALL list every dropped field and warning;
canonical source files SHALL remain unchanged.

#### Scenario: Unsupported fields are projected safely

- **WHEN** an agent contains `effort`, `maxTurns`, `color`, or `skills`
- **THEN** those keys are absent from the AGY file, the result records them in
  `droppedFields`, and the source agent is byte-identical

#### Scenario: Unsupported field is not silently accepted

- **WHEN** a new non-allowlisted field appears in a source agent
- **THEN** the projection records the field and validation requires an explicit
  compatibility decision before publication

### Requirement: Package provenance is owner-scoped and deterministic

Every generated AGY package SHALL carry or reference a receipt containing the
surface name, schema/version, generator identity, source version, inventory
digest, selected stable IDs, transform identities, output fingerprints, and
package root. Repeated generation with equivalent inputs SHALL produce the same
normalized output and receipt fingerprints.

#### Scenario: Equivalent package generation is stable

- **WHEN** canonical sources, inventory, generator version, and package version
  are unchanged
- **THEN** generated files, selected IDs, and fingerprints are byte-identical

#### Scenario: Foreign receipt is presented

- **WHEN** a receipt for another surface is used to validate an AGY package
- **THEN** validation reports an ownership mismatch and does not claim AGY
  package validity

### Requirement: Installation and rollback preserve independent ownership

Installation SHALL copy or link only the generated AGY package into
`~/.gemini/config/plugins/dhpk/` and SHALL record ownership in an AGY receipt.
The installer SHALL additionally expose read-only `plan` and `status` actions
that classify the target and report bounded source/target evidence without
mutation. Update, uninstall, and rollback SHALL remove or restore only files
matching that receipt; user-owned files and other Claude, Codex, Cursor, or
AGY surfaces SHALL be preserved. A collision without matching ownership SHALL
fail closed, be distinguishable as a foreign checkout when a physical `.git`
marker is present, and require an explicit owner decision.

#### Scenario: AGY-owned package is rolled back

- **WHEN** a generated AGY package has a failed consumer check and its receipt
  matches the target files
- **THEN** rollback removes only AGY-owned files and receipt data

#### Scenario: User file collides with AGY output

- **WHEN** installation finds an edited target file without matching AGY
  ownership
- **THEN** installation reports a collision and leaves the file untouched

#### Scenario: Foreign checkout is diagnosed before installation

- **WHEN** read-only plan/status sees a physical `.git` target without a
  matching AGY receipt
- **THEN** it returns `BLOCKED`/`FOREIGN_CHECKOUT` evidence and requires an
  independent owner action before a clean install

### Requirement: AGY verification reports separate support states

The AGY verification flow SHALL report structural/package validation,
`agy plugins list`, `agy agents`, and runtime Subagent invocation as separate
evidence rows. The closed status vocabulary SHALL be `PASS`, `FAIL`, `NOT_RUN`,
`NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, and `UNAVAILABLE`. A static
manifest or discovery result SHALL NOT upgrade runtime support.

#### Scenario: AGY CLI is unavailable

- **WHEN** the package is structurally valid but `agy` is not on `PATH`
- **THEN** structural evidence may be `PASS`, while consumer evidence is
  `UNAVAILABLE` and no runtime support claim is emitted

#### Scenario: Discovery succeeds without invocation

- **WHEN** `agy agents` lists the inventory-derived roster but no Subagent
  invocation has run
- **THEN** discovery is recorded independently and runtime remains `NOT_RUN`

#### Scenario: Isolated native discovery ignores import records

- **WHEN** `agy plugins list` returns only import JSON or "No imported plugins"
  and isolated `agy agents` does not list an inventory-derived agent
- **THEN** plugin discovery does not PASS from the import record, and agent
  discovery is `FAIL` or `UNAVAILABLE`

#### Scenario: Native package is mounted at the consumer path

- **WHEN** the read-only AGY sandbox runs discovery against a structurally
  valid package
- **THEN** the package is bound at `/home/agy/.gemini/config/plugins/dhpk`
  rather than a workspace copy, so isolated `agy agents` can load the native
  plugin

#### Scenario: Read-only Subagent probe passes

- **WHEN** the configured AGY CLI discovers the package and completes the
  bounded read-only Subagent smoke prompt with the expected agent identity
- **THEN** the consumer-runtime row is `PASS` and includes the exact version,
  package receipt, and redacted probe evidence
