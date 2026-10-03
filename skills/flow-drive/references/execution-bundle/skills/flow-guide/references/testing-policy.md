# Script testing policy

`$PROJECT_DIR` denotes the root of the consumer project selected by the test
route. Paths such as `$PROJECT_DIR/scripts/`, `$PROJECT_DIR/tests/`, and
`$PROJECT_DIR/docs/` refer to that project's test surface.

Add or extend an automated test when a script owns meaningful caller-visible
behavior, an important safety decision, or a high-impact side effect that can
be exercised reliably. Prefer an existing CLI, hook, install, or distribution
entry point and assert its observable result.

A script or helper does not need a dedicated test by default. Thin wrappers
can be exercised through their entry point, and helpers without independent
behavior may remain untested. Organize suites around behavior or contracts;
multiple related scripts may be exercised by one suite without maintaining a
script-to-test coverage map. Do not use a project-wide fixed coverage
percentage or test-count target.

Shell hooks can be exercised with a piped payload and assertions on exit status
and output. JavaScript, Python, and other scripts can run directly through
`spawnSync`. Use a smoke check only when it matches the operational risk; a
smoke check does not claim full behavior coverage.

Markdown body text is reviewed by people. Shared tools may parse machine-readable
metadata or verify packaged resources, but do not write automated tests for a
skill's wording, headings, examples, section order, or body length. Test parsers
with small fixtures rather than live skill documents. Content-size or discovery
measurements may be requested as informational reports; they do not create a
prose-correctness contract. Actual Host and package compatibility constraints
remain enforced where they affect shipped behavior.
