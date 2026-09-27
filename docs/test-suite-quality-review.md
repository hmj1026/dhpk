# Test suite quality review

## Goal and scope

Review at least 79 of the 393 flat `tests/*.test.js` files in the original
inventory (20%, rounded up). Review is the target; there is no deletion or edit
quota. Record a disposition and evidence for every reviewed file. The two
already removed files count toward the 79.

Prioritize duplicate tests and weak assertions. A weak assertion either fails
to detect an error in the contract it claims to protect or repeats a contract
already fully asserted elsewhere. File length, static text checks, and a lack
of unique JavaScript execution ranges are candidate signals, not deletion
proof. A precise check of a public command, document, configuration, or
publication artifact can protect an independent contract.

For each candidate, identify its contract and assertion owner. Delete only
when another discovered test fully owns the same contract. Rewrite a weak test
that owns an independent contract to assert behavior. Keep independent
document, configuration, installation, and security assertions. Preserve the
script coverage obligation in [Issue #470 test governance](issue-470-test-governance.md)
and the named safety branch obligations in
[ADR-0017](adr/0017-implement-review-gate-as-a-local-event-module.md).

## Review and acceptance

1. Inventory the full suite and rank candidates using duplicate evidence,
   assertion intent, and measured coverage. Judge each candidate manually.
2. Review 5–10 candidates per batch. Record `keep`, `rewrite`, or `delete`,
   the owned contract, replacement assertion when relevant, and evidence.
3. For a change, run its focused tests and compare line and branch coverage
   for every affected production file before and after. Neither measure may
   decrease. Record unrelated run-to-run coverage drift separately.
4. Run `node scripts/ci/catalog.js --check` so every required script retains
   a test owner. A clean CI run of the full suite is the final release gate;
   local runs from a dirty checkout can fail provenance checks.

## Disposition ledger

| Test file | Disposition | Contract and replacement evidence | Verification |
| --- | --- | --- | --- |
| `tests/claude-capability-bundle.test.js` | Delete | Only checked four exports; `tests/profile-scoped-claude-capability-bundle.test.js` calls the API and verifies profile selection, compilation, materialization, and verification behavior. `scripts/lib/claude-capability-bundle.js` maps to that test in `COVERAGE_MAP`. | Focused before/after suites passed. Affected module: 679/797 covered lines and 227/314 covered branches on both sides. |
| `tests/retirement-closure.test.js` | Delete | Only checked an export and two property names; `tests/validate-retirement-closure.test.js` exercises acceptance and rejection cases through the validator. `scripts/lib/retirement-closure.js` maps to that test in `COVERAGE_MAP`. | Focused before/after suites passed. Affected module: 478/515 covered lines and 150/201 covered branches on both sides. |

### Issue #642 — Cohort A batch 01

| Test file | Disposition | Owned contract and overlapping owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/activate-modules.test.js` | Keep | Python module activation output (`WARN`, `MODULE`, `ACTIVE`), missing metadata fallback, dependency warnings, CSV deduplication, and empty arguments; no other suite asserts this exact output protocol. | Discovered by `tests/run-all.js`; 6/6 passed. |
| `tests/agent-facing-contract.test.js` | Keep | Cross-tree agent/skill/rule/command metadata, guidance links, issue-body stdin safety, and doc-reviewer schema reference; narrower validators do not own the combined guidance and link contract. | Discovered by `tests/run-all.js`; 8/8 passed. |
| `tests/agent-plugin-package.test.js` | Keep | Agent Plugin package provenance, validator CLI surface, fail-closed missing/unloadable package behavior, and generator usage/exit contract. `validate-agent-plugin-package.test.js` partially overlaps validation, but not these CLI and provenance checks. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/agent-skill-integrity.test.js` | Rewrite | The previous parser searched inline `skills: [...]` anywhere in the file, missing block-list frontmatter and matching body examples. The frontmatter parser now handles supported inline and block-list forms, rejects unsupported syntax visibly, and sends parsed names through the same canonical-name validator used by the inventory scan. A regression proves `stale-skill` is reported while body-only `body-example` is ignored; the moved-package-path assertion remains. | Discovered by `tests/run-all.js`; 5/5 passed, including the stale-reference regression. |
| `tests/agents-skills-package.test.js` | Keep | Project multi-host projection shapes, receipt ownership, update authority, migration, rollback/uninstall, collision handling, and symlink/secret protections. These project-level lifecycle contracts are distinct from the AGY package and user installer suites. | Discovered by `tests/run-all.js`; 33/33 passed. |
| `tests/agy-adapt-agents-extended.test.js` | Keep | AGY frontmatter adaptation for tools/models, rejection of unknown model values, inherited default, and idempotence; no other suite owns this transform contract. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/agy-adapt-agents.test.js` | Keep | Adapter CLI usage, staging rewrite/reporting, fingerprint validation, and refusal of install roots, symlinked staging roots, and tampered packages; distinct from its frontmatter-transform suite. | Discovered by `tests/run-all.js`; 8/8 passed. |
| `tests/agy-path-contract.test.js` | Keep | Inventory-owned canonical/legacy AGY paths, isolated-home resolution, and rejection of unsafe, duplicate, incomplete, or malformed paths; no other suite owns the public path contract. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/agy-plugin-install.test.js` | Keep | User-level AGY target migration and receipt-owned install/update/rollback, read-only lifecycle classification, collision and tamper refusal, symlink boundaries, and aggregate byte budget. No other suite fully owns the installer lifecycle. | Discovered by `tests/run-all.js`; 27/27 passed. |
| `tests/agy-plugin-package.test.js` | Keep | AGY publication selection, complete physical skill content and references, deterministic output, provenance, and rejection of secrets, foreign files, traversal, and source symlinks. Package installation tests do not replace publication validation. | Discovered by `tests/run-all.js`; 16/16 passed. |

All ten paths are recursively discovered by the aggregate `tests/run-all.js`
route in CI. None is listed in the separate Darwin installer subset in
`tests/_lib/macos-installer-files.js`. The focused aggregate run used Node
`v24.21.0` with `DHPK_TEST_JOBS=4`: all 10 files and 115 tests passed. The
rewrite's failing contract case was first observed red against the old parser;
after the change, the 5-test suite and the complete batch passed. No production
file changed, so the per-production-area before/after coverage requirement does
not apply to this test-only rewrite. `node scripts/ci/catalog.js --check`
passed with all required scripts covered.

The primary support asset `tests/_lib/tinytest.js` is audited and kept. It has
393 consumers and owns shared test registration/results plus physical temp-root
normalization; `tests/physical-tmpdir.test.js` separately protects that
normalization contract. It is useful shared infrastructure, not stale or
duplicated behavior, and was not edited in this batch.

**Progress:** 12 of 79 files reviewed; 67 more reviews required. The coverage
comparison above used V8 data converted with c8. The full-suite local run did
not provide a clean pass: provenance tests require a clean checkout, and one
baseline run had an additional intermittent audit assertion. Aggregate covered
line and branch counts increased after the two deletions, but 13 unchanged
files showed small branch-count drift. The focused comparison above is the
evidence for those two dispositions; clean CI remains the full-suite gate.

## Frozen review queues

### Cohort A — issue #640

The queue is frozen from commit `be3008af83d31e67a7c37797fd397deaf9726cc4`.
The complete original C-sorted list of 393 flat `tests/*.test.js` paths is in
[the review inventory](test-suite-review-inventory.csv). Its SHA-256 is
`0ba3b1d4b341386e4ef24a369c95d0c5bb6d9029393af8cc63f62d4949fce6ce`, computed
from the relative paths joined with LF and a final LF. The two prevalidated
deletions remain rows in the inventory and do not consume active queue slots.
Filtering them leaves 391 active suites: cohort A is active ordinals 1–196
(original ordinals 1–197), and cohort B is active ordinals 197–391 (original
ordinals 198–393). A suite belongs to one cohort only.

Issue #640 owns the first 196 active paths. Issues #642–#661 receive those
paths in stable order: batches 01–16 have 10 suites each and batches 17–20
have 9 each. The prevalidated deletion at original ordinal 26,
`tests/claude-capability-bundle.test.js`, is attached to A batch 03 / issue
number #644, pending implementation in that batch PR. The deletion at original
ordinal 247, `tests/retirement-closure.test.js`, is attached to B batch 05 / issue
number #666, pending implementation there. Neither file is counted as an
active suite or silently removed from the inventory.

The CSV records candidate signals and stable ranks for triage. The rank sorts
by forwarding-test reuse count (descending), repeated test-title count
(descending), total assertion-call count (ascending, to surface low-assertion
suites), API-shape assertion count (descending), static-artifact matcher
assertion count (descending), then measured suite-specific script lines and
branches covered (ascending), with active ordinal as the final tie-breaker.
The assertion categories are reproducible lexical proxies for assertion
intent, not semantic judgments; the listed counts and rank make each ordering
step auditable. These are triage signals, not deletion recommendations. Test
owners must still identify the protected contract, inspect the assertion, and
prove replacement ownership before choosing `keep`, `rewrite`, or `delete`.
Static document, configuration, installation, publication, and security
contracts remain candidates for retention even when they execute little or no
production JavaScript.

For the execution signal, each of the 196 A suites was run independently
through the aggregate entry point on Node `v24.21.0` / Darwin with c8 `10.1.3`:

```sh
npx --yes c8@10.1.3 \
  --temp-directory "$V8_DIR" \
  --report-dir "$REPORT_DIR" \
  --reporter=json-summary \
  node tests/run-all.js "$SUITE_PATH"
```

Every isolated run passed. Each run used fresh V8 and report directories; the
inventory's line and branch figures count covered `scripts/` code and omit
`scripts/lib/bounded-child-process.js`, which the aggregate runner loads for
every suite. These per-suite values only rank candidates. For a batch change,
record a separate before/after comparison for each affected production file
using the same Node version, platform, environment, aggregate entry point, and
focused test set, with fresh coverage directories on both sides. Batch owners
must also run the focused tests and `node scripts/ci/catalog.js --check`.

The static ownership scan found 24 helpers in `tests/_lib/` and 30 fixtures in
`tests/fixtures/`. It follows static `require` edges through helpers, literal
fixture names, and exact fixture-directory loads. It assigns 23 assets with A
consumers to the lowest-original-ordinal A consumer as primary owner. Thirty
assets with B consumers are reserved for the B queue. The remaining fixture,
`tests/fixtures/subagent-stop/lin-blog-2026-07-17.json`, has no static consumer
and is explicitly held for an ownership audit in issue #641. These assignments
are recorded per path in the CSV; batch owners must verify actual ownership
before changing shared support files.

Nine A suites are also in the macOS installer subset listed by
`tests/_lib/macos-installer-files.js` (11 files total). Discovery uses sorted
recursive `tests/**/*.test.js` files while excluding `_lib`; the aggregate
runner accepts one explicit suite path for focused measurements. CI also runs
the macOS subset. Every PR still needs a clean full CI pass because local runs
from a modified checkout can fail provenance checks.
