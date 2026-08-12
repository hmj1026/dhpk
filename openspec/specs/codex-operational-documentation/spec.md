# codex-operational-documentation Specification

## Purpose
TBD - created by archiving change repair-codex-operational-docs. Update Purpose after archive.
## Requirements
### Requirement: Codex verification commands declare their working root

Current Codex installation documentation SHALL distinguish checks that run in a
consumer project from validators that run in the dhpk source checkout. The
consumer block SHALL check only the project-local receipt/discovery state, and
source validators SHALL use an explicit `DHPK_ROOT` or an equivalent absolute
checkout path rather than a consumer-relative path.

#### Scenario: Consumer installation is verified from the consumer root

- **WHEN** a user follows the Supported Codex project-local flow from a synced
  consumer project
- **THEN** `test -f .codex/.dhpk-installed.json` is runnable there
- **AND** the documentation does not imply that `scripts/ci` or `tests` exists
  in that consumer project

#### Scenario: Source validators are run from the dhpk checkout

- **WHEN** a user wants metadata and installer regression evidence after the
  consumer receipt check
- **THEN** the documented commands resolve
  `scripts/ci/validate-openai-metadata.js` and
  `tests/install-codex-skills.test.js` from `DHPK_ROOT`
- **AND** the commands identify the checkout root passed to the validator

### Requirement: Current Codex operational docs match the projection roster

The current English and Traditional Chinese operational guides SHALL describe
the shipped Codex projection as 16 direct roles, consisting of 4
hand-maintained roles and 12 generated roles. The role-count contract SHALL be
checked against `codex/agents/*.toml` and
`codex/agent-projection-manifest.json`; historical changelog and explicitly
historical specification text MAY retain prior counts.

#### Scenario: Current guides expose the complete roster count

- **WHEN** documentation parity tests inspect
  `docs/basic-operations*` and `docs/configuration*`
- **THEN** each current locale describes 16 roles and 12 generated roles
- **AND** the expected values come from the checked-in projection metadata

#### Scenario: A role expansion cannot silently leave stale prose

- **WHEN** the package-owned role set or generated-role manifest changes
- **THEN** the documentation parity check fails with the affected current file
  and expected role-count contract
- **AND** historical documents are not treated as current operational guidance

### Requirement: Bilingual current documentation remains structurally aligned

The English and Traditional Chinese current guides SHALL preserve equivalent
verification command order, path semantics, and links to the canonical
installation guide. A locale may translate prose, but it SHALL NOT change the
working-root contract or support-status claim.

#### Scenario: English and Traditional Chinese verification blocks agree

- **WHEN** the bilingual documentation parity suite runs
- **THEN** both locale files contain the same consumer/source command boundary
  and equivalent `DHPK_ROOT` form
- **AND** the suite reports the relative file when the contract drifts

