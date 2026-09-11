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

For reproducible pre/post test timing, run the same workload with
`DHPK_TEST_TIMING_FILE=/path/to/timing.json`; the bounded runner writes a
redacted JSON report containing aggregate, per-file, and worker durations. This
is opt-in evidence, not a second scheduler or an always-on telemetry channel.

For release-shaped work also run distribution, OpenAI metadata, strict skill,
native-package, changelog, consumer, and official Claude validation gates as
available. A missing official consumer CLI is `NOT RUN`, never an official
PASS; a non-zero official result blocks readiness.

## Generated and lifecycle boundaries

The physical Codex-native package is generated from canonical sources. After a
native skill changes, regenerate `plugins/dhpk/` and verify fingerprints and
membership; never hand-edit a mirror. The same rule applies to the Agent,
Cursor, and AGY package surfaces: regenerate every affected physical surface
from its canonical source and run the platform determinism verifier before
handoff. The Review Gate selects applicable reviewer obligations from the
changed scope; the reviewer records identity-bound evidence and a verdict, and
the orchestrator records lifecycle completion only after the required
obligations are resolved.

## CI preflight for generated and release-shaped changes

When a change touches the distribution inventory, canonical skills, profiles,
plugin manifests, package generators, or generated package files, finish and
commit the canonical source edits first. The provenance-bound generators then
run from that clean commit, followed by the generated-output commit and the
clean-checkout verifier. Do not stop after a single projection passes:

```bash
node scripts/ci/gen-skill-usage.js --write
bin/dhpk distribution agent-plugin generate --output plugins/dhpk-agent --version=<version> --json
bin/dhpk distribution cursor-plugin generate --output plugins/dhpk-cursor --version=<version> --json
bin/dhpk distribution codex-native generate --output plugins/dhpk --version=<version> --json
bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=<version> --json
node scripts/ci/verify-platform-packages.js
```

The distribution generators and `verify-platform-packages.js` are
provenance-bound and require a clean checkout. Run the generators after the
canonical-source commit, commit their outputs, then run the verifier. If
`.claude-plugin/plugin.json` or a profile manifest changes, also run
`node tests/profile-scoped-claude-capability-bundle.test.js` and update
its measured characterization bytes/hash from the generated result.

Every non-test-only change must include either a
`changelog.d/<category>.<slug>.md` fragment or a
`changelog.d/<slug>.none` marker. Before handoff, run:

```bash
node scripts/ci/validate-changelog-fragments.js \
  --diff-base origin/develop --base-ref develop
```

Report the result with the other gates.

## Test quality rule

**Tautological tests considered harmful.** A passing test is not evidence when
its expected value is recomputed with the production algorithm, when it calls
the same helper on both sides of an assertion, or when a mock is configured to
return the value that the test immediately expects without proving a caller-
visible behavior. Test through a public seam with a literal, worked example,
independent specification, or observable side effect. If the implementation
and the test could share the same defect and still pass, rewrite the test
before treating it as coverage; see the canonical
`skills/dhpk-tdd-workflow/tests.md` guidance.
