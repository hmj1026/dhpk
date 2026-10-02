# Testing governance

This page owns repository test coverage and suite-discovery rules. Benchmark
operation is documented in [Worker-context benchmark](worker-context-benchmark.md).
Development ledgers, timing comparisons, and run receipts are local records in
`docs/evidence/`; they are not required installation or distribution artifacts.

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
