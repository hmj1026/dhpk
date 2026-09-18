# Script testing policy

Every guard, resolver, validator, runner, sentinel/lifecycle script, codegen
script, and pure `_lib` helper under `scripts/` MUST have owned assertions in a
flat `tests/*.test.js` file discovered by `tests/run-all.js`. Unique scripts
default to `tests/<stem>[-<aspect>].test.js`. Two or more scripts MAY share one
discovered file via `COVERAGE_MAP` / `resolveScriptCoverage` in
`scripts/ci/catalog.js`. Nested `tests/subdir/*.test.js` is not coverage.
Helpers under `tests/_lib/` are not coverage targets. A file that only
`require`s another discovered `*.test.js` file is not owned assertions.

The written coverage-policy note (required classes, stem vs map, flat tree,
behavioral vs smoke, forwarding `require`) lives in
`docs/issue-470-test-governance.md`.

Shell hooks are driven by a piped payload through the shared hook harness and
asserted on exit status/output. JS, Python, and other scripts run directly via
`spawnSync`. Tests use `tests/_lib/tinytest.js` without an external framework.

Installer, session-lifecycle, and git/network-shelling scripts may use smoke
coverage that proves syntax, safe sandbox execution, and safe no-op behavior.
Smoke coverage is not proof of full behavior.
