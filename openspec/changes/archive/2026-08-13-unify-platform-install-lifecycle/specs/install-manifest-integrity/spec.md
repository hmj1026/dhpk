## MODIFIED Requirements

### Requirement: Distribution inventory and publication manifests reconcile

The manifest-integrity validation SHALL reconcile the distribution inventory
with canonical skill/module packages, Claude plugin registrations, Codex
publication inputs, Agent Plugin and Cursor publication inputs, module
catalogs, install profiles, and unified lifecycle receipts. Missing, duplicate,
lifecycle-ineligible, wrong-surface, stale, or undeclared
consumer-reachable entries SHALL fail validation. For every lifecycle-managed
projection it SHALL compare exact stable IDs, public names, source and
destination fingerprints, target roots, and owner/schema metadata.

#### Scenario: Deprecated skill remains promoted

- **WHEN** the distribution inventory marks a skill `deprecated` but a
  generated promoted manifest or lifecycle receipt still registers it
- **THEN** manifest-integrity validation fails and names both the lifecycle
  entry and manifest/receipt location

#### Scenario: Optional module is absent from its catalog

- **WHEN** a module is classified as optional but lacks the catalog/profile
  metadata required to select it
- **THEN** manifest-integrity validation fails before release

#### Scenario: Lifecycle projection contains an undeclared ID

- **WHEN** a receipt or generated package contains a stable ID, public name, or
  target root absent from the target surface's inventory membership
- **THEN** validation fails with the exact ID, destination, and wrong-surface
  diagnostic

#### Scenario: Fingerprint and receipt agree with the inventory

- **WHEN** every selected lifecycle entry has the inventory source ID, expected
  public name, matching fingerprints, and current owner/schema
- **THEN** the surface-specific integrity check passes

### Requirement: Static and installed validations have distinct verdicts

Plugin and lifecycle validation SHALL report repository path/manifest
consistency, staged/materialized installation, and client-managed observation
as separate verdicts. `INSTALL_PASS` SHALL require an atomic materialization
and valid receipt, while a static PASS or `INSTALL_PASS` SHALL NOT be emitted or
documented as an installed-runtime or consumer PASS without the applicable
client evidence.

#### Scenario: Repository paths resolve but installed cache is empty

- **WHEN** static manifest validation passes and installed-cache discovery fails
- **THEN** the combined report records static PASS, installation FAIL or
  `CONSUMER_BLOCKED`, and an overall native-support FAIL/non-pass result

#### Scenario: Installation commits but the consumer is unavailable

- **WHEN** staged artifacts and the lifecycle receipt pass but the client probe
  cannot run
- **THEN** the report records `INSTALL_PASS` plus `NOT_RUN`, `BLOCKED`, or
  `UNAVAILABLE` consumer evidence and does not report overall PASS

## ADDED Requirements

### Requirement: Cursor profiles and bundle roots are inventory-integrity checked

The manifest-integrity gate SHALL treat Cursor profile membership as inventory
SSOT and verify that the portable selection contains exactly the 66 current
portable skills under `.agents/skills`. It SHALL verify `core` as the five
named agents, `extended` as the existing curated 12-agent set, and `full` as
all current 31 native agents under `.cursor/agents`, with repeatable explicit
`--agent` additions limited to declared IDs. The 15-entry `codex-native`
surface SHALL never satisfy a Cursor profile.

#### Scenario: Cursor core profile matches inventory

- **WHEN** the Cursor receipt lists the 66 portable IDs and five core native
  IDs at their declared roots
- **THEN** manifest-integrity validation passes the profile membership and
  exact root/fingerprint checks

#### Scenario: Cursor profile silently uses Codex-native entries

- **WHEN** a Cursor profile is populated from the 15-entry `codex-native`
  surface instead of the inventory's Cursor native membership
- **THEN** validation fails with `WRONG_SURFACE` and names the substituted IDs

#### Scenario: Profile count or ID drifts

- **WHEN** an agent is added, removed, deprecated, or renamed without updating
  the inventory-owned profile
- **THEN** validation fails with the expected and observed stable ID sets and
  does not regenerate a partial profile

### Requirement: Lifecycle receipts are deterministic integrity artifacts

Every lifecycle receipt SHALL validate against its declared schema and owner,
plan ID, source version/commit, inventory digest, selected IDs/names,
transforms, target roots, fingerprints, and predecessor. Receipts SHALL be
deterministically regenerated in check mode; foreign, malformed, stale, or
manually edited receipts SHALL fail without adoption.

#### Scenario: A receipt is manually edited

- **WHEN** a checked-in or installed receipt changes selected IDs or
  fingerprints without a matching inventory/compiler result
- **THEN** the integrity gate exits non-zero and reports the receipt field and
  affected surface

#### Scenario: A surface receipt is presented to another surface

- **WHEN** a Cursor receipt is used to validate Codex or Agent Plugin output
- **THEN** validation reports an owner mismatch and keeps both surface results
  independent
