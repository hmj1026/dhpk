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

### Claude validation (canonical root)

The official Claude validator checks the canonical repository root:

```bash
claude plugin validate ~/projects/dhpk --strict
```

This command validates the Claude plugin source at the checkout root. It does
not validate the separate Codex-native package under `plugins/dhpk/`.

### Codex-native package validation

Validate the `plugins/dhpk/` Codex-native artifact with its own checks:

```bash
node scripts/ci/verify-codex-native-package.js
node tests/codex-native-package-validate.test.js
node tests/codex-native-install-smoke.test.js
```

These checks do not replace Claude validation of the canonical repository
root. Keep their results attached to the publication surface they validate.

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
handoff. After the change, dispatching the applicable reviewers from the
execution-policy trigger table is recommended.

## CI preflight for generated and release-shaped changes

When a change touches the distribution inventory, canonical skills, profiles,
plugin manifests, package generators, or generated package files, first
regenerate the usage catalog and include any resulting catalog diff in the
canonical-source commit. The provenance-bound distribution generators then run
from that clean commit, followed by the generated-output commit and the
clean-checkout verifier. Do not stop after a single projection passes:

```bash
node scripts/ci/gen-skill-usage.js --write
git diff --check
# Commit canonical sources and the regenerated usage catalog, then continue.
# Every formal generate requires a clean source checkout; stage all four
# packages outside the checkout from this same commit before copying owned
# outputs into tracked paths.
dhpk_packages=$(mktemp -d /tmp/dhpk-packages.XXXXXX)
bin/dhpk distribution agent-plugin generate --output "$dhpk_packages/dhpk-agent" --version=<version> --json
bin/dhpk distribution cursor-plugin generate --output "$dhpk_packages/dhpk-cursor" --version=<version> --json
bin/dhpk distribution codex-native generate --output "$dhpk_packages/dhpk" --version=<version> --json
bin/dhpk distribution agy-plugin generate --output "$dhpk_packages/dhpk-agy" --version=<version> --json
# Copy only the owned outputs, then commit the generated projections once.
rsync -a --delete "$dhpk_packages/dhpk-agent/" plugins/dhpk-agent/
rsync -a --delete "$dhpk_packages/dhpk-cursor/" plugins/dhpk-cursor/
rsync -a --delete "$dhpk_packages/dhpk/" plugins/dhpk/
rsync -a --delete "$dhpk_packages/dhpk-agy/" plugins/dhpk-agy/
git add plugins/dhpk-agent plugins/dhpk-cursor plugins/dhpk plugins/dhpk-agy
git commit -m "chore: refresh generated platform packages"
node scripts/ci/verify-platform-packages.js
```

For daily CI, `verify-platform-packages.js --surface <name>` accepts the
affected package subset; selecting Cursor automatically includes its Agent
owner because Cursor consumes the Agent-owned shared skills. Content and
hook-only plans can skip this heavy gate, while no-argument daily verification
and release verification retain the complete four-surface check.

The distribution generators and `verify-platform-packages.js` are
provenance-bound and require a clean checkout. Run the generators after the
canonical-source commit, commit their outputs, then run the verifier. If
`.claude-plugin/plugin.json` or a profile manifest changes, also run
`node tests/profile-scoped-claude-capability-bundle.test.js` to verify profile
selection, generated bundle behavior, and artifact/source fingerprint binding.

The project-local `.agents/skills` compatibility projection is generated from
the same canonical `skills/` tree and is not hand-edited:

```bash
node scripts/ci/gen-agents-skills.js
node scripts/ci/validate-agents-skills.js
```

The no-argument invocation is the retained in-checkout compatibility route.
For an external consumer project, pass `--source-root`, `--project-root`, the
explicit `portable-core` profile, and the requested Hosts; the shared publisher
then writes a self-contained artifact, a project receipt at
`.agents/.dhpk-installed.json`, and a Claude discovery binding when Claude is
selected. AGY sibling-package references remain forbidden unless a bounded
consumer probe passes. Keep Codex/Cursor/AGY agent and rule projections on their
platform-native paths; `.agents` is not their shared configuration root.

Every non-test-only change must include either a
`changelog.d/<category>.<slug>.md` fragment or a
`changelog.d/<slug>.none` marker. Before handoff, run:

```bash
node scripts/ci/validate-changelog-fragments.js \
  --diff-base origin/develop --base-ref develop
```

Report the result with the other gates.

## Test quality rule

**Tautological tests considered harmful.** Apply the canonical
[`skills/tdd-workflow/tests.md`](../../skills/tdd-workflow/tests.md) rules and
the repository reviewer checklist in
[`CODING_STANDARDS.md`](../../CODING_STANDARDS.md#tests).
