## MODIFIED Requirements

### Requirement: Agent discovery returns only invocable definitions

`multi-ai-sync` and unified lifecycle verification SHALL count a file as an
agent only when it has a supported agent-definition extension, is located on
the active harness's declared agent surface, satisfies that harness's required
definition metadata/frontmatter, and matches an inventory-owned stable ID and
fingerprint for that surface. Portable skills and Codex-native entries SHALL
not be promoted into another surface's agent inventory by path or count.

#### Scenario: Valid agent definition is present

- **WHEN** a file is on the declared agent surface, contains the required
  definition metadata, and matches the inventory ID and fingerprint
- **THEN** discovery includes it exactly once in parity comparison

#### Scenario: Candidate file is malformed

- **WHEN** a candidate definition has the correct extension and location but
  lacks required metadata/frontmatter or has a mismatched fingerprint
- **THEN** discovery reports a validation failure and does not count it as an
  agent

#### Scenario: Codex-native count is used on Cursor

- **WHEN** the 15-entry `codex-native` set is supplied as the Cursor agent
  inventory
- **THEN** discovery reports `WRONG_SURFACE` and does not count those entries
  as the Cursor profile

### Requirement: Cursor-native agent discovery uses the declared surface

Multi-platform discovery SHALL count a Cursor agent only when it is a valid
Markdown definition under the active Cursor Plugin package `agents/` surface
or its lifecycle materialized `.cursor/agents` target and has the required
`name` and `description` frontmatter. The definition SHALL match the
inventory-owned profile and stable ID. A root Agent Plugins package SHALL not
be counted as providing agents merely because it contains skills or arbitrary
Markdown resources.

#### Scenario: Valid Cursor agent is discoverable

- **WHEN** `plugins/dhpk-cursor/agents/security-reviewer.md` is valid and its
  lifecycle projection is present at `.cursor/agents/security-reviewer.md`
  with matching frontmatter and fingerprint
- **THEN** discovery includes it once in the Cursor-native inventory

#### Scenario: Portable skill resource is not an agent

- **WHEN** `plugins/dhpk-agent/skills/review/references/agent-notes.md` exists
- **THEN** discovery excludes it from Cursor and Codex agent counts

#### Scenario: Cursor package is missing from a paired route

- **WHEN** `dhpk-agent` is present but `dhpk-cursor` or its declared agents
  surface is absent
- **THEN** discovery reports the portable inventory separately and marks the
  combined Cursor-native route BLOCKED

## ADDED Requirements

### Requirement: Cursor profile discovery validates exact IDs and dispatch evidence

Cursor discovery SHALL validate the inventory-owned `core`, `extended`, and
`full` profiles, repeatable explicit agent additions, exact public names,
required frontmatter, and source/destination fingerprints. A runtime Cursor
parity result SHALL additionally carry a real discovery/dispatch nonce tied to
the current lifecycle plan/receipt and selected stable IDs; static package
files and receipts alone are not runtime evidence.

#### Scenario: Core profile has exact identity

- **WHEN** `.cursor/agents` contains exactly `architect`, `deep-reasoner`,
  `tdd-guide`, `code-reviewer`, and `security-reviewer` with required
  frontmatter and matching fingerprints
- **THEN** discovery records the five stable IDs once and passes the core
  profile inventory check

#### Scenario: Full profile contains stale or duplicate entries

- **WHEN** the full profile includes a deprecated agent, a duplicate public
  name, or an entry absent from the current 31-agent inventory
- **THEN** discovery reports the exact stale/duplicate entry and does not
  report a clean full profile

#### Scenario: Real dispatch nonce is absent

- **WHEN** static Cursor discovery passes but no live Cursor probe returns a
  nonce tied to the current receipt and selected IDs
- **THEN** the report remains `NOT_RUN`, `BLOCKED`, or `UNAVAILABLE` and does
  not claim runtime agent parity

### Requirement: Navigation and generated evidence remain excluded after projection

Cursor and Codex discovery SHALL exclude `INDEX.md`, `README.md`, provenance,
fingerprint, lifecycle receipt, plan, nonce, and other configured navigation or
evidence files before definition parsing. The same exclusion policy SHALL
apply to canonical packages, staged roots, installed roots, and generated
inventories.

#### Scenario: A staged Cursor root contains evidence files

- **WHEN** `.cursor/agents/receipt.json` or `agents/README.md` contains fields
  resembling agent frontmatter
- **THEN** discovery excludes those files from counts, parity diffs, plans,
  and dispatch candidates
