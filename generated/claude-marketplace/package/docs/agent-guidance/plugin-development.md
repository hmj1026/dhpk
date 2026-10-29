# Plugin Development Contract

dhpk is the plugin source, not an installed consumer. Source edits become
consumer-visible only after a versioned installation, or immediately during a
development run that points Claude Code at this checkout with `--plugin-dir`.

## Validation by change scope

Daily and change-scoped checks follow [testing governance](../testing-governance.md),
which owns the light/selected/full routes and behavior-based test scope. Run
surface validators only when the corresponding Host or package contract is
affected. Release and publication gates remain explicit; see
[Release acceptance](#release-acceptance).

### Claude plugin source

Run the official Claude validator when a change affects the Claude plugin
manifest, metadata, or loading contract:

```bash
claude plugin validate ~/projects/dhpk --strict
```

This command validates the Claude plugin source at the checkout root. It does
not validate the separate Codex-native package under `plugins/dhpk/`.

### Codex-native package

When a change affects the `plugins/dhpk/` Codex-native artifact, validate its
metadata and package contract with these checks:

```bash
node scripts/ci/verify-codex-native-package.js
node tests/codex-native-package-validate.test.js
```

Run the installation smoke test only for changes to the Codex installation,
update, removal, receipt, ownership, conflict, or recovery contract:

```bash
node tests/codex-native-install-smoke.test.js
```

These checks do not replace Claude validation of the canonical repository
root. Keep each result attached to the publication surface it validates.

For an explicitly requested performance benchmark or comparison, run the same
workload with `DHPK_TEST_TIMING_FILE=/path/to/timing.json`; the bounded runner
writes a redacted JSON report containing aggregate, per-file, and worker
durations. This is optional performance evidence, not a routine CI gate,
second scheduler, or always-on telemetry channel. CI shard timing artifacts
remain routine execution evidence.

### Release acceptance

For release-shaped work also run distribution, OpenAI metadata, strict skill,
native-package, changelog, consumer, and official Claude validation gates as
available. A missing official consumer CLI is `NOT RUN`, never an official
PASS; a non-zero official result blocks readiness.

## Generated and lifecycle boundaries

The physical Codex-native package is generated from canonical sources; never
hand-edit a mirror. For daily changes, use the authoritative plan to determine
whether a physical package or bounded companion is affected. A canonical-only
content plan can skip unchanged physical packages. When selected outputs need
an update, regenerate and verify the affected surface under the clean-source
provenance below. Full and release routes retain all applicable platform
checks. Dispatching reviewers from the execution-policy trigger table is
recommended.

## CI preflight for generated and release-shaped changes

Daily and change-scoped work follows the authoritative route in
[testing governance](../testing-governance.md). The plan's required checks and
affected surfaces define the delivery obligation: a light plan checks canonical
content and its recorded Claude marketplace companion; a selected plan runs
the declared owner suites and only its affected package surfaces. Canonical-only
content may skip unchanged physical packages. Do not add an unconditional
`npm run ci` after a successful light or selected route. Unknown generated data,
executables, generated-only changes, shared-core work, and formal releases keep
their full route.

When the selected change requires tracked distribution or usage outputs, first
synchronize affected Skill resources. For transformed supporting-policy
changes, refresh digests under the
[supporting-asset contract](../distribution-surfaces.md#lifecycle-model)
before regenerating the usage catalog. Include synchronized resources,
required digests, and the resulting catalog diff in the canonical-source
commit. Provenance-bound distribution generators run from that clean commit.
Generate only the affected surface for scoped work, stage it outside the
checkout, copy its owned outputs, and commit those outputs. Selecting Cursor
also includes its Agent-owned skills. Every formal generation requires a clean
checkout; dirty-source previews with `releaseEligible: false` are review
evidence only.

```bash
node scripts/ci/sync-skill-resources.js --write
# Only when transformed supporting assets changed:
# node scripts/ci/gen-distribution-inventory.js --refresh-supporting-digests
node scripts/ci/gen-skill-usage.js --write
node scripts/ci/gen-distribution-inventory.js --check
node scripts/ci/sync-skill-resources.js --check
git diff --check
# Commit canonical sources and synchronized catalogs before formal generation.

# Supply the reviewed base and classification for the exact B..S source diff.
# Keep the classification and plan evidence outside this checkout.
: "${DHPK_PREFLIGHT_BASE_SHA:?Set the base commit SHA for B..S}"
: "${DHPK_PREFLIGHT_BASE_REF:?Set the base ref used to route this source plan}"
: "${DHPK_PREFLIGHT_CLASSIFICATION_FILE:?Set the independently reviewed B..S classification JSON}"
: "${DHPK_PACKAGE_VERSION:?Set the package version for generated artifacts}"
node scripts/maintainer/verification-run.js preflight \
  --root "$PWD" --base "$DHPK_PREFLIGHT_BASE_SHA" --base-ref "$DHPK_PREFLIGHT_BASE_REF"

dhpk_source_sha=$(git rev-parse HEAD)
dhpk_preflight_dir=$(mktemp -d /tmp/dhpk-ci-preflight.XXXXXX)
dhpk_preflight_dir=$(cd "$dhpk_preflight_dir" && pwd -P)
dhpk_plan_file="$dhpk_preflight_dir/ci-plan.json"

node scripts/ci/ci-plan.js plan \
  --base-sha "$DHPK_PREFLIGHT_BASE_SHA" \
  --head-sha "$dhpk_source_sha" \
  --checkout-sha "$dhpk_source_sha" \
  --base-ref "$DHPK_PREFLIGHT_BASE_REF" \
  --classification-file "$DHPK_PREFLIGHT_CLASSIFICATION_FILE" \
  --out "$dhpk_plan_file"

dhpk_surfaces_csv=$(node -e 'const fs = require("node:fs"); const plan = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(plan.packageSurfaces.join(","));' "$dhpk_plan_file")
dhpk_validate_args=(
  --plan "$dhpk_plan_file"
  --base-sha "$DHPK_PREFLIGHT_BASE_SHA"
  --head-sha "$dhpk_source_sha"
  --checkout-sha "$dhpk_source_sha"
  --base-ref "$DHPK_PREFLIGHT_BASE_REF"
  --classification-file "$DHPK_PREFLIGHT_CLASSIFICATION_FILE"
  --require-clean
)
if [[ -n "$dhpk_surfaces_csv" ]]; then
  dhpk_validate_args+=(--surfaces "$dhpk_surfaces_csv")
fi
node scripts/ci/ci-plan.js validate "${dhpk_validate_args[@]}"

dhpk_packages=$(mktemp -d /tmp/dhpk-packages.XXXXXX)
dhpk_packages=$(cd "$dhpk_packages" && pwd -P)
dhpk_surfaces=()
if [[ -n "$dhpk_surfaces_csv" ]]; then
  IFS=, read -r -a dhpk_surfaces <<< "$dhpk_surfaces_csv"
  for surface in "${dhpk_surfaces[@]}"; do
    bin/dhpk distribution "$surface" generate \
      --output "$dhpk_packages/$surface" --version="$DHPK_PACKAGE_VERSION" --json
  done
fi
```

Copy only generated outputs owned by the selected surfaces and commit those
outputs as commit G. Then run selected platform verification on G. The preflight
plan is bound to source commit S; final CI builds a fresh B..G plan. Keep the S
plan as source-commit evidence and never validate it on G.

```bash
if [[ ${#dhpk_surfaces[@]} -gt 0 ]]; then
  dhpk_verify_args=()
  for surface in "${dhpk_surfaces[@]}"; do
    dhpk_verify_args+=(--surface "$surface")
  done
  node scripts/ci/verify-platform-packages.js "${dhpk_verify_args[@]}"
fi
```

Regenerate and check the Claude marketplace when the plan records that
companion. For a release or explicit unfiltered platform request, generate and
verify all four platforms from the same clean source commit, regenerate and
check the Claude marketplace, commit all owned outputs, and run `npm run ci`
on the clean generated-output commit. That aggregate includes repository
validation, generated-output checks, catalog checks, and the complete test
suite. Report its result separately from scoped checks and hosted CI.

The project-local `.agents/skills` compatibility projection is generated from
the same canonical `skills/` tree and is not hand-edited:

```bash
npm run check:local-skills
# For an authorized local install/update, preserving ownership checks:
npm run sync:local-skills
```

These aliases use the existing no-argument generator/validator compatibility
route; synchronization passes `--update` before validation. Run the check after
syncing a checkout with `.agents/skills/.dhpk-projection.json`. Fresh-checkout
package CI does not depend on a developer's ignored installation. Back up local
content before repair and resolve reported conflicts without overwriting
modified or unmanaged files.

For an external consumer project, pass `--source-root`, `--project-root`, the
explicit `portable-core` profile, and the requested Hosts; the shared publisher
then writes a self-contained artifact, a project receipt at
`.agents/.dhpk-installed.json`, and a Claude discovery binding when Claude is
selected. Project-only selectors accept `skill:<id>` and `module:<id>`; bare
IDs require a unique inventory entity. Modules participate in dependency closure
but only skills are emitted. Lifecycle receipts use
`dhpk.project-agent-projection-receipt.v2` with typed selected/emitted identities
and source-fingerprint keys. A validated v1 emitted `skills/` source proves skill
identity; a selected-only v1 ID requires unique inventory resolution. Ambiguous
legacy identity blocks publication and cleanup before mutation. The generated
artifact manifest retains `dhpk.agents-skills-projection.v1`.

AGY sibling-package references remain forbidden unless a bounded
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
[`skills/tdd-workflow/references/tests.md`](../../skills/tdd-workflow/references/tests.md) rules and
the repository reviewer checklist in
[`CODING_STANDARDS.md`](../../CODING_STANDARDS.md#tests).
