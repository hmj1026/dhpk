# harness-count-integrity Specification

## Purpose

Report repository and distribution inventory counts from their machine-readable
sources while keeping selected installation invariants mechanically enforced.
Human-readable documentation counts remain informational.

## Requirements

### Requirement: Catalog counts are derived and informational

`scripts/ci/catalog.js` SHALL compute and print asset counts from the current
repository inventory and, when available, separate canonical, lifecycle, and
per-host publication counts from `manifests/distribution-inventory.json`.
The catalog SHALL NOT scan documentation or plugin prose for exact numeric
claims, fail because such prose counts differ, or rewrite prose counts with
`--write`. Contributors may use printed counts when updating documentation;
ordinary prose edits do not require a count-test or allowlist update.

#### Scenario: The catalog reports current source counts

- **WHEN** `node scripts/ci/catalog.js` prints its inventory table
- **THEN** the counts are derived from the current assets and distribution inventory

#### Scenario: A prose count differs from the inventory

- **WHEN** a human-readable file contains an outdated or approximate count
- **THEN** catalog `--check` does not fail because of that prose, and `--write` does not edit it

### Requirement: Retired Codex MCP grants remain a machine-readable zero invariant

The catalog SHALL compute MCP-backed Codex skill and command grants from
machine-readable skill frontmatter and command metadata. It SHALL reject any
nonzero grant after retirement, regardless of the name of the declaring skill
or command.

#### Scenario: A new MCP-backed grant is introduced

- **WHEN** any skill or command declares a retired Codex MCP grant
- **THEN** `node scripts/ci/catalog.js --check` reports the grant and exits non-zero

#### Scenario: No retired grant exists

- **WHEN** no skill or command declares a retired Codex MCP grant
- **THEN** the retirement invariant passes

### Requirement: Inventory and publication counts remain separate

The catalog SHALL compute and label canonical, promoted-core, optional,
experimental, deprecated, and per-host published skill counts when the
distribution inventory is available. It SHALL NOT conflate canonical inventory
with the default installed surface. Generated package validators SHALL continue
to compare shipped package contents with their machine-readable inventory.

#### Scenario: Lifecycle transition changes scoped counts

- **WHEN** a skill moves from `promoted` to `deprecated`
- **THEN** the canonical count remains unchanged, the promoted count decreases,
  and the deprecated count increases without manual arithmetic

#### Scenario: Generated package omits an eligible skill

- **WHEN** the distribution inventory permits a skill on a published Host but
  the generated package omits it
- **THEN** the relevant package-content validator reports the missing skill

### Requirement: Profile projection sets match their source manifests

`node scripts/ci/catalog.js --check` SHALL verify that
`manifests/profile-projection-sets.json` matches the profile, module, and
distribution manifests. `--write` MAY regenerate that machine-readable
projection manifest; it SHALL NOT rewrite prose counts.

#### Scenario: A profile projection set is stale

- **WHEN** a declared profile and Host skill set differs from the computed set
- **THEN** catalog `--check` reports the stale projection and exits non-zero

#### Scenario: Projection sets are regenerated

- **WHEN** an operator runs `node scripts/ci/catalog.js --write`
- **THEN** only the generated profile-projection-sets manifest is updated
