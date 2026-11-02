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

Moving a digest into the shared module SHALL NOT change any persisted value. Characterization tests with golden vectors taken from real checked-in fixtures SHALL pass before any call site moves and after every call site moves. Packages regenerated outside the checkout SHALL have `fingerprints.json` and `provenance.json` digests byte-identical to the checked-in packages, except for the sanctioned migration to `tree-merkle-v1`, whose only permitted differences are those stated by the requirement "Regeneration changes only fingerprint values, generator versions, and the algorithm field".

#### Scenario: Golden vectors hold across the move

- **WHEN** the characterization tests run against the shared module
- **THEN** each named function returns the value recorded from the pre-change implementation for the same fixture input

#### Scenario: Regenerated packages are byte-identical

- **WHEN** the four packages are regenerated outside the checkout from the pre-change commit, before `tree-merkle-v1` is adopted
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
implementation, except the tree-fingerprint functions of `scripts/hooks/install-codex-skills.sh`
that the migration to `tree-merkle-v1` replaces. The skill-resource drift check SHALL stay green.

#### Scenario: Ledgered sources are untouched

- **WHEN** the change diff is compared against the skill-resources ledger
- **THEN** no ledgered source file is modified and the managed-copy drift check passes

#### Scenario: Only installer tree hashing changes in Python

- **WHEN** the Python diff of the migration is reviewed
- **THEN** it touches only the tree-fingerprint block and its callers in `scripts/hooks/install-codex-skills.sh`, and `scripts/cli-dispatch/transport/run-cli-transport.py` is unchanged

### Requirement: Remaining tree-algorithm differences are inventoried

The change record that migrates tree fingerprints SHALL include a table of every tree-fingerprint site with its current recipe, where its value is persisted, its verifier, whether it migrates or stays, and why, so a later change can remove the legacy recipes against a known ledger.

#### Scenario: A follow-up can link to the table

- **WHEN** a maintainer opens the legacy-removal issue
- **THEN** it links to the site table in this change's `design.md` and lists each legacy recipe to delete

### Requirement: One tree recipe identifies a directory tree

Every persisted directory-tree fingerprint in the migration ledger of this change SHALL be computed by one recipe, `tree-merkle-v1` (a per-directory Merkle digest), defined once in `scripts/lib/content-fingerprint.js` and mirrored by one self-contained Python block in the installer. A leaf SHALL hash `file\0` followed by the file bytes. A directory SHALL hash `directory\0` followed, for each child in UTF-16 code-unit order of its name, by the UTF-8 name, `\0`, the child's hex digest, and `\0`. Regular files contribute; modes, empty directories, and the root path SHALL NOT affect the digest. A symlink SHALL contribute a third node type, `link\0` followed by the link target text as read, and only in trees that legitimately hold links: installer destinations, the `cursor/` sync tree, and the `codex/` sync tree.

#### Scenario: One recipe for every migrated site

- **WHEN** each migrated writer and verifier computes the fingerprint of the same directory
- **THEN** all return the same value, and a test fails if any of them computes it locally

#### Scenario: Prefix-colliding names are unambiguous

- **WHEN** a tree holds file `a.md` beside directory `a/` containing `b`
- **THEN** the digest is identical whether the tree is read from disk or from an in-memory file list, and differs from a tree where `a.md` and `a/b` are swapped

#### Scenario: Empty directories and modes do not contribute

- **WHEN** an empty directory is added to a tree (including as a directory entry passed by the Cursor caller) or a file mode changes
- **THEN** the digest is unchanged

#### Scenario: Root path does not contribute

- **WHEN** the same tree is fingerprinted at two different root paths
- **THEN** both digests are equal

### Requirement: Link nodes are limited to trees that hold links

The `link\0<target text>` node SHALL be produced only by the record-links walk policy, the walk option that reads a symlink as its target text instead of refusing it. The digest SHALL depend on the target text, never on the target's content or location. Every other tree SHALL refuse symlinks.

