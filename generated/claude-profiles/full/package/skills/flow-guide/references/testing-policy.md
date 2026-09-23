# Script testing policy

`$PROJECT_DIR` denotes the root of the consumer project selected by the test
route. It is documentation notation resolved by the caller, not a Skill
resource lookup. Paths such as `$PROJECT_DIR/scripts/`, `$PROJECT_DIR/tests/`,
and `$PROJECT_DIR/docs/` in this policy refer to the consumer project's
supplied test surface. They are inputs to a selected test route, not runtime
resources to resolve from outside the selected policy bundle.

Every guard, resolver, validator, runner, sentinel/lifecycle script, codegen
script, and pure `_lib` helper under `$PROJECT_DIR/scripts/` MUST have owned
assertions in a flat `$PROJECT_DIR/tests/*.test.js` file discovered by
`$PROJECT_DIR/tests/run-all.js`. Unique scripts default to
`$PROJECT_DIR/tests/<stem>[-<aspect>].test.js`. Two or more scripts MAY share
one discovered file via `COVERAGE_MAP` / `resolveScriptCoverage` in
`$PROJECT_DIR/scripts/ci/catalog.js`. Nested
`$PROJECT_DIR/tests/subdir/*.test.js` is not coverage. Helpers under
`$PROJECT_DIR/tests/_lib/` are not coverage targets. A file that only
`require`s another discovered `*.test.js` file is not owned assertions.

The consumer project may supply a written coverage-policy note covering
required classes, stem versus map, flat-tree discovery, behavioral versus
smoke checks, and forwarding `require`; it is an input to the selected test
route, not a bundle dependency.

Shell hooks are driven by a piped payload through the shared hook harness and
asserted on exit status/output. JS, Python, and other scripts run directly via
`spawnSync`. Tests use `$PROJECT_DIR/tests/_lib/tinytest.js` without an
external framework.

Installer, session-lifecycle, and git/network-shelling scripts under
`$PROJECT_DIR/scripts/` may use smoke coverage that proves syntax, safe sandbox
execution, and safe no-op behavior.
Smoke coverage is not proof of full behavior.
