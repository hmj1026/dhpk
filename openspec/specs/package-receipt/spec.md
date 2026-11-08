# package-receipt Specification

## Purpose

Give the Package Receipt — the `provenance.json` and `fingerprints.json` shipped inside each generated Host package — one owner, so its per-surface ordering, serialization, and file shape are decided in one place and every format-dependent reader reads and verifies it the same way (#1241).

## Requirements

### Requirement: One owner for the Package Receipt format

The Package Receipt format of every generated Host package (agent, Cursor, Codex, AGY) SHALL be defined in one module: the per-surface inventory-digest ordering, serialization, `fingerprints.json` shape, and schema. Package generators SHALL serialize their receipts through it. Every reader whose result depends on the format — byte comparison, digest ordering, `fingerprints.json` shape, the recipe marker, or ownership — SHALL read and verify receipts through it; a reader that only takes one recorded field (such as `sourceCommit` or `sourceVersion`) MAY parse `provenance.json` directly.

#### Scenario: Round trip of a tracked package

- **WHEN** the module reads the tracked `provenance.json` and `fingerprints.json` of any generated Host package and serializes them again for that surface
- **THEN** both files are byte-identical to the tracked files

#### Scenario: Recomputed digest follows the surface ordering

- **WHEN** a release gate recomputes a package's inventory digest
- **THEN** it uses the ordering the module assigns to that package's surface

### Requirement: Fail-closed reading

Reading a Package Receipt SHALL fail when either file is missing or unparseable, when a required common or surface field is missing or malformed, or when the fingerprint recipe marker is missing or unknown; unknown fields SHALL be ignored.

#### Scenario: Tampered digest

- **WHEN** a receipt's fingerprint for a file does not match the file's content
- **THEN** verification reports that file and the receipt is not accepted

#### Scenario: Ownership without metadata

- **WHEN** an installed AGY copy has a valid `provenance.json` but a missing or damaged `fingerprints.json`
- **THEN** ownership is still proven and the copy is classified as owned and changed, not unowned

#### Scenario: Missing recipe marker

- **WHEN** `provenance.json` has no `fingerprintAlgorithm` on a surface that requires it
- **THEN** reading fails with the version-boundary diagnostic

### Requirement: No byte change

Moving the format into one owner SHALL NOT change any byte of a generated package or of an installed AGY receipt.

#### Scenario: Regeneration

- **WHEN** every package is regenerated from the same clean commit
- **THEN** the package verification reports no difference
