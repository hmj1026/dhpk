# Plugin Development Contract

dhpk is the plugin source, not an installed consumer. Source edits become
consumer-visible only after a versioned installation, or immediately during a
development run that points Claude Code at this checkout with `--plugin-dir`.

## Required validation

Run the smallest focused gate first, then the complete set before handoff:

- `node scripts/ci/validate-plugin.js`
- `node scripts/ci/catalog.js --check all`
- `bash scripts/validate/validate-harness.sh`
- `node tests/run-all.js`

For release-shaped work also run distribution, OpenAI metadata, strict skill,
native-package, changelog, consumer, and official Claude validation gates as
available. A missing official consumer CLI is `NOT RUN`, never an official
PASS; a non-zero official result blocks readiness.

## Generated and lifecycle boundaries

The physical Codex-native package is generated from canonical sources. After a
native skill changes, regenerate `plugins/dhpk/` and verify fingerprints and
membership; never hand-edit a mirror. Post-edit hooks arm `.pending-*` review
sentinels under `.claude/artifacts/sessions/`; the reviewer records evidence and
verdict, then the runtime hook clears the sentinel only after a fresh pass.
