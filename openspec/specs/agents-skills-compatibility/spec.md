# agents-skills-compatibility Specification

## Purpose

Define the generated `.agents/skills` compatibility projection for Cursor and
AGY, including canonical source ownership, receipt-safe updates, structural
validation, and the boundary between projection structure and consumer
runtime evidence.

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
- **THEN** regeneration leaves the unrelated entry unchanged and does not list it in the receipt

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

### Requirement: Marketplace package evidence is separate from compatibility projection

The OpenAI portable marketplace package SHALL use its own selection and
package receipt. Its structural result SHALL NOT replace the shared portable
selection, receipt, or consumer evidence for the `.agents/skills`
compatibility projection.

#### Scenario: Marketplace package does not replace the compatibility projection

- **WHEN** the OpenAI portable marketplace package passes structural validation
- **THEN** the `.agents/skills` projection remains governed by its own shared portable selection and receipt, and the marketplace result does not claim Cursor or AGY discovery/runtime verification

### Requirement: Carried legacy entries become Released Entries

When the agents-skills generator updates a receipt that carries entries it cannot recompute with `tree-merkle-v1` (entries kept in a receipt written by 0.69.x: generator version `1.1.0`, no `fingerprint_algorithm`, legacy values), it SHALL remove each such entry from the receipt, leave its files in place, and list it in the command output as a Released Entry. It SHALL then write the whole receipt with `fingerprint_algorithm: "tree-merkle-v1"` and `tree-merkle-v1` values for every remaining entry. A carried legacy entry SHALL NOT make the update that releases it fail; afterwards its files are unowned and later materializations apply the existing ownership rules to them. This precondition (generator version `1.1.0`, no marker) is the only marker-less agents-skills receipt the generator reads. A marker-less receipt with any other generator version SHALL fail closed with the version-boundary diagnostic of `content-fingerprint-ownership`.

#### Scenario: Carried legacy entry is released

- **WHEN** an update runs against a `1.1.0` receipt without `fingerprint_algorithm` that carries an entry whose skill is no longer selected
- **THEN** the entry is absent from the written receipt, its managed files are still on disk, the output lists the entry as released, and the written receipt carries `fingerprint_algorithm: "tree-merkle-v1"`

#### Scenario: Receipt with no carried entries rewrites normally

- **WHEN** an update runs against a `1.1.0` receipt without `fingerprint_algorithm` and no entry is carried
- **THEN** no entry is released and the written receipt carries `tree-merkle-v1` values for every entry

#### Scenario: Old generator version fails closed

- **WHEN** an update reads a receipt with generator version `1.0.0`
- **THEN** it fails with the version-boundary diagnostic and writes nothing
