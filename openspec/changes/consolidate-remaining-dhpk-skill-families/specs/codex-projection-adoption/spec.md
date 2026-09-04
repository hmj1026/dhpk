## ADDED Requirements

### Requirement: Codex projections expose flow-guide on both supported surfaces

When the distribution inventory selects `flow-guide`, both the `codex-native`
and `codex-sync` projections SHALL contain exactly one projection of the
canonical `flow-guide` package at the inventory-selected path. The generated
package SHALL resolve the public `$flow-guide` identity and carry the generated
usage/help artifacts required by the Codex surface. Selection, package paths,
and fingerprints SHALL be derived from the same inventory revision; a plugin
manifest or installed/enabled status alone SHALL not prove runtime
discoverability.

#### Scenario: Flow-guide is selected in the inventory

- **WHEN** projection generation runs for an inventory revision that selects
  `flow-guide` on `codex-native` and `codex-sync`
- **THEN** both projections contain the same canonical identity, public name,
  usage contract, and source fingerprint

#### Scenario: One Codex surface omits flow-guide

- **WHEN** `codex-native` contains `flow-guide` but `codex-sync` does not, or
  the reverse occurs
- **THEN** projection-parity validation fails and reports the missing surface
  before publication

#### Scenario: A projection uses a stale flow-guide package

- **WHEN** either Codex surface contains `flow-guide` with a fingerprint that
  differs from the selected inventory revision without an approved adapter
- **THEN** validation fails with both source and destination evidence

#### Scenario: Package structure exists without consumer discovery

- **WHEN** generated `flow-guide` files exist but no supported Codex consumer
  has loaded or discovered the package
- **THEN** the report records structural projection PASS and runtime
  discoverability as `NOT_RUN` or `NOT_CONFIGURED`, never as runtime PASS
