# agents-skills-compatibility Specification

## Purpose
TBD - created by archiving change add-agents-skills-compatibility-projection. Update Purpose after archive.
## Requirements
### Requirement: Inventory-owned selection remains canonical

The compatibility projection SHALL select public skill entries from the existing inventory-owned shared portable skill selection and SHALL resolve each source to a physical `skills/<name>/SKILL.md` package inside the repository root. The projection SHALL NOT introduce a second skill catalog or allow a source path outside the canonical skills tree.

#### Scenario: Selected skills are projected from canonical sources

- **WHEN** the generator runs against a valid distribution inventory
- **THEN** every emitted skill ID and public name comes from the inventory selection, and every emitted Cursor package resolves to the corresponding canonical `skills/<name>` source

#### Scenario: Unsafe or missing source fails closed

- **WHEN** an inventory entry points outside `skills/` or its `SKILL.md` is missing, symlinked, or not a regular file
- **THEN** generation fails before replacing any existing `.agents/skills` managed output

### Requirement: One generated root supports both documented skill shapes

The projection SHALL materialize `.agents/skills/<public-name>/SKILL.md` packages for Cursor and `.agents/skills/<public-name>.md` direct-file entries for Antigravity. The direct-file entry SHALL use portable frontmatter and SHALL point to the canonical `skills/<public-name>/SKILL.md` package without copying a second full skill body.

#### Scenario: Cursor-compatible package is present

- **WHEN** a selected skill is generated
- **THEN** `.agents/skills/<public-name>/SKILL.md` exists as a regular file with valid skill frontmatter, and the selected package's references/scripts are available under the same directory when they exist canonically

#### Scenario: AGY-compatible direct entry is present

- **WHEN** a selected skill is generated
- **THEN** `.agents/skills/<public-name>.md` exists as a regular file with the selected name and description and contains the explicit workspace-relative canonical source pointer

#### Scenario: Sibling names remain unambiguous

- **WHEN** Cursor and AGY inspect the same generated root
- **THEN** the directory entry `<public-name>` and direct entry `<public-name>.md` coexist without overwriting one another, and validation reports a collision if either managed shape is replaced by a foreign non-managed entry

### Requirement: Projection ownership and regeneration are safe

The generator SHALL write a versioned receipt containing the inventory revision, selected stable IDs, source digests, generated digests, and managed relative paths. Regeneration SHALL preserve foreign entries, SHALL replace only receipt-owned entries, and SHALL fail closed on an invalid or conflicting prior receipt.

#### Scenario: Deterministic regeneration

- **WHEN** the same canonical sources and inventory are generated into two clean output roots
- **THEN** the managed files, receipt content, selected IDs, and fingerprints are byte-identical apart from the caller-selected output path

#### Scenario: Foreign content is preserved

- **WHEN** an unrelated `.agents/skills` entry exists beside a receipt-owned projection
- **THEN** regeneration leaves the unrelated entry unchanged and records it as unmanaged

#### Scenario: Changed managed content is not silently discarded

- **WHEN** a receipt-owned generated file has been modified outside the generator
- **THEN** update reports an ownership/fingerprint collision and does not delete or overwrite that entry

### Requirement: Structural validation is separate from runtime evidence

The validator SHALL verify the receipt schema, inventory selection, source and generated fingerprints, Cursor directory shape, AGY direct-file shape, path containment, and absence of symlinks or secrets in the generated tree. It SHALL report structural PASS independently from optional Cursor or AGY consumer-runtime probes.

#### Scenario: Valid projection passes structural validation

- **WHEN** all managed entries match the receipt and canonical sources
- **THEN** validation returns `PASS` with selected skill counts and no errors

#### Scenario: Stale or unsafe projection fails structural validation

- **WHEN** a managed entry is missing, has drifted, escapes the output root, contains a symlink, or no longer matches its source digest
- **THEN** validation returns `FAIL` with the relative path and a remediation command, without claiming consumer-runtime support

#### Scenario: Consumer CLI is unavailable

- **WHEN** the AGY or Cursor CLI is not installed or a configured runtime probe is not executed
- **THEN** the projection remains structurally verifiable and the runtime evidence is reported as `NOT_RUN`, `UNAVAILABLE`, or `NOT_CONFIGURED`, never as `PASS`

### Requirement: Platform boundaries are documented

The project guidance SHALL identify `.agents/skills` as a generated skills-only compatibility projection and SHALL document the official platform-specific locations for Codex agents/rules, Cursor agents/rules, and AGY plugin agents/rules. It SHALL state that canonical source ownership remains in `skills/`, `agents/`, and `rules/`.

#### Scenario: Maintainer follows the documented setup

- **WHEN** a maintainer reads the platform installation guide
- **THEN** the guide names the generator/validator commands, explains the generated receipt boundary, and does not instruct the maintainer to hand-edit a second skills, agent, or rule copy
