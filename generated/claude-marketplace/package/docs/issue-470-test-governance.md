# Issue #470 test governance

This batch removes one confirmed duplicate test entry point while retaining
the production-script coverage obligation.

## Disposition record

| Item | Owner / invariant | Before | After | Replacement evidence |
| --- | --- | --- | --- | --- |
| `tests/fast-worker-selector.test.js` | `scripts/fast-worker-selector.js`; selector and fallback semantics | Forwarding wrapper required the full implementation test, so the aggregate runner discovered both files | Removed; only `tests/fast-worker-selection.test.js` is discovered | `scripts/ci/catalog.js` maps the production script to `fast-worker-selection.test.js`; `tests/test-entrypoint-dedup.test.js` asserts no uncovered script |
| `tests/advise-once.test.js` | `scripts/hooks/_lib/advise-once.sh`; once-per-session advisory lock | Forwarding wrapper `require`d `session-start-advisories.test.js` so the aggregate runner discovered the implementation twice | Removed | `COVERAGE_MAP` maps `scripts/hooks/_lib/advise-once.sh` → `session-start-advisories.test.js`; deleted path `tests/advise-once.test.js` |
| `tests/detect-stack-hints.test.js` | `scripts/hooks/_lib/detect-stack-hints.sh`; stack-hint probe | Forwarding wrapper `require`d `session-start-advisories.test.js` so the aggregate runner discovered the implementation twice | Removed | `COVERAGE_MAP` maps `scripts/hooks/_lib/detect-stack-hints.sh` → `session-start-advisories.test.js`; deleted path `tests/detect-stack-hints.test.js` |

The implementation test remains the single owner of selector behavior, and its
mutating temporary directories remain local to each test case. No receipt,
HOME, workspace, or security-state fixture is shared. The baseline collector
now treats the removed wrapper as absent; the historical #467 JSON remains an
immutable record of the prior candidate and is not rewritten.

## Scope and timing evidence

The #467 / original #470 baseline recorded 314 test files and approximately
144 seconds on Node 26/macOS, with known environment-sensitive failures. That
batch kept the file count at 319 because one forwarding entry was removed and
one dedicated governance test was added. This follow-on change additionally
removes `tests/advise-once.test.js`, `tests/detect-stack-hints.test.js`, and
`tests/plugin-manifest.test.js`, and adds Host-table / Darwin-list helpers
under `tests/_lib/` plus `tests/macos-installer-files.test.js`.

Measured selected-suite evidence on the same local Node 26/macOS host:

- `node tests/fast-worker-selection.test.js`: 14/14 passed.
- `node scripts/ci/catalog.js --check`: 0 uncovered scripts.
- `node tests/test-entrypoint-dedup.test.js`: 1/1 passed.

A full aggregate timing comparison remains CI-owned because the local checkout
does not provide Linux cgroup containment and macOS `/var` is symlinked in the
local environment. The workflow's existing bounded runner, per-file timing
artifact, full-suite path, and required failure semantics remain unchanged;
no new scheduler or blanket retry was introduced.

## Coverage policy

Owned assertions, not a 1:1 file, satisfy coverage. A logic script under
`scripts/` is covered when a flat `tests/*.test.js` file exercises it.

- **Required classes** (owned assertions): guards, resolvers, validators,
  runners, sentinel/lifecycle logic, codegen, and pure `_lib` helpers.
- **Stem heuristic (default for unique scripts):** `tests/<stem>.test.js` or
  `tests/<stem>-<aspect>.test.js`.
- **Explicit many-to-one map:** `COVERAGE_MAP` in `scripts/ci/catalog.js`
  (`resolveScriptCoverage`) may point two or more scripts at one discovered
  file when that file owns assertions for each mapped script.
- **Flat tree:** tests stay in `tests/*.test.js`. Nested `tests/subdir/*.test.js`
  is not coverage. Helpers live under `tests/_lib/` and are not coverage
  targets.
- **Shape:** shell hooks via `DHPK_TEST_PAYLOAD` / `DHPK_TEST_HOOK` +
  `spawnSync` bash, asserted on exit status/stderr; JS/TS/py via `spawnSync`,
  asserted on stdout/exit.
- **Behavioral vs smoke:** behavioral tests assert the script's own contract.
  Installers, session-lifecycle hooks, and git/network-shelling scripts are
  smoke-only (runs, is valid, and safely no-ops).
- **Forwarding `require` is not coverage:** a `tests/*.test.js` file that only
  `require`s another discovered `*.test.js` file does not count as owned
  assertions. Map both scripts at the implementation suite and delete the
  extra entrypoint.

## Darwin installer subset

The macOS CI job `macos-installer` executes exactly the files in
`tests/_lib/macos-installer-files.js` (`MACOS_INSTALLER_FILES`). Adding or
removing a Host-unique installer suite from the Ubuntu aggregate runner must
update that list in the same change; the job already runs the list.
`session-usage-audit` and `consumer-gate-cli` keep `TMPDIR=/private/tmp` on
Darwin.
