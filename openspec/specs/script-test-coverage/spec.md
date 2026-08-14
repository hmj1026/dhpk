# script-test-coverage Specification

## Purpose
TBD - created by archiving change script-test-backfill-and-harness-fixes. Update Purpose after archive.
## Requirements
### Requirement: Every logic script under `scripts/` has a dedicated test

Every logic script under `scripts/` — `*.sh`, `*.js`, `*.ts`, `*.py`, including `scripts/lib/`, `scripts/ci/`, `scripts/hooks/`, `scripts/hooks/_lib/`, `scripts/opsx-apply-resume/`, `scripts/statusline/`, and `scripts/validate/` — SHALL have a dedicated test discoverable by `tests/run-all.js`. A dedicated test is a `tests/*.test.js` file that exercises that one script (directly, or via an explicit script→test mapping for feature-named tests such as `sentinel-slots.test.js` → `payload.sh`). Scripts previously exercised only indirectly (`scripts/hooks/pre-edit-guard.sh`, `scripts/hooks/clear-sentinel.sh`, `scripts/ci/_lib/frontmatter.js`) SHALL gain their own dedicated test.

#### Scenario: An uncovered script gains a dedicated test
- **WHEN** a logic script such as `scripts/lib/pre-route.sh` or `scripts/ci/validate-plugin.js` previously had no dedicated test
- **THEN** a `tests/*.test.js` file named after that script's stem exists, is discovered by `tests/run-all.js`, and passes

#### Scenario: An indirectly-tested script is promoted to a dedicated test
- **WHEN** a script was only exercised as a setup helper or secondary case inside another test (e.g. `clear-sentinel.sh` inside `subagent-stop-verify-autoclear.test.js`)
- **THEN** it has its own dedicated `tests/*.test.js` file that asserts its behavior directly

#### Scenario: The full suite stays green
- **WHEN** `node tests/run-all.js` runs after the backfill
- **THEN** every new test passes and the previously-passing suite remains green

### Requirement: A written coverage policy defines what MUST be tested and how

The harness SSOT SHALL carry a coverage-policy note stating which script classes MUST have a dedicated test (guards, resolvers, validators, runners, sentinel/lifecycle logic, codegen, pure `_lib` helpers), the dedicated-test naming convention (named after the script stem plus an optional aspect suffix, located flat in `tests/`), and the expected test shape (shell hooks driven via `DHPK_TEST_PAYLOAD`/`DHPK_TEST_HOOK` + `spawnSync` bash and asserted on exit status/stderr; JS/TS/py scripts driven via `spawnSync` and asserted on stdout/exit). The policy SHALL distinguish **behavioral** tests from **smoke** tests and SHALL name which script classes are smoke-only (installers, session-lifecycle hooks, git/network-shelling scripts).

#### Scenario: The policy names required classes and naming convention
- **WHEN** a contributor reads the harness SSOT after this change
- **THEN** it states which script classes MUST carry a dedicated test, the stem-based naming convention, and the shell/JS test shape

#### Scenario: Smoke-only scripts are labelled
- **WHEN** a script is an installer or a session-lifecycle hook that cannot be deeply asserted in a sandbox
- **THEN** the policy labels its dedicated test as smoke-only (asserts it runs, is valid, and safely no-ops), so its coverage is not read as full behavioral verification

### Requirement: Coverage is checkable

A coverage check SHALL be able to report logic scripts under `scripts/` that lack a dedicated test, so the gap cannot silently reopen. The check MAY be delivered as an addition to `scripts/ci/catalog.js` or as a checked-in coverage manifest with an explicit script→test mapping for feature-named tests.

#### Scenario: A newly-added untested script is flagged
- **WHEN** a new logic script is added under `scripts/` with no matching dedicated test
- **THEN** the coverage check reports that script as uncovered and exits non-zero

#### Scenario: Full coverage passes
- **WHEN** every logic script under `scripts/` maps to a dedicated test (directly or via the explicit mapping)
- **THEN** the coverage check passes
