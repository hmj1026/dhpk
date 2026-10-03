# Testing governance

This page owns repository test policy. Local development ledgers, timing
comparisons, and run receipts belong in `docs/evidence/` and are not
installation or distribution artifacts.

## Script behavior

Add or extend automated tests when a script owns meaningful caller-visible
behavior, a safety decision, or a high-impact side effect that a test can
reliably exercise. Use an existing CLI, hook, installer, or package boundary
and assert the outcome a user or caller observes.

- A script or pure helper does not need a dedicated test by default.
- A thin wrapper may be covered through its real entry point; a helper with no
  independent behavior may remain untested.
- Choose behavioral or smoke checks according to the risk being protected.
  Smoke checks show that an operational script parses and safely starts; they
  do not claim full behavior coverage.
- Do not add a project-wide fixed coverage percentage or test-count target.

## Suite organization

Use the existing `tests/run-all.js` runner and organize suites around behavior
or a public contract. Keep shared fixture helpers under `tests/_lib/`; do not
create a coverage ledger merely to pair every production file with a test.

Daily pull-request CI uses the existing runner's positional-file mode for
known script changes. The plan selects a union of coarse owner suites for
hooks, installer lifecycle, skill resources, and manifest or adapter packages;
a selected plan runs one shard with four workers. A full plan keeps four
shards with four workers. Shared core, runner or CI changes, unknown paths,
missing owner suites, and unavailable diffs fail closed to the full plan. The
selected plan records its test files, and shard verification requires the
trusted plan's exact union without omissions, extras, or duplicates. Installer
owner changes also run the macOS installer job.

This routing is an execution optimization and does not create a
script-to-test coverage obligation. Markdown prose remains outside automated
test obligations; shared metadata and resource checks continue through their
existing owner validators.

Skill and guidance Markdown is reviewed by people. Automated checks may parse
machine-readable metadata or verify required resources through shared tools,
but they do not assert the wording, section order, examples, or body length of
individual documents. Parser tests use small fixtures rather than live skill
prose. Content-size or discovery measurements may be requested as informational
reports; they do not create a prose-correctness contract. Actual Host and package
compatibility constraints remain enforced where they affect shipped behavior.

## Darwin installer subset

The macOS CI job `macos-installer` executes the files in
`tests/_lib/macos-installer-files.js` (`MACOS_INSTALLER_FILES`). Adding or
removing a Host-unique installer suite from the Ubuntu aggregate runner must
update that list in the same change; the job already runs the list.
`session-usage-audit` and `consumer-gate-cli` keep `TMPDIR=/private/tmp` on
Darwin.