#### Scenario: Link node over target text

- **WHEN** a tree holds a symlink whose target text is `../../skills/flow-guide`
- **THEN** its node digest equals SHA-256 of `link\0../../skills/flow-guide` and is unchanged if the target's content changes

#### Scenario: Link refused outside link-holding trees

- **WHEN** a package tree, a source tree, or the baseline walk meets a symlink
- **THEN** the walk fails naming the relative path

#### Scenario: Sync trees fingerprint with link nodes

- **WHEN** the `cursor/` and `codex/` sync tree call sites fingerprint their trees through the record-links option
- **THEN** each of their 54 symlinks contributes a link node and the Node and Python implementations agree

### Requirement: Walk policy is explicit and separate from the recipe

Symlink handling, bytecode skipping, and approved-root following SHALL be options of the directory walk, not part of the digest. The default walk SHALL refuse symlinks and skip `__pycache__` and `*.pyc`. A site that needs a different policy (installer destination complete view with link nodes, sync trees with link nodes, consumer-gate approved-root following as a walk option, installer source following) SHALL name it at the call site.

#### Scenario: Default walk refuses symlinks

- **WHEN** the default walk meets a symlink
- **THEN** it fails naming the relative path and returns no digest

#### Scenario: Bytecode is skipped by default and kept by the complete view

- **WHEN** a tree holds a `.pyc` file
- **THEN** the default fingerprint ignores it and the installer destination complete view includes it

### Requirement: Cross-language golden vectors pin the recipe

A shared fixture of golden vectors SHALL be checked in and consumed by both the Node test and a Python test that extracts and executes the installer's tree-fingerprint block. The vectors SHALL include a link node, nested directories, `a.md` beside `a/`, a name containing a supplementary character beside a name in U+E000 to U+FFFF, an empty file, binary bytes, an empty directory, and a root with no files.

#### Scenario: Node and Python agree

- **WHEN** the Node function and the extracted Python block fingerprint each vector tree
- **THEN** both return the recorded digest

#### Scenario: Sort order matches UTF-16 code units

- **WHEN** a directory holds names `U+10000` and `U+FFFD`
- **THEN** both languages order `U+10000` before `U+FFFD` and return the recorded digest

### Requirement: Persisted tree fingerprints name their algorithm

Each package surface SHALL record `fingerprintAlgorithm` in `provenance.json`, and each receipt that stores a tree fingerprint SHALL record `fingerprint_algorithm`, with value `tree-merkle-v1`. `fingerprints.json` SHALL keep its flat name-to-digest shape. `.dhpk-installed.json` SHALL carry the marker beside `generatorVersion` under `receiptFingerprint`. The baseline persists nothing checked in. An absent field or an unrecognized value SHALL fail closed as stated by "Persisted records without a recognized marker fail closed". No record SHALL be written without the marker.

#### Scenario: Packages and receipts name the algorithm

- **WHEN** the four packages are regenerated and an installer writes a receipt
- **THEN** each `provenance.json` carries `fingerprintAlgorithm: "tree-merkle-v1"` and the receipt carries `fingerprint_algorithm: "tree-merkle-v1"`

#### Scenario: Unknown algorithm fails closed

- **WHEN** a verifier reads a package or receipt whose algorithm field holds an unrecognized value
- **THEN** verification fails and names the field and the value

### Requirement: Retained sites keep their recipes with a recorded reason

The `receipt-primitives` directory fingerprint (which includes modes, deliberately retained), the release artifact manifest content and mode fingerprints, the `prepare-release` rollback digest, and the Claude marketplace generator comparison SHALL keep their current recipes and values. The change record SHALL state per site why it is not migrated.

#### Scenario: Retained sites keep their recipes

- **WHEN** the characterization tests for these four sites run on the pre-change commit and again on the post-change commit
- **THEN** each returns the same value for the same fixture on both commits

### Requirement: Legacy tree recipes do not exist

