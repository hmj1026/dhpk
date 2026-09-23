# script-test-coverage Specification

## Purpose

Every logic script under `scripts/` has owned assertions in the aggregate Node test suite, located by stem heuristic or an explicit coverage mapping, so uncovered scripts cannot silently return.

## Requirements

### Requirement: Every logic script under `scripts/` has a dedicated test

Every logic script under `scripts/` — `*.sh`, `*.js`, `*.ts`, `*.py`, including `scripts/lib/`, `scripts/ci/`, `scripts/hooks/`, `scripts/hooks/_lib/`, `scripts/statusline/`, and `scripts/validate/` — SHALL have owned assertions discoverable by `tests/run-all.js`. Coverage is satisfied when a flat `tests/*.test.js` file exercises that script, located either by stem heuristic (`tests/<stem>.test.js` or `tests/<stem>-<aspect>.test.js`) or by an explicit script-to-test mapping in the coverage check. Two or more scripts MAY share one discovered file when that file owns assertions for each mapped script. Unique scripts default to a stem-named file. A file that only `require`s another `*.test.js` file SHALL NOT count as owned assertions.

#### Scenario: An uncovered script gains a dedicated test

- **WHEN** a logic script such as `scripts/lib/pre-route.sh` or `scripts/ci/validate-plugin.js` previously had no owned assertions
- **THEN** a discovered `tests/*.test.js` file covers it by stem name or explicit mapping, `tests/run-all.js` runs that file, and the assertions pass

#### Scenario: An indirectly-tested script is promoted to a dedicated test

- **WHEN** a script was only exercised as a setup helper or secondary case inside another test (e.g. `clear-sentinel.sh` inside `subagent-stop-verify-autoclear.test.js`)
- **THEN** it has owned assertions for its own behavior, either in a stem-named file or in a shared mapped file that still exercises that script directly

#### Scenario: The full suite stays green

- **WHEN** `node tests/run-all.js` runs after the coverage change
- **THEN** every mapped or stem-covered test passes and the previously-passing suite remains green

#### Scenario: Two scripts share one discovered test file

- **WHEN** the coverage mapping lists two logic scripts against the same `tests/*.test.js` file and that file asserts both scripts' behavior
- **THEN** the coverage check treats both scripts as covered and does not require a second stem-named file

### Requirement: A written coverage policy defines what MUST be tested and how

The harness SSOT SHALL carry a coverage-policy note stating which script classes MUST have owned assertions (guards, resolvers, validators, runners, sentinel/lifecycle logic, codegen, pure `_lib` helpers), how a script is located (stem heuristic for unique scripts; explicit many-to-one mapping when assertions are shared), that tests remain flat in `tests/` with no nested `*.test.js`, and the expected test shape (shell hooks driven via `DHPK_TEST_PAYLOAD`/`DHPK_TEST_HOOK` + `spawnSync` bash and asserted on exit status/stderr; JS/TS/py scripts driven via `spawnSync` and asserted on stdout/exit). The policy SHALL distinguish **behavioral** tests from **smoke** tests and SHALL name which script classes are smoke-only (installers, session-lifecycle hooks, git/network-shelling scripts). The policy SHALL state that a forwarding `require` of another `*.test.js` is not coverage.

#### Scenario: The policy names required classes and naming convention

- **WHEN** a contributor reads the harness SSOT after this change
- **THEN** it states which script classes MUST carry owned assertions, the stem heuristic, the explicit mapping, the flat `tests/` layout, and the shell/JS test shape

#### Scenario: Smoke-only scripts are labelled

- **WHEN** a script is an installer or a session-lifecycle hook that cannot be deeply asserted in a sandbox
- **THEN** the policy labels its owned assertions as smoke-only (asserts it runs, is valid, and safely no-ops), so its coverage is not read as full behavioral verification

### Requirement: Coverage is checkable

A coverage check SHALL report logic scripts under `scripts/` that lack owned assertions, so the gap cannot silently reopen. The check SHALL accept both the stem heuristic and an explicit many-to-one script-to-test mapping. The check MAY be delivered as `scripts/ci/catalog.js` together with that mapping. Helpers under `tests/_lib/` are not coverage targets.

#### Scenario: A newly-added untested script is flagged

- **WHEN** a new logic script is added under `scripts/` with no stem-named test and no mapping entry
- **THEN** the coverage check reports that script as uncovered and exits non-zero

#### Scenario: Full coverage passes

- **WHEN** every logic script under `scripts/` maps to owned assertions (stem heuristic or explicit mapping)
- **THEN** the coverage check passes

### Requirement: Forwarding test entrypoints are forbidden

A `tests/*.test.js` file discovered by `tests/run-all.js` SHALL contain its own assertions or helpers. It SHALL NOT exist solely to `require` another discovered `*.test.js` file. When two script stems share one implementation suite, the coverage mapping SHALL point both scripts at that suite and the extra entrypoint SHALL be absent.

#### Scenario: A wrapper that re-enters another test file is rejected

- **WHEN** `tests/advise-once.test.js` or `tests/detect-stack-hints.test.js` only `require`s `session-start-advisories.test.js`
- **THEN** those wrapper files are absent, both shell scripts map to `session-start-advisories.test.js`, and `tests/run-all.js` discovers the implementation once

#### Scenario: Catalog still covers the wrapped scripts

- **WHEN** the forwarding files are removed
- **THEN** `node scripts/ci/catalog.js --check` still reports those scripts as covered via the mapping
