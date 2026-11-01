# content-fingerprint-ownership Specification

## Purpose

Keep every digest that dhpk persists in a checked-in file and later re-computes
for comparison owned by one implementation per algorithm, so a writer and its
verifier cannot diverge and consolidation never changes a persisted value.

## Requirements

### Requirement: Persisted digests have one implementation per algorithm

Each digest algorithm whose result is persisted in a checked-in file and later
re-computed for comparison SHALL be implemented once, in `scripts/lib/content-fingerprint.js`.
The writer that persists the value and every verifier that re-computes it SHALL
call that same implementation. The module SHALL expose one named function per
algorithm and SHALL NOT silently merge algorithms whose bytes differ.

#### Scenario: Writer and verifier share the function

- **WHEN** a package generator persists a fingerprint and the package validator re-computes it
- **THEN** both obtain the value from the same named function in the shared module, and a test fails if either side computes it locally

#### Scenario: Byte-identical copies are removed

- **WHEN** the repository is searched for local `digest(value)`, `digestJson`, `canonical`, and inventory-digest helpers in the in-scope files
- **THEN** none remain outside the shared module, except the documented ledgered-source exception

### Requirement: Consolidation does not change persisted values

Moving a digest into the shared module SHALL NOT change any persisted value.
Characterization tests with golden vectors taken from real checked-in fixtures
SHALL pass before any call site moves and after every call site moves. Packages
regenerated outside the checkout SHALL have `fingerprints.json` and
`provenance.json` digests byte-identical to the checked-in packages.

#### Scenario: Golden vectors hold across the move

- **WHEN** the characterization tests run against the shared module
- **THEN** each named function returns the value recorded from the pre-change implementation for the same fixture input

#### Scenario: Regenerated packages are byte-identical

- **WHEN** `plugins/dhpk`, `plugins/dhpk-agent`, `plugins/dhpk-agy`, and `plugins/dhpk-cursor` are regenerated outside the checkout
- **THEN** every `fingerprints.json` value and every `provenance.json` digest equals the checked-in value

### Requirement: Writer and verifier of one fingerprint converge on the persisted behavior

Where a writer and a verifier of the same persisted fingerprint used different
implementations (in-memory file list versus disk walk, in-memory Merkle versus
disk Merkle, byte digest versus string digest), both SHALL use one function
that reproduces the persisted value. When the two old implementations disagree
on any real package content, the change SHALL stop and record the disagreement
as a blocker instead of choosing silently.

#### Scenario: Persisted fingerprints are re-computed from disk

- **WHEN** the verifier re-computes each `plugins/dhpk/fingerprints.json`, `plugins/dhpk-agent/fingerprints.json`, and `plugins/dhpk-cursor/fingerprints.json` entry from the package on disk
- **THEN** every re-computed value equals the persisted value

#### Scenario: Cursor persisted fingerprints are verified

- **WHEN** the Cursor package validator runs on a package whose `fingerprints.json` entry no longer matches its tree
- **THEN** validation fails and names the drifted entry

#### Scenario: Supporting-asset digests hash bytes

- **WHEN** inventory `canonical_digest` and `projection_digest` are written and verified
- **THEN** both sides hash the file bytes through the same function

### Requirement: Surface-specific inventory digests keep their bytes

Each surface's provenance `inventoryDigest` SHALL keep the serialization it uses
today (insertion-order JSON for Codex native, Cursor, and the consumer gate;
key-sorted JSON for the Agent and AGY plugins). Consolidation SHALL NOT make the
two serializations produce one value. The key-order sensitivity of the
insertion-order variant SHALL be recorded as a known risk.

#### Scenario: Both serializations stay distinct

- **WHEN** the same inventory is digested by the insertion-order and key-sorted functions and its top-level keys are reordered
- **THEN** the key-sorted digest is unchanged and the insertion-order digest changes

#### Scenario: Profile keys are excluded once

- **WHEN** an inventory carries `profile_policy`, `standalone_dependencies`, and `project_agent_projection`
- **THEN** both inventory digest functions exclude those three keys through one shared removal step

### Requirement: Receipt primitives keep their public contract

`scripts/lib/receipt-primitives.js` SHALL obtain its SHA-256, canonical JSON,
and directory-fingerprint behavior from the shared module and SHALL keep the
same exports and results for `harness-receipt` and its tests.

#### Scenario: Existing receipt contract is unchanged

- **WHEN** `tests/receipt-primitives.test.js` and the harness-receipt tests run
- **THEN** they pass without edits to their expected values

### Requirement: Managed copies and non-JavaScript digests stay out of scope

The consolidation SHALL NOT edit a source listed in `manifests/skill-resources.json`
(including `scripts/lib/dispatch-contract.js` and `scripts/cli-dispatch/verify-handoff.js`),
a managed copy under `skills/*/scripts/**`, `scripts/cli-dispatch/**`, or
`skills/flow-guide/references/execution-bundle/**`, or any Python hashing
implementation. The skill-resource drift check SHALL stay green.

#### Scenario: Ledgered sources are untouched

- **WHEN** the change diff is compared against the skill-resources ledger
- **THEN** no ledgered source file is modified and the managed-copy drift check passes

### Requirement: Remaining tree-algorithm differences are inventoried

The change record SHALL include a table of every existing tree-fingerprint
algorithm and its differences (sort order, symlink handling, mode inclusion,
empty directories, bytecode skipping, path separator, terminators, Merkle
prefixes), so that algorithm unification can be tracked as a separate change.

#### Scenario: A follow-up can link to the table

- **WHEN** a maintainer opens the unification follow-up issue
- **THEN** it links to the algorithm table in this change's `design.md` and lists each surface that would change its persisted value