The repository SHALL contain exactly one persisted directory-tree recipe, `tree-merkle-v1`. `scripts/lib/content-fingerprint.js` SHALL NOT export a flat file-set recipe (`fileSetFingerprintCodeUnit`, `fileSetFingerprintLocale`, `fileSetFingerprintTerminated`) or the legacy Merkle recipe (`merkleFingerprint`). The installer's embedded Python block SHALL NOT contain the legacy `hash_path`, `hash_fd_entry`, or `hash_fd_directory` recipes, and its `fingerprint_*` dispatchers SHALL NOT branch on a legacy algorithm. No verifier SHALL accept a value computed by a removed recipe. Tests that used a removed recipe as an oracle SHALL assert pinned literal digests captured before the removal.

#### Scenario: Removed recipes are gone

- **WHEN** the exports of `scripts/lib/content-fingerprint.js` and the function names of the installer's Python block are listed
- **THEN** none of the removed names appears

#### Scenario: Pinned digests replace oracles

- **WHEN** the fingerprint tests run
- **THEN** each former oracle comparison asserts a literal digest, and a test fails if that digest changes

### Requirement: Persisted records without a recognized marker fail closed

Every verifier of a persisted tree fingerprint SHALL fail closed when the record that carries it lacks its algorithm field or holds a value other than `tree-merkle-v1`. The record kinds are: `provenance.json` `fingerprintAlgorithm` of the Codex native, Agent, and Cursor packages (a missing `provenance.json` is a missing marker); `fingerprint_algorithm` of an installer receipt and its transaction journal; the agents-skills receipt; and the project projection receipt and manifest. The diagnostic SHALL name the field and the observed value (or its absence) and SHALL state the 0.70.0 version boundary: this release accepts only records written by 0.69.x or later, and the two remediation paths are to upgrade through 0.69.x and run one install or update, or to uninstall and reinstall. A verifier SHALL NOT try another recipe. The agents-skills receipt precondition in `agents-skills-compatibility` is the only marker-less record that is read, and installer `--uninstall` over a marker-less receipt releases every entry instead of blocking (`codex-install-materialization`).

#### Scenario: Package without provenance fails

- **WHEN** a package verifier runs on a package whose `provenance.json` is absent or has no `fingerprintAlgorithm`
- **THEN** verification fails, names the field, and states both remediation paths

#### Scenario: Marker-less installer receipt fails

- **WHEN** the installer runs an install, update, or plan over a receipt without `fingerprint_algorithm` that is not an agents-skills receipt
- **THEN** it exits blocked with the version-boundary diagnostic and changes nothing

#### Scenario: Marker-less transaction journal fails

- **WHEN** the installer finds a transaction journal without `fingerprint_algorithm`
- **THEN** it exits blocked with the version-boundary diagnostic and does not recover or roll back by guess

#### Scenario: Old generator version fails

- **WHEN** the agents-skills generator reads a receipt with version `1.0.0`, or the publisher reads a receipt with version `2.0.0`
- **THEN** it fails with the version-boundary diagnostic

### Requirement: Regeneration after legacy removal changes no package byte

Regenerating `plugins/dhpk`, `plugins/dhpk-agent`, `plugins/dhpk-agy`, and `plugins/dhpk-cursor` outside the checkout from the changed source SHALL produce packages byte-identical to the 0.69.0 packages after normalizing commit and tree identity fields. The package generators `codex-native-package`, `agent-plugin-package`, `cursor-plugin-package`, and `agy-plugin-package` SHALL NOT change `GENERATOR_VERSION`, because legacy removal changes no package output. The `agents-skills-package` and `project-agent-projection-publisher` generators SHALL keep their `GENERATOR_VERSION` and SHALL accept only that version in their read gates.

#### Scenario: Regeneration changes no package byte

- **WHEN** the pre-change and post-change regenerations are diffed with commit and tree identity normalized
- **THEN** no file differs
