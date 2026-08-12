## ADDED Requirements

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
generated inventories.

#### Scenario: Cursor agent directory contains a README

- **WHEN** `agents/README.md` sits beside valid Cursor agent definitions
- **THEN** the README is absent from counts, parity diffs, plans, and generated
  agent definitions

#### Scenario: Evidence resembles frontmatter

- **WHEN** a provenance file contains `name` and `description` examples
- **THEN** its configured evidence basename prevents it from being treated as
  an invocable agent
