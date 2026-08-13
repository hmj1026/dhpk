## MODIFIED Requirements

### Requirement: Consumer checks detect stale or duplicate Codex surfaces

Supported Codex consumer validation SHALL compare the canonical source
fingerprint, lifecycle receipt/version, compiled plan identity, discovered
project-local fallback entries, and native package entries. This is
implemented by `scripts/release/consumer-gate.js` under the
`consumer-post-install-validation` contract. A stale
receipt, duplicate dhpk surface with differing content, legacy fallback set
that shadows canonical names, or ownership mismatch SHALL produce an
actionable `BLOCKED`, `FAIL`, or `WARN` verdict according to that surface
matrix and SHALL never be presented as a clean supported install. The same
evidence boundary SHALL apply when the unified lifecycle verifies another
managed surface.

#### Scenario: Clean project has one current projection

- **WHEN** a clean project contains the expected canonical fallback entries,
  matching lifecycle receipt and plan fingerprint, and no conflicting native
  surface
- **THEN** the supported Codex consumer result is PASS and records the
  discovered names, owner, plan identity, and fingerprint

#### Scenario: Existing project has a stale receipt and legacy mirrors

- **WHEN** the project receipt predates the current native naming scheme and
  legacy physical entries coexist with canonical entries
- **THEN** validation reports the exact stale receipt, duplicate paths, and
  required migration/update command, and does not report PASS

#### Scenario: Native and fallback content differs

- **WHEN** a native package and project-local fallback expose the same skill
  name with different fingerprints
- **THEN** validation reports a deterministic conflict verdict and retains both
  paths and ownership records for remediation

## ADDED Requirements

### Requirement: Installation and consumer observation have separate verdicts

Post-install validation SHALL consume the versioned lifecycle receipt and
report local materialization as `INSTALL_PASS` only after staged commit,
receipt integrity, exact IDs, and fingerprints pass. Client-managed
observation receipts SHALL identify the surface, lifecycle plan/receipt,
client/version, evidence command or UI observation, and status. A blocked,
missing, or unexecuted applicable consumer SHALL remain `CONSUMER_BLOCKED`,
`NOT_RUN`, or `UNAVAILABLE` and SHALL prevent an overall PASS.

#### Scenario: Receipt-backed installation has no client

- **WHEN** the lifecycle receipt and materialized files pass but the required
  client is unavailable
- **THEN** validation reports `INSTALL_PASS + CONSUMER_BLOCKED` or
  `UNAVAILABLE` and never reports overall PASS

#### Scenario: Observation references a stale plan

- **WHEN** a consumer observation receipt references an older lifecycle plan,
  source version, selected profile, or destination fingerprint
- **THEN** validation reports the observation as stale and excludes it from
  support-tier promotion

### Requirement: Cursor consumer validation proves the complete bundle

Cursor post-install validation SHALL require the current lifecycle receipt for
both `.agents/skills` and `.cursor/agents`, exact selected stable IDs and
frontmatter, matching fingerprints, and a real Cursor discovery/dispatch nonce
for the selected native agent profile. A static `dhpk-agent` or `dhpk-cursor`
manifest, generated file, or marketplace listing alone SHALL be structural
evidence and SHALL not establish runtime PASS.

#### Scenario: Cursor discovers and dispatches the selected profile

- **WHEN** both Cursor roots match the current receipt and a real Cursor probe
  returns a nonce tied to the selected IDs and client version
- **THEN** the applicable Cursor consumer row records PASS with the nonce,
  roots, frontmatter, and fingerprints

#### Scenario: Cursor has only the portable package

- **WHEN** `dhpk-agent` is present but the required `dhpk-cursor` artifact or
  native agents are absent
- **THEN** validation keeps the portable result visible but marks the combined
  Cursor route BLOCKED and does not report native parity
