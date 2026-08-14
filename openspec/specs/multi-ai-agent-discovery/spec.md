# multi-ai-agent-discovery Specification

## Purpose
TBD - created by archiving change scope-multi-ai-sync-validation-to-configured-platforms. Update Purpose after archive.
## Requirements
### Requirement: Agent discovery returns only invocable definitions
`multi-ai-sync` SHALL count a file as an agent only when it has a supported agent-definition extension, is located on the active harness's declared agent surface, and satisfies that harness's required definition metadata.

#### Scenario: Valid agent definition is present
- **WHEN** a file is on the declared agent surface and contains the required definition metadata
- **THEN** discovery includes it exactly once in parity comparison

#### Scenario: Candidate file is malformed
- **WHEN** a candidate definition has the correct extension and location but lacks required metadata
- **THEN** discovery reports a validation failure and does not count it as an agent

### Requirement: Navigation and roster files are excluded from agent discovery
Agent discovery SHALL exclude non-invocable navigation, roster, and explanatory documents, including `INDEX.md` and `README.md`, before definition parsing. The exclusion SHALL apply consistently to canonical and target inventories.

#### Scenario: Agent directory contains INDEX.md
- **WHEN** an agent directory contains valid definitions plus `INDEX.md`
- **THEN** the index is absent from agent counts, parity diffs, plans, and generated target definitions

#### Scenario: Navigation content resembles metadata
- **WHEN** a navigation document contains examples or tables that resemble agent fields
- **THEN** its excluded basename prevents it from being treated as an invocable definition

### Requirement: Cursor-native agent discovery uses the declared surface

Multi-platform discovery SHALL count a Cursor agent only when it is a valid
Markdown definition under the active Cursor Plugin `agents/` surface and has
the required `name` and `description` frontmatter. A root Agent Plugins
package SHALL not be counted as providing agents merely because it contains
skills or arbitrary Markdown resources.

#### Scenario: Valid Cursor agent is discoverable

- **WHEN** `plugins/dhpk-cursor/agents/security-reviewer.md` has valid Cursor
  frontmatter and is registered or discoverable by its manifest
- **THEN** discovery includes it once in the Cursor-native inventory

#### Scenario: Portable skill resource is not an agent

- **WHEN** `plugins/dhpk-agent/skills/review/references/agent-notes.md` exists
- **THEN** discovery excludes it from Cursor and Codex agent counts

### Requirement: Navigation and generated evidence are excluded consistently

Cursor and Codex discovery SHALL exclude `INDEX.md`, `README.md`, provenance,
fingerprint, receipt, and other configured navigation/evidence files before
definition parsing. The same exclusion policy SHALL apply to canonical and
generated inventories, including the native AGY `agents/` package.

#### Scenario: Cursor agent directory contains a README

- **WHEN** `agents/README.md` sits beside valid Cursor agent definitions
- **THEN** the README is absent from counts, parity diffs, plans, and generated
  agent definitions

#### Scenario: Evidence resembles frontmatter

- **WHEN** a provenance file contains `name` and `description` examples
- **THEN** its configured evidence basename prevents it from being treated as
  an invocable agent

#### Scenario: AGY package excludes navigation and receipt files

- **WHEN** `plugins/dhpk-agy/agents/` contains adapted definitions alongside
  `INDEX.md`, `README.md`, provenance, or fingerprint evidence
- **THEN** AGY discovery counts only adapted agent definitions and reports the
  excluded files separately from the invocable roster
