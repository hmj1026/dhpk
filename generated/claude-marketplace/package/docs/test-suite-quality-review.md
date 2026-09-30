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
| `tests/claude-capability-bundle.test.js` | Delete | Only checked four exports; `tests/profile-scoped-claude-capability-bundle.test.js` calls the API and verifies profile selection, compilation, materialization, and verification behavior. `scripts/ci/catalog.js` explicitly maps `scripts/lib/claude-capability-bundle.js` to that behavioral suite in `COVERAGE_MAP`. | Implemented in #644. Paired focused runs retained 679/797 covered lines and 227/314 covered branches for the affected module before and after deletion. |
| `tests/retirement-closure.test.js` | Delete | Only checked an export and two property names; `tests/validate-retirement-closure.test.js` exercises acceptance and rejection cases through the validator. `scripts/lib/retirement-closure.js` now maps to that test in `COVERAGE_MAP`. | Implemented in #666. Paired focused runs retained 478/515 covered lines and 150/201 covered branches for the validator module. `scripts/ci/catalog.js` rose from 297/371 to 298/372 covered lines while retaining 23/46 covered branches. |

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

### Issue #643 — Cohort A batch 02

| Test file | Disposition | Owned contract and assertion owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/api-exec.test.js` | Rewrite | `skills/dhpk-feature-verify/scripts/api-exec.sh` must reject PUT, PATCH, and DELETE before calling curl. The old DELETE-only assertion checked status/message but had no invocation sentinel; it now tests all three methods against a temporary curl stub and asserts no marker. Entry-isolation fixtures cover success/transport failure, not this no-invocation contract. | Discovered by `tests/run-all.js`; 3/3 passed. A controlled curl-before-rejection mutation failed on the no-invocation assertion; the source script was restored. |
| `tests/asset-inventory.test.js` | Keep | `scripts/lib/asset-inventory.js` inventory counts and paths, optional manifest fallback, and file/entry/depth budgets; this suite owns inventory traversal assertions. | Discovered by `tests/run-all.js`; 6/6 passed. |
| `tests/bootstrap-dhpk-plugin-validation.test.js` | Keep | The bootstrap validator's documented Claude-root versus Codex-native validation boundary; no other suite fully asserts this boundary. | Discovered by `tests/run-all.js`; 3/3 passed. |
| `tests/bounded-child-process.test.js` | Keep | `scripts/lib/bounded-child-process.js` timeout cleanup of descendant process groups, including children that ignore SIGTERM; `tests/run-all.js` imports this runner. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/bounded-filesystem.test.js` | Keep | `scripts/lib/bounded-filesystem.js` byte and entry budgets, real-directory cycle detection, symlink refusal, and changed-size refusal; these traversal safety contracts have no full replacement owner. | Discovered by `tests/run-all.js`; 5/5 passed. |
| `tests/capability-bundle-activation.test.js` | Keep | `scripts/lib/capability-bundle-activation.js` preserves staged artifacts unless verification is PASS and activates only a passing artifact; distinct from bundle selection. | Discovered by `tests/run-all.js`; 2/2 passed. |
| `tests/capability-bundle-selection.test.js` | Keep | `scripts/lib/capability-bundle-selection.js` profile/standalone selection, fail-closed errors, fingerprints, receipt migration, and checked-in manifest contracts; no other suite fully owns these selection semantics. | Discovered by `tests/run-all.js`; 18/18 passed. |
| `tests/catalog-claims.test.js` | Keep | `scripts/ci/catalog.js` planted count drift and repair, script ownership, and projection-set drift. The catalog maps this suite as its ownership test; other catalog checks do not replace the drift cases. | Discovered by `tests/run-all.js`; 39/39 passed. |
| `tests/changelog-fragments.test.js` | Keep | `scripts/lib/changelog-fragments.js` parsing, validation, deterministic promotion, release coverage rules, and `.none` markers; no other suite owns the fragment lifecycle. | Discovered by `tests/run-all.js`; 22/22 passed. |
| `tests/check-codex-discovery.test.js` | Keep | `scripts/ci/check-codex-discovery.js` active/inactive/unknown provider verdicts, dangling-provider blocking, and redacted evidence; these provider-integrity contracts are independent. | Discovered by `tests/run-all.js`; 9/9 passed. |

All ten paths are discovered by the recursive `tests/run-all.js` route used by
CI. None is in the separate Darwin installer subset. The baseline and final
focused aggregate runs used Node `v24.21.0` with `DHPK_TEST_JOBS=4`; the final
run passed all 10 files and 111 tests. The temporary negative-control mutation
proved the rewritten no-curl assertion fails when curl is called before the
method rejection. No production file changed, so production-area line/branch
coverage comparison does not apply. `node scripts/ci/catalog.js --check`
passed with all required scripts covered. The frozen inventory assigns no
primary helper or fixture to issue #643, so there was no support asset to edit.

### Issue #644 — Cohort A batch 03

| Test file | Disposition | Owned contract and overlapping owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/check-cross-cli-drift.test.js` | Keep | Silent behavior when either CLI tree is absent, retired Gemini exclusion, and advisory threshold/output; no other suite owns this drift policy. | Discovered by `tests/run-all.js`; 6/6 passed. |
| `tests/check-plugin-version.test.js` | Keep | Silent verified/no-pin outcomes, incompatible and unverified advisories, and safe handling guidance; no other suite owns this check's result matrix. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/check-portability.test.js` | Keep | Bash syntax gate, prohibited idiom detection, and empty-tree failure; these portability contracts are independent of the cross-CLI scripts. | Discovered by `tests/run-all.js`; 5/5 passed. |
| `tests/ci-report.test.js` | Keep | Warning/error exit behavior, strict-mode override, and accumulated errors; no other suite fully asserts the report API. | Discovered by `tests/run-all.js`; 6/6 passed. |
| `tests/ci-review-gate-adapter.test.js` | Keep | Typed CI verification receipt, malformed/incomplete identity rejection, freshness invalidation, and separation from semantic review; no other suite owns this CI adapter contract. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/claude-profile-probe.test.js` | Rewrite | Retains the closed status vocabulary, unsafe-alias refusal, and path redaction. Adds behavioral rejection of a symlinked profile-tree entry and an existing receipt output outside the package root; the previous checks only established exported function types. | Discovered by `tests/run-all.js`; 3/3 passed. Two controlled mutations that ignored symlinks or allowed `../outside.json` made the corresponding assertions fail; production source was restored byte-for-byte. |
| `tests/claude-review-gate-adapter.test.js` | Keep | Lifecycle/verdict agreement, provenance and identity refusal, retry identity, fail-closed submission, and durable receipt integration; no other suite fully owns this adapter lifecycle. | Discovered by `tests/run-all.js`; 11/11 passed. |
| `tests/claude-user-config-probe.test.js` | Keep | Exact fingerprint/details binding, version and identity checks, prerelease mismatch, and conflicting fingerprint refusal; no other suite owns these configured-consumer checks. | Discovered by `tests/run-all.js`; 6/6 passed. |
| `tests/cli-dispatch-context.test.js` | Keep | Dispatch/execution identity binding, cross-provider and malformed-evidence refusal, bounded report data, AGY transport binding, and package-local projection; launcher checks do not replace context construction. | Discovered by `tests/run-all.js`; 10/10 passed. |
| `tests/cli-dispatch-launcher.test.js` | Keep | Pinned-parent writes, authority refusal before side effects, symlink containment, restricted runtime PATH, and bounded redacted diagnostics; no other suite owns the public launcher boundary. | Discovered by `tests/run-all.js` and the separate Darwin installer subset; 6/6 passed. |

All ten formal suites are discovered by the recursive `tests/run-all.js` route
used in CI. `tests/cli-dispatch-launcher.test.js` is also in the separate Darwin
installer subset; the other nine are not. The focused Node `v24.21.0` run with
`DHPK_TEST_JOBS=4` covered the ten formal suites plus the replacement
`tests/profile-scoped-claude-capability-bundle.test.js`: 11 files and 89/89
cases passed. In paired c8 runs, `scripts/release/claude-profile-probe.js`
coverage was 204/217 lines and 78/128 branches before, then 206/217 lines and
91/137 branches after. The deleted export-only test's replacement owner kept
`scripts/lib/claude-capability-bundle.js` at 679/797 covered lines and 227/314
covered branches on both sides.

The same #644 change added the replacement suite to the CI coverage ownership
map in `scripts/ci/catalog.js`. Paired c8 runs of the ten formal suites, the
replacement suite, and the catalog's mapped `tests/catalog-claims.test.js`
passed 12/12 files on Node `v26.10.0` / Darwin with c8 `10.1.3` on both
`989f72bf` and `c6f237b2`. Catalog coverage increased from 296/370 to 297/371
covered lines and retained 23/46 covered branches.

The three assigned support assets are audited and kept. `tests/_lib/review-gate-fixture.js`
has 8 consumers and supplies typed events, trust policies, authority receipts,
and store setup. `tests/_lib/workflow-coordinator-fixture.js` has 6 consumers
and builds isolated receipt histories plus authority/freshness receipts.
`tests/fixtures/review-gate/workflow-coordinator-v1.json` has 18 consumers;
its nine receipt IDs and eight named histories are all referenced, with no
dangling history IDs. None required an edit. `node scripts/ci/catalog.js --check`
passed with all required scripts covered.

### Issue #645 — Cohort A batch 04

| Test file | Disposition | Owned contract and overlapping owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/cli-role-resolver.test.js` | Keep | Canonical provider roles resolve to fixed modes and immutable contracts; aliases, conflicting identities, and authority/provider constraints fail closed. This owns the CLI role vocabulary. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/cli-worker-timeout-recovery.test.js` | Rewrite | Removed a hardcoded sample filename check for the retired `.pending-` prefix. `tests/partial-writer-handoff.test.js` owns generated marker naming and behavior; this suite retains its independent recovery documentation contract. | Discovered by `tests/run-all.js`; 12/12 passed. |
| `tests/codemaps-generate.test.js` | Keep | Codemap generation, expected fixture classification, and the empty-tree output contract. No other suite owns these generator outputs. | Discovered by `tests/run-all.js`; 3/3 passed. |
| `tests/codex-discovery-registry.test.js` | Keep | Provider identity, fingerprint arbitration, duplicate invokable-name blocking, precedence, and active/inactive native-provider behavior. These runtime registry semantics are distinct from package validation. | Discovered by `tests/run-all.js`; 16/16 passed. |
| `tests/codex-mcp-retirement.test.js` | Rewrite | Replaced a test-local imitation of the MCP-free settings scanner with a direct assertion that canonical Claude settings contain no `mcp__codex__` namespace grant; retained parity, route, owner, and validator checks. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/codex-native-activation.test.js` | Keep | Live activation result normalization, timeout configuration precedence, malformed output, and missing CLI behavior. No other suite owns this probe contract. | Discovered by `tests/run-all.js`; 15/15 passed. |
| `tests/codex-native-experimental-gate.test.js` | Rewrite | Retains native-candidate and inventory checks, and now checks the specific experimental-status statements in `docs/distribution-surfaces.md`, `README.md` → `## Sync Codex CLI content`, and `.codex-plugin/README.md` → `## Structure`. | Discovered by `tests/run-all.js`; 4/4 passed. Three controlled document mutations—one per statement—each failed at its matching assertion. |
| `tests/codex-native-install-smoke.test.js` | Rewrite | After deleting the staged source tree, compares each installed skill's relative file set and bytes against the tracked physical `plugins/dhpk/skills/` artifact; retains the live CLI, cache containment, and no-symlink checks. | Discovered by `tests/run-all.js`; 4/4 passed with `codex-cli` 0.157.1 and no skip. |
| `tests/codex-native-package-validate.test.js` | Keep | Candidate validation rejects path escapes, symlinks, membership drift, and lifecycle aggregates while accepting a physical tracked native package. Distinct from live installation and marketplace-manifest checks. | Discovered by `tests/run-all.js`; 10/10 passed. |
| `tests/codex-plugin-manifest.test.js` | Rewrite | Anchors semantic version to the complete `major.minor.patch` form and verifies marketplace name/version plus an exact source path to the tracked `plugins/dhpk` wrapper. | Discovered by `tests/run-all.js`; 9/9 passed. |

All ten suites are recursively discovered by the `tests/run-all.js` route used
by CI; none is in the separate Darwin installer subset. The focused baseline
was 10 files and 92 cases; the final Node `v24.21.0` run with
`DHPK_TEST_JOBS=4` passed 10 files and 91 cases. The assigned helper/fixture
inventory contains no support assets for this batch. No production source
changed, so production-file line and branch coverage did not apply. The
GitNexus could not resolve the five rewritten test files (`risk: UNKNOWN`);
repository text search confirmed the recursive test-discovery route, and the
focused aggregate run exercised all ten suites. The catalog check passed with
all required scripts covered.

### Issue #646 — Cohort A batch 05

| Test file | Disposition | Owned contract and overlapping owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/codex-review-gate-adapter.test.js` | Keep | Unit-level Codex adapter capability, activation, identity binding, readiness, lifecycle, verdict, and receipt rules. The neighboring E2E suite covers durable gate behavior, not this adapter conformance surface. | Discovered by `tests/run-all.js`; 20/20 passed. |
| `tests/codex-review-gate-e2e.test.js` | Rewrite | Real Review Gate PASS and CHANGES_REQUIRED journeys now reopen the receipt store at the returned revision and chain digest, then assert the persisted obligation, lane, verdict, and findings; CHANGES_REQUIRED also must disallow progress. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/codex-role-neighbors.test.js` | Keep | Neighbor policy across wrapped executable references, tables, case matching, escaped delimiters, and prose/path/version false positives. The runtime-contract suite checks committed role projections, not this parser boundary. | Discovered by `tests/run-all.js`; 8/8 passed. |
| `tests/codex-runtime-contract.test.js` | Keep | Committed and installed Codex role projections, runtime metadata, handoffs, invalid targets, and clean-consumer failure cases. This is broader than the neighboring-reference parser. | Discovered by `tests/run-all.js`; 19/19 passed. |
| `tests/codex-skill-layout.test.js` | Rewrite | Derives expected Codex mirror names from distribution-inventory skills on `codex-sync` and asserts exact set equality before checking canonical symlink targets; retains the README entry-count assertion. | Discovered by `tests/run-all.js`; 3/3 passed. An extra mirror entry was detected by a controlled negative mutation. |
| `tests/codex-skill-metadata.test.js` | Rewrite | Requires inventory skill names and paths to be unique and checks each canonical skill directory against its exact inventory path, while retaining Codex interface metadata and invocation checks. | Discovered by `tests/run-all.js`; 1/1 passed. A mutated inventory path failed the exact-path assertion. |
| `tests/codex-supporting-parity.test.js` | Rewrite | Replaces a hardcoded 37-file count with exact equality between manifest-derived Codex supporting destinations and the recursively materialized projection tree, including `codex/config.toml.example`; rejects symlinks and retains direct byte parity and transformed-source digest checks. | Discovered by `tests/run-all.js`; 3/3 passed. An unlisted projected file and a symlink each failed the membership check. |
| `tests/codex-timeout-envelope.test.js` | Keep | Versioned contained timeout envelope construction/parsing, bounded diagnostic tails, credential redaction, and malformed-envelope rejection. No other suite owns this serialization contract. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/command-front-door-parity.test.js` | Keep | Public command short-front-door identity, invocation class, usage grammar, forwarding authority, and non-use boundaries across command files. The namespace qualifier suite owns only the helper API. | Discovered by `tests/run-all.js`; 6/6 passed. |
| `tests/command-namespace.test.js` | Keep | Approved `dhpk` namespace constant and qualifier behavior for slash commands, already-qualified commands, dollar values, non-command values, and other namespaces. | Discovered by `tests/run-all.js`; 5/5 passed. |

All ten suites are recursively discovered by the `tests/run-all.js` route used
by CI and release; none is in the Darwin installer subset. The focused baseline
and final Node `v24.21.0` runs with `DHPK_TEST_JOBS=4` each passed 10 files and
78 cases. The frozen inventory assigns no helper or fixture assets to this
batch. No production source changed, so per-production-file line and branch
coverage comparison did not apply. GitNexus could not resolve the four rewritten
test files (`risk: UNKNOWN`); repository search and the focused run confirm
their discovery, while the graph verdict remains unresolved. The catalog check
passed with all required scripts covered.

**Progress after #646:** 52 of 79 files reviewed; 27 more reviews required. The coverage
comparison above used V8 data converted with c8. The full-suite local run did
not provide a clean pass: provenance tests require a clean checkout, and one
baseline run had an additional intermittent audit assertion. Aggregate covered
line and branch counts increased after the two deletions, but 13 unchanged
files showed small branch-count drift. The focused comparison above is the
evidence for those two dispositions; clean CI remains the full-suite gate.

### Issue #647 — Cohort A batch 06

| Test file | Disposition | Owned contract and overlapping owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/command-skill-disposition.test.js` | Keep | The canonical command disposition ledger, required owners, permissions, thin front doors, and exact removed-command set. The portability suite validates a synthetic v3 contract and does not replace these checks against the actual ledger. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/command-skill-portability.test.js` | Keep | v3 portability, shared Skill owners, forwarding authority, readable resources, and v2 migration compatibility. The disposition suite owns the canonical v2 inventory and removed wave. | Discovered by `tests/run-all.js`; 5/5 passed. |
| `tests/consolidate-remaining-dhpk-skill-families.test.js` | Keep | The frozen 21-row retirement map, active-name renames, profile identity, and mutation rejection cases. No neighboring suite owns this complete historical mapping. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/consumer-evidence-normalization.test.js` | Keep | Closed consumer status vocabulary, redaction, stage and surface identity, projection binding, and separation of structural from runtime evidence. Preflight tests own runner readiness rather than normalization. | Discovered by `tests/run-all.js`; 14/14 passed. |
| `tests/consumer-gate-cli.test.js` | Keep | Consumer gate routing, receipt ownership, Claude install and teardown, Codex named roles, fingerprints, and failure evidence. It is also the only batch suite in the Darwin installer subset. | Discovered by `tests/run-all.js` and the Darwin subset; 42/42 passed. |
| `tests/consumer-platform-probe.test.js` | Rewrite | Replaced a broad `UNAVAILABLE`/`NOT_RUN`/`BLOCKED` allowance with an executable-contract check for a valid Agent Plugin package: exit 0, top-level and per-surface `UNAVAILABLE`, and no consumer commands without `--execute`. Other platform and sandbox contracts remain. | Discovered by `tests/run-all.js`; 26/26 passed. |
| `tests/consumer-runtime-preflight.test.js` | Keep | Checkout identity, credential redaction, tool and sandbox readiness, receipt binding, and the separation of preflight from runtime evidence. The platform-probe suite owns platform-specific probe behavior. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/context-budget.test.js` | Keep | Discovery visibility, frozen aggregate counts and reductions, invalid-budget behavior, and the aggregate CLI wired into CI. No other suite owns this budget contract. | Discovered by `tests/run-all.js`; 7/7 passed. |
| `tests/cross-cli-parity.test.js` | Rewrite | Makes the shared file differ, verifies drift before allowlisting, then proves the exact allowlist entry suppresses that difference while retaining source-only and target-only file behavior. | Discovered by `tests/run-all.js`; 2/2 passed. |
| `tests/current-changelog.test.js` | Rewrite | Counts only an exact current-version heading followed by a space and rejects a controlled adjacent `<version>.1` heading; still asserts the real changelog has exactly one current section. | Discovered by `tests/run-all.js`; 1/1 passed. |

The Node `v24.21.0` focused baseline and final runs with `DHPK_TEST_JOBS=4`
both passed 10 suites and 119 cases. CI and release recursively discover these
tests through `tests/run-all.js`. The frozen inventory assigns no helper or
fixture assets to this batch. No production source changed, so production-file
line and branch coverage did not apply. GitNexus returned `risk: UNKNOWN` for
the three rewritten test-file impacts because those paths are absent from the
graph; repository search confirmed runner discovery in CI and release, while
the graph verdict remains unresolved. `node scripts/ci/catalog.js --check`
passed with all required scripts covered.

**Progress:** 62 of 79 files reviewed; 17 more reviews required.

### Issue #648 — Cohort A batch 07

| Test file | Disposition | Owned contract and overlapping owner | Discovery and verification |
| --- | --- | --- | --- |
| `tests/cursor-agent-probe.test.js` | Keep | Cursor agent probe output and command gating. The consumer-evidence suite owns evidence-envelope normalization, while this suite protects the agent probe contract. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/cursor-consumer-evidence.test.js` | Rewrite | Rejects evidence from the wrong producer or adapter, missing and duplicate claims, and symlinked evidence JSON; each invalid receipt selects `NATIVE_LINK`. | Discovered by `tests/run-all.js`; 11/11 passed. |
| `tests/cursor-harness-adapt.test.js` | Keep | Cursor harness adaptation behavior; package and consumer evidence suites cover separate package and receipt contracts. | Discovered by `tests/run-all.js`; 7/7 passed. |
| `tests/cursor-plugin-package.test.js` | Keep | Cursor plugin package construction and manifest contract, separate from sync-package behavior. | Discovered by `tests/run-all.js`; 3/3 passed. |
| `tests/cursor-session-home.test.js` | Rewrite | Verifies copied session-home files byte-for-byte against sources and confirms symlinked destination ancestors do not create the auth file. | Discovered by `tests/run-all.js`; 3/3 passed. |
| `tests/cursor-sync-package.test.js` | Keep | Cursor sync-package behavior and its owned package contract. | Discovered by `tests/run-all.js`; 4/4 passed. |
| `tests/default-hook-events.test.js` | Keep | Default hook event inventory; no other batch suite asserts this exact default set. | Discovered by `tests/run-all.js`; 1/1 passed. |
| `tests/dep-audit.test.js` | Rewrite | Adds a deterministic critical-vulnerability report case that must fail at `--level high`; existing command-failure cases are now explicitly characterized as a known fail-open defect tracked separately by issue #692. This batch does not change production audit behavior. | Discovered by `tests/run-all.js`; 9/9 passed. |
| `tests/description-invocation-cues.test.js` | Rewrite | Preserves the description-length check and requires an explicit effect cue such as `Output:` or `produces`, reporting offending skill paths. | Discovered by `tests/run-all.js`; 5/5 passed. |
| `tests/detect-phase.test.js` | Keep | Detect-phase behavior and its command contract, distinct from the dependency-audit and skill-description checks. | Discovered by `tests/run-all.js`; 8/8 passed. |

The Node `v24.21.0` baseline run passed 10 suites and 54 cases. The final run
passed 10 suites and 60 cases. CI and release recursively discover these tests
through `tests/run-all.js`. None of the ten suites belongs to the macOS installer
subset, and the frozen inventory assigns no helper or fixture assets to this
batch. No production source changed, so per-production-file line and branch
coverage comparison did not apply. GitNexus returned `risk: UNKNOWN` for the
four rewritten test-file impacts because those paths are absent from the graph;
repository search confirmed recursive runner discovery, while the graph verdict
remains unresolved. The catalog check passed with all required scripts covered.

The fail-open dependency-audit behavior is not fixed by this test-quality batch.
Issue #692 separately tracks the production security repair and its validation.

**Progress after #648:** 72 of 79 files reviewed; 7 more reviews required.

### Issue #649 — Cohort A batch 08

This batch keeps seven suites and rewrites three. The final case counts are
listed per suite.

| Test file | Disposition | Protected contract and overlap | Final cases |
| --- | --- | --- | ---: |
| `tests/dhpk-distribution.test.js` | Keep | Retained distribution surfaces, package validation and verification boundaries, generated output protections, and Flow Guide dependency closure. Neighboring compiler and projection suites cover narrower artifact stages. | 12 |
| `tests/dhpk-do-portable.test.js` | Keep | Flow Guide v3 route parsing, typed host and target results, availability, explicit-only dispatch, authority, and fail-closed handling. The lifecycle and dispatch suites own separate install and target-selection contracts. | 29 |
| `tests/dhpk-install-lifecycle.test.js` | Keep | Lifecycle plan identity, scope normalization, evidence result boundaries, inventory membership, recovery contract, and blocked write actions across host surfaces. | 10 |
| `tests/discover-models.test.js` | Rewrite | Asserts the exact returned agent, executable, source, fixed observation time, and both runner command/argument pairs while retaining parser, version, status, and missing-observation checks. | 3 |
| `tests/discovery-budget-parity-separation.test.js` | Keep | Keeps discovery-budget accounting independent from projection parity, including identity binding, unknown visibility, overflow, drift, and the legacy summary route. | 8 |
| `tests/dispatch-config-report.test.js` | Rewrite | Captures `main({})` and requires no output for defaults; explicit non-default settings must emit one parseable JSON line, while invalid-value diagnostics remain covered. | 2 |
| `tests/dispatch-config.test.js` | Keep | Canonical role-target precedence, bounded legacy inputs, invalid-target handling, and distinct catalog, Host access, runtime, and fallback diagnostics. The report suite owns only the opt-in output boundary. | 8 |
| `tests/dispatch-contract.test.js` | Keep | Canonical target and evidence shapes, closed Role/authority/Effort/transport vocabularies, Provider capability versus Host access, compatibility translation, and private-field rejection. | 13 |
| `tests/dispatch-engine.test.js` | Keep | Explicit and automatic target selection, Host-native preference, external Provider opt-in, evidence recording, and fallback constraints that prevent silent downgrade or repeated side effects. | 16 |
| `tests/dispatch-platform-validation.test.js` | Rewrite | Adds a SUCCEEDED/PASSED receipt with no probe and proves Host access and runtime remain NOT_RUN; existing cases continue to cover supplied access and probe evidence and incomplete catalog support. | 4 |

The initial focused baseline passed 10 suites and 104/104 cases. The final
focused run passed the three changed suites and 9/9 cases; the seven unchanged
suites retain 96 cases from the baseline, for 105 cases across the batch. CI
and release recursively discover these suites through `tests/run-all.js`; none
is in the macOS installer subset. The frozen helper/fixture inventory assigns
no primary support assets to this batch. No production source changed, so a
production-file coverage comparison did not apply. GitNexus returned
`risk: UNKNOWN` for the three edited test paths because the graph could not
resolve them. Repository text confirms recursive runner discovery and the CI
and release entry points; UNKNOWN remains unresolved, and the empty caller set
does not establish that a path is unused.

**Progress after #649:** 82 suites reviewed against the 79-suite minimum; the
target is met. Remaining numbered Cohort A issues continue afterward.

### Issue #650 — Cohort A batch 09

This batch keeps eight suites and rewrites two. The final case counts are
listed per suite.

| Test file | Disposition | Protected contract and overlap | Final cases |
| --- | --- | --- | ---: |
| `tests/dispatch-projection.test.js` | Keep | One canonical dispatch contract per configured surface, parity across surfaces, drift rejection, and Provider-independent role definitions. The dispatch contract suite owns the canonical shape rather than its projected copies. | 4 |
| `tests/dispatch-scheduler.test.js` | Rewrite | Provider quotas, conflicting scopes, Host-native fallback, dependency ordering, and lifecycle outcomes. The pre-aborted cancellation case now proves it returns `CANCELLED` without invoking `dispatch`; dispatch tests own target selection and adapter behavior. | 8 |
| `tests/dispatch.test.js` | Keep | Target resolution and receipts, fallback only before side effects, capability-blocked outcomes, and unsupported-target diagnostics. The scheduler suite owns wave planning and cancellation. | 4 |
| `tests/distribution-compiler.test.js` | Keep | Plan compilation, artifact materialization, consumer-stage verification, and external ownership provenance through the evidence result. Projection contract suites own the lower-level plan constraints. | 2 |
| `tests/distribution-inventory-regeneration.test.js` | Keep | Policy bootstrap and refresh behavior, path classification, fail-closed malformed inputs, and preservation of external ownership, usage contracts, and rename history during regeneration. Validation suites own acceptance of a supplied inventory. | 12 |
| `tests/distribution-inventory-validate.test.js` | Keep | Lifecycle and routing-family invariants, safe references, Claude projections, canonical inventory membership, supporting-asset digests, usage policy, external package ledger, and installation operation matrix. Regeneration suites own preserving those contracts across writes. | 31 |
| `tests/distribution-projection-contract.test.js` | Keep | Frozen deterministic plans, selection identity, surface policies, Native Codex allowlists, symlink policy, materialization aborts, stage-bound evidence, and external ownership fingerprints. Inventory suites own the checked-in source contract. | 20 |
| `tests/distribution-projection-inventory.test.js` | Keep | Checked-in projection declarations and rejection of missing, unsupported, or broadened selection policy. The larger projection contract suite tests compiler behavior on synthetic plans. | 3 |
| `tests/distribution-projection-parity.test.js` | Keep | Structural parity across equivalent declared inputs, fingerprint drift, duplicate IDs, stage validity, surface/profile binding, and external ownership provenance. Compiler tests own materialization and verification. | 6 |
| `tests/distribution-rollback-proof.test.js` | Rewrite | Prior-inventory rollback and preservation of published package trees after failed staging across Claude, Agent Plugin, Codex, and Cursor. It now proves `fastapi-pro` is present before deprecation, absent in the later generated set, and restored by rollback; failed Agent Plugin staging compares the full package tree and rejects leftover staging siblings. | 7 |

The focused baseline passed 10 suites and 97/97 cases. The final focused run
passed 10 suites and 97/97 cases; the two rewrites strengthen existing cases
without adding new test cases. CI and release recursively discover these tests
through `tests/run-all.js`. None belongs to the macOS installer subset, and the
frozen helper/fixture inventory assigns no primary support assets to this
batch. No production source changed, so production-file line and branch
coverage comparison did not apply. GitNexus impact listed both test files but
returned no caller edges or affected processes. Since `tests/run-all.js`
discovers suites through filesystem recursion, the graph does not establish
their discovery edges; treat that graph coverage as `UNKNOWN`/unresolved. Text
search confirms the aggregate runner and its CI and release entry points, and
the empty graph result does not imply a test is unused.

**Progress after #650:** 92 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #651 — Cohort A batch 10

This batch keeps seven suites and rewrites three. Each suite retains its
baseline case count; the focused aggregate covers 66 cases before and after.

| Test file | Disposition | Protected contract and assertion owner | Baseline cases | Final cases |
| --- | --- | --- | ---: | ---: |
| `tests/distribution-scoped-counts.test.js` | Keep | Canonical, promoted-core, optional, experimental, deprecated, Claude-published, Codex-published, and module lifecycle totals are independently derived; bilingual README prose cannot label canonical total as the default-install count. | 8 | 8 |
| `tests/distribution-selection-plan-binding.test.js` | Keep | Every migrated adapter preserves the compiler's canonical selection identity in its output plan. | 1 | 1 |
| `tests/doc-reviewer-coupled-check.test.js` | Rewrite | Normative coupling requires the same in-batch finding pattern, one finding with both locations, and no second dispatch or rewrite. Each of the five assigned fixture filenames now maps to test-owned expected coupling, finding, and artifact counts. | 9 | 9 |
| `tests/documentation-platform-parity.test.js` | Rewrite | Bilingual platform documents, command namespaces, install receipts, locale parity, host boundaries, and lifecycle guidance. README count checks now bind canonical, Codex native, and hook counts to their semantic table rows and module count to each opening introduction. | 11 | 11 |
| `tests/emit-review-gate.test.js` | Keep | Shell syntax, PENDING/READY/BLOCKED receipt output and exit status, and usage errors for unknown or missing states. | 6 | 6 |
| `tests/execution-policy-kernel.test.js` | Rewrite | The always-visible kernel retains its safety/completion boundaries; flow-guide points to its local policy bundle, whose text names the kernel before conditional sections; context tiers and the cold packet remain complete. | 3 | 3 |
| `tests/extract-compact.test.js` | Keep | Compact extraction preserves populated and empty-array output contracts and reports missing or nonexistent input paths as errors. | 4 | 4 |
| `tests/extract-notes.test.js` | Keep | Release-note extraction selects the target heading body through the next heading or end of file, and rejects missing, empty, or whitespace-only sections. | 5 | 5 |
| `tests/fast-worker-selection.test.js` | Keep | Native defaults, project/user/one-shot precedence, explicit external selection, opt-in external auto-probing, fallback limits, authorization failures, normalized selectors, activation-only session start, and report schemas. | 14 | 14 |
| `tests/feature-resolver.test.js` | Keep | Slug validation and document confidence classification, explicit feature-key scanning, and invalid-key/no-signal behavior that returns an empty Gate:Need-Human result. | 5 | 5 |

All five assigned `tests/fixtures/doc-reviewer/*.json` files are actively read
and checked by `tests/doc-reviewer-coupled-check.test.js`; their verification
annotations remain static-only and do not claim a reviewer was run. The fixture
files themselves are unchanged. All ten suites are recursively discovered by
`tests/run-all.js` in CI and release; none is in the separate macOS installer
subset. The Node `v24.21.0` focused baseline passed 10 suites and 66/66 cases;
the final aggregate passed 10 suites and 66/66 cases. No production source
changed, so production coverage comparison does not apply. GitNexus returned
`risk: UNKNOWN` for the three rewritten test paths because they are not
resolvable in the graph. Text search confirms recursive test discovery and
the CI/release entry points; `UNKNOWN` remains unresolved and is not evidence
that the paths are unused. The catalog check passed with all required scripts
covered.

**Progress after #651:** 102 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #652 — Cohort A batch 11

This batch keeps three suites and rewrites seven. It retains the baseline case
count of 77 across all ten suites.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/flow-contract.test.js` | Rewrite | A route result adapts to the neutral handoff without losing owner, Host, disposition, availability evidence, or next action. | 6 |
| `tests/flow-drive-invocation.test.js` | Keep | Flow Drive's documented options, immutable context, worker target separation, malformed-target refusal, and retired-option rejection. | 6 |
| `tests/flow-guide-ownership.test.js` | Rewrite | Flow Guide owns routing and publishes exactly the five supported actions in the declared order. | 9 |
| `tests/flow-guide-usage-help.test.js` | Rewrite | Help output contains every generated catalog name exactly once in deterministic order; per-skill cards and diagnostic distinctions remain covered. | 6 |
| `tests/flow-handoff-contract.test.js` | Rewrite | The shared handoff validates Host and evidence vocabularies, rejects private fields, preserves role/provider/model/effort/transport, and freezes nested values. | 3 |
| `tests/frontmatter.test.js` | Keep | YAML frontmatter parsing, duplicate-key detection, scalar and BOM/CRLF handling, and nested invocation-class behavior. | 16 |
| `tests/gate-runner.test.js` | Rewrite | The runner records exact commands and exit codes, names failing steps, and executes a real later-step side effect after an earlier failure. | 5 |
| `tests/gemini-cli-retirement.test.js` | Keep | Retired Gemini CLI references stay absent while the AGY adapter and native package remain documented. | 5 |
| `tests/gen-agent-plugin-package.test.js` | Rewrite | Matrix selection emits only selected skills; MCP transport/path and credentials failures identify the exact invalid servers and reasons. | 19 |
| `tests/gen-agents-skills.test.js` | Rewrite | Compatibility and external project generation bind selected/emitted skill identity, profile fingerprints, managed paths, file fingerprints, and representative output. | 2 |

The Node `v24.21.0` focused aggregate run passed all 10 suites and 77/77
cases. Seven byte-restored negative controls were detected: route handoff
mapping, the exact Flow Guide action set, omission from the generated help
catalog, handoff transport normalization, fail-fast gate execution, MCP invalid
sibling acceptance, and external project profile identity. All ten suites are
recursively discovered by `tests/run-all.js` in CI and release; none belongs to
the macOS installer subset. No production source changed, so production-file
coverage comparison does not apply. The GitNexus impact walk returned
`risk: UNKNOWN` for all ten test paths in a fresh isolated worktree index;
text confirms aggregate-runner and CI/release discovery, while UNKNOWN remains
unresolved and is not an unused-path verdict. There are no assigned primary
helper or fixture edits in this batch.

**Progress after #652:** 112 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #653 — Cohort A batch 12

This batch keeps three suites and rewrites seven. It retains the baseline case
count of 131 across all ten suites.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/gen-claude-manifest-generate.test.js` | Rewrite | Exact Claude roots, registered skill IDs, and generated skill IDs are derived from the inventory. | 6 |
| `tests/gen-claude-manifest.test.js` | Rewrite | A clean manifest passes; isolated extra-root and missing-root drift each produce the exact diagnostic. | 3 |
| `tests/gen-claude-marketplace-package.test.js` | Rewrite | Marketplace entry names the canonical physical package and every manifest asset exists in that package. | 5 |
| `tests/gen-claude-profile-bundles.test.js` | Rewrite | Plan identity and SHA-256 fingerprints are bound; `--plan` is read-only; compat-v1 IDs equal the manifest allowlist. | 10 |
| `tests/gen-claude-user-config.test.js` | Rewrite | `--check` reports a candidate fingerprint without changing the active manifest; malformed authoritative metadata is rejected. | 1 |
| `tests/gen-codex-agents.test.js` | Keep | Exact role allowlist, executable-neighbor refusals, byte determinism, references, and role-specific policy remain covered. | 12 |
| `tests/gen-codex-native-package.test.js` | Keep | Package selection, bytes and modes, stale-file removal, provenance, traversal limits, symlink rejection, and CLI materialization remain covered. | 18 |
| `tests/gen-cursor-plugin-package.test.js` | Rewrite | Credential rejection uses a valid output path, and output overlap independently reports its own failure. | 59 |
| `tests/gen-cursor-sync.test.js` | Keep | Linked mirror, frontmatter, validator, install, source-protection, and path-mapping contracts remain covered. | 14 |
| `tests/gen-dispatch-projection.test.js` | Rewrite | Payload fingerprint binds all data; stdout matches `--out`; `--all` emits the exact seven unique surfaces. | 3 |

The focused aggregate passed all 10 suites and retained 131/131 cases. Ten
byte-restored negative controls were detected in an isolated disposable
worktree: an extra Claude root, an unreported missing root, marketplace source
redirection, plan output creation, compat identity substitution, activation
during `--check`, acceptance of malformed metadata, URL credential acceptance,
host data changed without a fingerprint update, and a duplicate dispatch
surface. `scripts/ci/catalog.js --check`, marketplace generation and `--check`,
and `git diff --check` passed. The batch changes tests and review documentation
only; no production code, helper, or fixture changed. The ten suites are
recursively discovered by `tests/run-all.js` in CI and release; none is in the
macOS installer subset. GitNexus returned `risk: UNKNOWN` for every test path
in a fresh isolated index. Text confirms recursive runner and CI/release
discovery, while UNKNOWN remains unresolved and is not an unused-path verdict.

**Progress after #653:** 122 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #654 — Cohort A batch 13

This batch rewrites six suites and keeps four. The ten suites retain all 96
baseline cases.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/gen-distribution-inventory.test.js` | Rewrite | The classifier path set exactly matches on-disk canonical `SKILL.md` files in both directions, so an omitted skill is detected. | 25 |
| `tests/gen-skill-usage.test.js` | Rewrite | A valid copied catalog passes first; drift to only the temporary catalog copy fails with the generated-catalog drift diagnostic. | 6 |
| `tests/git-flow-governance.test.js` | Keep | Git-flow governance document and policy ownership remain independently covered. | 5 |
| `tests/git-provider-review-gate-adapter.test.js` | Rewrite | Each of the five required identity fields is rejected when missing, before the store can append a receipt. | 7 |
| `tests/harness-audit.test.js` | Rewrite | Hooks scope includes a hook check and excludes a non-hook repo check. | 9 |
| `tests/harness-docs.test.js` | Rewrite | Published phase order and every outcome-to-exit row are pinned to the public workflow document. | 2 |
| `tests/harness-facade-cli.test.js` | Keep | The facade CLI's command-line behavior and exit contract remain independently covered. | 29 |
| `tests/harness-facade-contract.test.js` | Keep | The facade's public phase, result, and receipt contracts remain independently covered. | 4 |
| `tests/harness-govern-security.test.js` | Keep | Harness governance security boundaries remain independently covered. | 7 |
| `tests/harness-govern-toml-fallback.test.js` | Rewrite | The fallback parser is compared with stdlib `tomllib` using tracked `codex/agents` TOMLs; an empty fixture set cannot silently skip the check. | 2 |

The focused aggregate passed all ten suites and retained 96/96 cases. The
recursive `tests/run-all.js` route discovers these suites in CI and release.
No production source, helper, or fixture changed. GitNexus impact returned
`UNKNOWN` for all ten test paths. Text confirms recursive discovery, but
`UNKNOWN` remains unresolved and is not evidence that a path is unused.

**Progress after #654:** 132 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #655 — Cohort A batch 14

This batch rewrites four suites and keeps six. The focused baseline and final
runs both passed 10/10 suites and 81/81 live cases. The frozen inventory's
`test_case_count` for unchanged `tests/install-assets.test.js` is 18, while its
live suite registers 28 cases. The frozen metric therefore undercounts the live
aggregate by ten; the suite and frozen numeric metric remain unchanged.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/harness-operation-receipts.test.js` | Rewrite | The receipt validator separately identifies first-event digest corruption and second-event chain-hash corruption. | 4 |
| `tests/harness-platform-matrix.test.js` | Rewrite | A required surface without a matching projection contract is reported by the validator; the test no longer compares fabricated status literals. | 5 |
| `tests/harness-receipt-identity-lifecycle.test.js` | Keep | Receipt identity and lifecycle transitions remain independently covered. | 9 |
| `tests/harness-release-aggregation.test.js` | Keep | Aggregate release outcome and per-surface evidence remain independently covered. | 15 |
| `tests/harness-surfaces.test.js` | Keep | Public harness surface declarations remain independently covered. | 1 |
| `tests/harness-workflow-config.test.js` | Keep | Harness workflow configuration and validation remain independently covered. | 4 |
| `tests/health-probe.test.js` | Keep | Health probe outcome classification remains independently covered. | 2 |
| `tests/hooks-wiring.test.js` | Rewrite | Each hook event asserts its exact command, type, and argument list, rejecting extra or changed wiring. | 8 |
| `tests/install-agy-plugin.test.js` | Rewrite | Install report paths stay within the target and exist before rollback; rollback reports those files as removed and leaves none behind. | 5 |
| `tests/install-assets.test.js` | Keep | Installer asset discovery and materialization remain independently covered. | 28 |

The focused aggregate passed all ten suites and 81/81 live cases. All ten
suites remain recursively discovered by `tests/run-all.js` in CI and release.
The paired coverage runs used Node `v24.21.0`, c8 `10.1.3`, the same ten-suite
aggregate with two workers, and fresh output directories at baseline commit
`c402ce432afa9bd7a6cdc575832e8f5671c26df0` and the final tree. No measured
production file lost covered lines or branches; relevant files were:

| Production file | Lines before → after | Branches before → after |
| --- | ---: | ---: |
| `scripts/lib/harness-receipt.js` | 527/639 → 527/639 | 146/251 → 147/252 |
| `scripts/lib/receipt-primitives.js` | 385/797 → 385/797 | 89/146 → 89/146 |
| `scripts/lib/distribution-inventory.js` | 581/2518 → 581/2518 | 62/96 → 62/96 |
| `scripts/ci/install-agy-plugin.js` | 51/59 → 51/59 | 18/25 → 18/25 |
| `scripts/lib/agy-plugin-install.js` | 611/837 → 611/837 | 128/223 → 128/223 |
| `scripts/lib/agy-plugin-package.js` | 565/706 → 565/706 | 100/214 → 100/214 |

No helper or fixture was assigned to this batch as a primary owner, and no
production source, helper, or fixture changed. Four disposable mutation
controls all made their matching suite fail: suppressing chain validation,
skipping the `agy-plugin` projection check, adding an extra edit-hook argument,
or retaining an installed `agents/` file after rollback. GitNexus impact returned
`UNKNOWN` for all four rewritten test paths; text confirms recursive suite
discovery, while UNKNOWN remains unresolved and is not an unused-path verdict.

**Progress after #655:** 142 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #656 — Cohort A batch 15

This batch rewrites three suites and keeps seven. The focused baseline and
final runs both passed 10/10 suites and 156/156 live cases.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/install-codex-runtime-assets.test.js` | Keep | Skill-local runtime bytes, copy refresh, ignored bytecode, staged-mutation refusal, and symlink rejection remain covered. | 5 |
| `tests/install-codex-skills-planning.test.js` | Keep | Read-only plans, provenance drift, collision adoption, crash recovery, and path safety remain covered. | 27 |
| `tests/install-codex-skills-reconciliation.test.js` | Keep | Codex materialization, migration, rollback, retirement, bytecode filtering, and reconciliation evidence remain covered. | 38 |
| `tests/install-codex-skills-uninstall.test.js` | Keep | Receipt-limited removal, quarantine recovery, reinstall, traversal and symlink refusal, and retargeted-link preservation remain covered. | 9 |
| `tests/install-codex-skills.test.js` | Keep | Provider conflict gating, bounded queries, blocked JSON, timeout descendant cleanup, and update behavior remain covered. | 16 |
| `tests/install-codex-sync-shared.test.js` | Keep | Shared Codex projection, cross-Host union, migration, edited/unowned preservation, Host-specific uninstall, and rollback remain covered. | 13 |
| `tests/install-cursor-harness.test.js` | Keep | Cursor native assets, evidence-gated bindings, migration, profile dependencies, uninstall, and user-content preservation remain covered. | 25 |
| `tests/install-native-shared-skills.test.js` | Rewrite | Each required install argument is independently omitted; every invocation must return usage failure without mutating the project. | 7 |
| `tests/install-prompts.test.js` | Rewrite | Missing-catalog initialization returns failure and leaves isolated working and home directory snapshots unchanged. | 3 |
| `tests/install.test.js` | Rewrite | The normal dry-run prints its command but neither invokes the Claude stub nor reports an installed result. | 13 |

The same focused aggregate was used before and after the edits. Coverage for the
three production files measured by the native shared-skills suite did not lose
covered lines or branches, using Node `v24.21.0`, c8 `10.1.3`, and fresh output
directories:

| Production file | Lines before → after | Branches before → after |
| --- | ---: | ---: |
| `scripts/ci/install-native-shared-skills.js` | 95/103 → 95/103 | 39/51 → 39/51 |
| `scripts/lib/native-shared-skill-install.js` | 172/206 → 172/206 | 30/50 → 30/50 |
| `scripts/lib/cursor-consumer-evidence.js` | 161/221 → 161/221 | 31/49 → 31/49 |

Three suites were rewritten. The batch's assigned helper,
`tests/_lib/install-codex-skills-fixtures.js`, was audited and kept unchanged:
it centralizes the Codex installer stub, isolated roots, receipts, packages,
and symlink fixtures shared by seven importing suites, with no stale or
duplicate behavior. No primary fixture was assigned. No production source,
helper, or fixture changed. Five disposable mutation controls all made their matching
suite fail: removing each of the three required-argument guards, writing a
marker during missing-catalog initialization, or invoking the Claude stub
while printing the dry-run message. GitNexus impact returned `UNKNOWN` for all
ten test paths; text confirms recursive discovery by the aggregate runner,
while `UNKNOWN` remains unresolved and is not evidence that a path is unused.

**Progress after #656:** 152 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #657 — Cohort A batch 16

This batch rewrites five suites and keeps five. The focused Node `v24.21.0`
baseline passed 10/10 suites and 60/60 live cases. The final aggregate passed
10/10 suites and 61/61 cases; the one-case increase is the always-running
Cursor missing-sandbox contract test. The frozen inventory remains unchanged;
`learning-db.test.js` registers 12 live cases in this environment because its
`jq` and no-`jq` test branches are mutually exclusive.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/internal-cli-transport-inventory.test.js` | Keep | Internal transport registration stays distinct from the generated invokable command inventory. | 1 |
| `tests/internal-runtime-skills.test.js` | Keep | Internal runtime support remains visible without becoming an invokable skill selection. | 2 |
| `tests/invocation-precedence.test.js` | Keep | Precedence SSOT, route resolution, invocation classes, and flow-guide routing remain independently covered. | 13 |
| `tests/issue-237-cursor-runtime-contract.test.js` | Rewrite | Keep the sandboxed positive probe and add an always-running authenticated missing-sandbox case that blocks without invoking the client. | 2 |
| `tests/issue-237-runtime-proof.test.js` | Rewrite | Release proof rejects changed target commit, preflight attempt identity, duplicate surfaces, and omitted required surfaces. | 7 |
| `tests/issue-534-p1-dispatch-contract.test.js` | Rewrite | Complete Codex and AGY argv assertions bind authority, workdir, model/effort, timeout, and prompt placement. | 7 |
| `tests/issue-534-p1-failure-matrix.test.js` | Keep | Cold start, provider/effort denial, retry/fallback, side-effect reconciliation, adapter rejection, and scope collision remain covered. | 5 |
| `tests/json-out.test.js` | Rewrite | The manual JSON escape fallback runs with a process-wide restricted PATH and round-trips quote, backslash, and newline through JSON parsing. | 7 |
| `tests/learning-db.test.js` | Rewrite | Rotation preserves exact archived bytes, and an under-cap log remains byte-for-byte unchanged. | 12 |
| `tests/legacy-cli-role-agent-contract.test.js` | Keep | Legacy role capability, identity, provider separation, independent verification, and timeout guidance remain covered. | 5 |

The same ten-suite aggregate was used for before/after c8 `10.1.3` coverage on
Node `v24.21.0`, with fresh output directories. Covered line counts did not
decrease. Covered branch counts also did not decrease in these reports, but
the measured branch denominator expanded for `cursor-plugin-package.js`
(1 to 148) and `issue-237-runtime-proof.js` (101 to 103), so those rows are
not strict like-for-like branch coverage comparisons:

| Production file | Lines before → after | Branches before → after |
| --- | ---: | ---: |
| `scripts/lib/cursor-plugin-package.js` | 277/2440 → 671/2440 | 1/1 → 37/148 |
| `scripts/release/issue-237-runtime-proof.js` | 405/489 → 407/489 | 43/101 → 49/103 |
| `scripts/lib/consumer-runtime-preflight.js` | 472/574 → 474/574 | 76/143 → 77/143 |
| `scripts/lib/provider-cli-adapters.js` | 74/87 → 74/87 | 16/37 → 16/37 |
| `scripts/lib/dispatch-contract.js` | 696/809 → 696/809 | 149/265 → 149/265 |

Seven disposable mutation controls all made their matching suite fail:
allowing an unrestricted Cursor fallback, accepting a changed runtime-proof
target commit, changing the Codex model, removing its sandbox/approval flags,
changing the AGY mode, disabling the manual JSON fallback, or archiving an
empty learning log. No primary helper or fixture is assigned to this batch;
no helper, fixture, or production file changed. GitNexus upstream impact was
`UNKNOWN` for all ten test paths; text confirms recursive suite discovery and
the CI/release aggregate routes. None of these ten suites is in the macOS
installer subset. `UNKNOWN` remains unresolved and is not evidence that a path
is unused.

**Progress after #657:** 162 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #658 — Cohort A batch 17

This batch rewrites seven suites and keeps two. The focused Node
`v24.21.0` baseline passed 9/9 suites and 82/82 live cases. The final
aggregate passed 9/9 suites and 83/83 cases; the additional case exercises
the shared macOS installer runner's ordered calls, environment overrides, and
first-failure stop behavior. Frozen inventory metrics remain unchanged.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/load-project-config.test.js` | Rewrite | With no project settings, a known global option survives and no project-scope marker is introduced. | 9 |
| `tests/macos-installer-files.test.js` | Rewrite | Exact Darwin subset and CI wiring remain covered; the runner's order, executable, cwd, per-entry environment, inherited values, and failure short-circuit are exercised. | 3 |
| `tests/markdownlint-workflow.test.js` | Keep | Blocking Markdown lint, asset globs, pinned action, and table validation remain covered. | 3 |
| `tests/module-catalog.test.js` | Keep | Nonempty catalog, shipped-module membership, and full-profile partition remain covered. | 4 |
| `tests/modules.test.js` | Rewrite | Explicit active modules take precedence when the fallback option is also set; normalization and empty cases remain covered. | 5 |
| `tests/multi-ai-sync-agy-platform.test.js` | Rewrite | Deterministic discovery/runtime probes require exact PASS, import-only results require SKIP_INCOMPATIBLE, and the real package path is read-only bound at the resolved consumer path. | 22 |
| `tests/multi-ai-sync-configured-platform-validation.test.js` | Rewrite | Missing configured Claude source fails through the CLI; discovery finds the exact role and explicit selection returns the requested platform set. | 17 |
| `tests/multi-ai-sync-cursor-capabilities.test.js` | Rewrite | A valid project-local projection stays PASS beside a malformed portable package; portable failure, native incompatibility, and unrun runtime stay distinct. | 19 |
| `tests/multi-ai-sync-cursor-discovery.test.js` | Rewrite | Discovery unions all three documented roots, sorts and deduplicates roles, and ignores navigation, receipt, and resource Markdown. | 1 |

The nine suites were run through the same aggregate before and after under
c8 `10.1.3`, Node `v24.21.0`, with fresh report directories. All 32 measured
`scripts/` paths were compared: covered line and branch counts did not
decrease in any path. The only changed row was:

| Production file | Lines before → after | Branches before → after |
| --- | ---: | ---: |
| `scripts/ci/validate-agent-plugin-package.js` | 55/60 → 55/60 | 9/12 → 10/13 |

The covered branch count rose by one, and the report's total branch
denominator also rose by one. Because the denominators differ, these raw
counts do not support a strict percentage comparison; the evidence is one
additional covered branch with no covered-count decrease across measured
paths.

The shared helper `tests/_lib/macos-installer-files.js` was audited and kept:
CI calls it directly, and its injected spawn seam supports deterministic
ordering, environment, and fail-fast assertions. No production source,
shared helper, or fixture changed. GitNexus file-path impact returned `UNKNOWN` for
all nine suites and the helper; the paths are not resolvable in the index, so
this remains unresolved rather than an all-clear. Text confirms recursive
discovery in `tests/run-all.js:43`, the CI aggregate at
`.github/workflows/ci.yml:120`, and the separate macOS helper route at
`.github/workflows/ci.yml:165`. Named impacts for `runMacosInstallerSubset`,
`validate_agy`, and `cursor_agent_roles` were LOW with one direct caller
and no indexed processes. `writeBwrapStub` impact was LOW with zero graph
callers; text confirms its 11 call sites are local to the AGY suite.
`validate_cursor` had no resolved graph caller,
but `validation.py:1483` reaches it through a validator dictionary; that
empty graph result is incomplete. The local loader helper `sh` impact was
partial on two attempts after a read-only traversal error; its context and
text references show only local suite calls, so that graph result also remains
unresolved. No HIGH or CRITICAL warning was returned.

**Progress after #658:** 171 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #659 — Cohort A batch 18

This batch keeps five suites and rewrites four; none is redundant, and no
helper or fixture is assigned. The Node `v24.21.0` baseline and final focused
aggregate each passed 9/9 suites and 70/70 cases. Inventory metrics remain
frozen.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/multi-ai-sync-parity.test.js` | Rewrite | The symlinked Codex entry runs the four self-tests once against a scratch root with exact named PASS rows; content drift disappears after synchronization with equal mtimes. | 2 |
| `tests/multi-ai-sync-skill-contract.test.js` | Keep | Canonical/Codex workflow tree, references, status vocabulary, and model literals remain covered. | 7 |
| `tests/multi-ai-sync-source-validation.test.js` | Rewrite | Source PASS exits 0; FAIL/BLOCKED exits 2, while invalid markers, FIFO, size boundary, symlink, and root-layout controls remain covered. | 9 |
| `tests/native-dispatch-policy.test.js` | Keep | Native-only defaults, explicit selection, retry state, quota pool, and v2 request policy remain covered. | 10 |
| `tests/native-fallback-contract.test.js` | Keep | All six fallback failure classes, role preservation, and policy documentation remain covered. | 5 |
| `tests/native-shared-skill-install.test.js` | Keep | Host bindings, shared ownership, reinstall/uninstall, modified-content refusal, and foreign-file preservation remain covered. | 10 |
| `tests/openspec-gitignore.test.js` | Keep | Actual `git check-ignore` behavior and tracked OpenSpec boundaries remain covered. | 3 |
| `tests/opsx-apply-goal-guardrails.test.js` | Rewrite | Required dispatch and Part markers must exist in order before section slicing; Review Gate and stop assertions are scoped to their owning sections. | 12 |
| `tests/opsx-goal-analyze.test.js` | Rewrite | A real analyzer invocation proves `--worker=agy` overrides configured `claude`; project/global cross-provider variables are cleared in the environment helper. | 12 |

The focused tests run through the same aggregate on the baseline commit and
after the rewrites under c8 `10.1.3` and Node `v24.21.0`. We compared all 211
measured production JavaScript paths (181 `scripts/` paths and 30 paths in the
goal skill package); none was missing or newly introduced. Covered line counts
did not decrease. The only changed coverage rows were:

| Production file | Lines before → after | Branches before → after |
| --- | ---: | ---: |
| `scripts/lib/cross-cli-parity.js` | 122/129 → 122/129 | 17/28 → 19/30 |
| `skills/dhpk-opsx-apply-goal/references/execution-bundle/scripts/lib/native-dispatch-policy.js` | 99/245 → 99/245 | 13/18 → 15/20 |
| `skills/dhpk-opsx-apply-goal/scripts/goal-context.js` | 186/229 → 186/229 | 50/60 → 49/59 |

The parity and native-dispatch package rows each added two covered branches
along with two denominator branches. The `goal-context.js` difference is
coverage-map drift from the new CLI integration assertion: c8 merged the
`taskDigest` return branch's separate V8 ranges at lines 62–63 into one mapped
range when the module ran both as an imported library and a child entrypoint.
The before report had two positive-count mapped entries (8 and 9 hits); the
after report has one positive-count merged entry (9 hits), so the summary's
covered count and denominator each fell by one. The source is unchanged;
existing short-input and overflow cases still exercise both return and
continuation paths. This is recorded as report-map drift rather than lost
behavior coverage.

The suite paths were not target-resolvable in GitNexus: upstream impact was
`UNKNOWN` for all nine, and this remains unresolved rather than an all-clear.
Text confirms recursive discovery in `tests/run-all.js:43`, the CI test job at
`.github/workflows/ci.yml:120`, and its aggregate command at line 134. Named
impacts for `_validate_claude_source`, `taskDigest`, and `compareHarnesses` were
LOW with one indexed caller each. Dispatch and shared-install symbols were
LOW with zero graph callers; text confirms their consumers at
`scripts/fast-worker-selector.js:137` and
`scripts/ci/install-native-shared-skills.js:56`. No HIGH or CRITICAL warning
was returned. No production source, shared helper, or fixture changed.

**Progress after #659:** 180 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #660 — Cohort A batch 19

This batch keeps six suites and rewrites three; none is deleted. The Node
`v24.21.0` baseline passed 9/9 suites and 52/52 cases. The final focused
aggregate passed 9/9 suites and 53/53 cases. Inventory metrics remain frozen.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/opsx-goal-budget.test.js` | Rewrite | Full composed goal includes configured runner, coverage, build, lint, smoke, worker, and E2E clauses; the hard cap measures the exact UTF-8 goal string with no extra newline and suppresses actionable output when over cap. | 5 |
| `tests/opsx-goal-footprint.test.js` | Keep | `goal-context.js` footprint eligibility, distinct-file count, verification-heading exclusion, and fail-open warning behavior remain independently asserted. | 8 |
| `tests/opsx-goal-policy-fallback.test.js` | Keep | Both dispatch orientations read only their root-bound kernel/route resources and preserve the unresolved-policy fallback contract; it also checks the no-dispatch goal budget. | 8 |
| `tests/opsx-orchestration-decision-policy.test.js` | Keep | Canonical policy, projection, bilingual lifecycle documentation, planner/reasoner handoff, and non-terminal review/consumer boundaries remain covered as document contracts. | 16 |
| `tests/package-gate-cli.test.js` | Keep | Real package-gate CLI PASS/FAIL JSON, failure reason, and shared-copy drift ordering remain covered. | 3 |
| `tests/parallel-consumer-probes.test.js` | Rewrite | The coordinator CLI starts one child per requested surface, aggregates their results and unique namespaces, gives each child a private home/receipt environment, preserves host paths, and removes the temporary roots. | 2 |
| `tests/parallel-dispatch-contract.test.js` | Keep | Worker cleanup prohibitions, shared wrapper, dispatch tiers, whole-tree validator constraints, and the shared-state reporting rule remain covered. Source-text checks are explicitly described as policy heuristics. | 6 |
| `tests/parallel-dispatch-scope.test.js` | Rewrite | A real temporary git repo confirms the assigned pathspec excludes a sibling edit while leaving its content intact; hand-written “reconciliation” state assertions were removed because no executable dispatcher owns them. | 1 |
| `tests/partial-writer-handoff.test.js` | Keep | The production completion ledger and handoff API preserve assigned/confirmed/unconfirmed/out-of-scope classification, required stop/scope/diff evidence, partial markers, and the zero-confirmed BLOCKED outcome. | 4 |

The primary helper `tests/_lib/opsx-goal-fixtures.js` was rewritten. Its former
composer used short hand-typed gate tokens instead of the configured Part 3
commands, ignored `codex`/`smoke` fixture flags, duplicated review/artifact
markers, and counted an extra newline. It now emits only the configured
test/coverage/build/lint/smoke gates, uses the fixture's worker/E2E choices, and
measures the exact composed string with `wc -c`. All seven assigned goal
fixtures were updated to represent distinct inputs. The shared
`tests/_lib/hookharness.js` was audited and kept unchanged; it remains useful to
12 suites and supplies real temporary git repositories.

All nine paths are recursively discovered by `tests/run-all.js` and run through
the CI aggregate in `.github/workflows/ci.yml`; none is in the separate macOS
installer subset. No production file changed, so per-production-area c8
comparison is not applicable. The test and helper paths were not resolvable as
GitNexus file targets (`UNKNOWN`); text confirms their discovery route. Named
impacts for `composeGoal`, `generateFixture`, and `measureBytes` were LOW. The
shared `rmRepo` helper had MEDIUM impact across six callers and was not edited.
`node scripts/ci/catalog.js --check` passed. The full precommit runner reported
semantic FAIL without executing steps because `package.json` has no recognized
npm lint/build/test script; the focused aggregate was run independently. No
HIGH or CRITICAL warning was returned.

**Progress after #660:** 189 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #661 — Cohort A batch 20

This batch keeps five suites, rewrites three, and deletes one fully repeated
suite. The baseline passed 9/9 suites and 71/71 cases. The final assigned
suite set contains eight suites and 69 cases. Frozen inventory metrics remain
unchanged.

| Test file | Disposition | Protected contract and assertion owner | Final cases |
| --- | --- | --- | ---: |
| `tests/physical-file.test.js` | Keep | Private physical reads, immutable writes, required flags, link identity, symlink rejection, and size limits exercise the filesystem helpers directly. | 9 |
| `tests/physical-tmpdir.test.js` | Keep | The test harness exposes a normalized temp root with no symlinked ancestor and supports `mkdtemp`. | 2 |
| `tests/physical-tree-publication.test.js` | Keep | Physical Skill traversal, fail-closed symlink handling, publication completeness, historical receipt compatibility, and the frozen descriptor snapshot remain independent contracts. | 13 |
| `tests/platform-boundary.test.js` | Rewrite | Real validators reject native Codex and Cursor packages as portable Agent Plugin packages; removed a third case that only compared two different path strings. | 2 |
| `tests/platform-conformance.test.js` | Rewrite | Four host projections retain table-driven manifest-format assertions. Removed source-text invocation regexes; executable consumer behavior belongs to `consumer-platform-probe` and `consumer-gate-cli`. | 1 |
| `tests/platform-installation-docs.test.js` | Keep | Bilingual installation status, route ownership, package metadata, verification roots, and generated-document links remain protected. | 16 |
| `tests/platform-provenance.test.js` | Keep | Receipt ownership, generated-input ancestry, target-tree identity, dirty-checkout rejection, and rollback-owner boundaries remain covered. | 12 |
| `tests/plugin-user-config-behavior.test.js` | Delete | It invoked the same project-config probe twice with identical options and compared the results. Runtime parsing is owned by `runtime-config` and `load-project-config`; manifest contract preservation is owned by `plugin-user-config-metadata`. | 0 |
| `tests/plugin-user-config-metadata.test.js` | Rewrite | The 59-entry legacy and 76-key active contracts, metadata validation, deterministic generation, and rollback stay covered. Rollback now includes a sibling projection sentinel and proves its bytes are untouched. | 14 |

The assigned helper `tests/_lib/host-projection-conformance.js` was rewritten
to contain only platform-specific manifest format contracts. Its removed
`invocationSource` regexes were source-text heuristics; executable consumer
tests already own those behaviors. Both assigned fixtures were kept:
`plugin-user-config-contract.json` preserves the 59-entry legacy option
contract, and `skill-package-descriptor-snapshot.json` preserves 22 historical
Skills and 113 required resources.

All retained suites are recursively discovered by `tests/run-all.js` and run
by CI at `.github/workflows/ci.yml:134` and release at
`.github/workflows/release.yml:50`. The deleted behavior suite had no direct
repository consumer beyond its own runner; text search confirmed the generic
runner discovers suites by suffix. None of the nine assigned suites belongs
to the macOS installer subset. The full verification also runs
`runtime-config`, `load-project-config`, `consumer-platform-probe`, and
`consumer-gate-cli` to protect the neighboring config and consumer contracts.

The batch changes tests, one test helper, the audit ledger, and its inventory;
production code is unchanged, so production c8 line/branch comparison does not
apply. GitNexus test-file impacts were `UNKNOWN`; text search confirms the
discovery and neighboring owners. On the exact base commit, named impacts were
HIGH for `physicalSkillTree` (14 affected, four direct), CRITICAL and partial
for `validateSurfaceReceipt` (17 direct), and HIGH for
`validateAgentPluginPackage` (15 affected, 11 direct). These warnings are
preserved by leaving production behavior untouched and keeping the physical,
provenance, and package-validator tests. `readPhysicalFile` and
`writePhysicalImmutable` returned LOW with no graph callers despite visible
text consumers, so those zero-caller results remain unresolved rather than an
all-clear. After editing, `detect_changes(scope=all)` reported low risk, 8
changed files, five changed symbols, and zero affected processes. Git reports
nine changed tracked files, so GitNexus's file summary is one lower than the
working-tree diff; test-file symbol resolution remains incomplete. No
production edits were made.

The focused aggregate passed 12/12 suites and 159/159 cases: the eight
retained assigned suites passed 69 cases, and four neighboring config/consumer
suites passed 90 cases. The marketplace-package generator check, catalog
check, changelog validation, and `git diff --check` passed. The full precommit
runner returned semantic FAIL with no steps executed because `package.json`
has no recognized lint, build, or test scripts. Code and documentation review
results are recorded with the PR evidence.

**Progress after #661:** 198 suites reviewed against the 79-suite minimum.
Remaining numbered Cohort A issues continue afterward.

### Issue #682 — Cohort A integration

All twenty batch ledgers (#642–#661) reconcile to the 196 unique formal
inventory rows: 119 keep, 76 rewrite, and one delete. The cohort's 23 helper
and fixture assets are now all dispositioned: 13 audited keep, nine audited
rewrite, and one additional audited keep. That last asset is
`tests/_lib/install-codex-skills-fixtures.js`, assigned to #656; the batch
ledger records its seven consumers and shared fixture role. No
application/runtime production module changed across Cohort A. Issue #644 did
change the CI coverage ownership map in `scripts/ci/catalog.js` by adding the
replacement bundle mapping; its paired line and branch coverage is recorded in
the #644 ledger above.

Deleted contracts retain explicit behavioral owners. The prevalidated #644
deletion, `tests/claude-capability-bundle.test.js`, is covered by
`tests/profile-scoped-claude-capability-bundle.test.js`, and the CI catalog
maps `scripts/lib/claude-capability-bundle.js` to that replacement. Paired
coverage remained 679/797 lines and 227/314 branches for the affected module.
The #661 deletion's config behavior is owned by `runtime-config` and
`load-project-config`; metadata remains owned by
`plugin-user-config-metadata`.

The batch sections above carry forward the paired production-coverage
comparisons. Across #655–#659 there was no covered-line-count loss; #656's
three measured paths were stable. Two branch reports in #657 changed their
denominators (`cursor-plugin-package.js` 1 to 148 and
`issue-237-runtime-proof.js` 101 to 103), so the branch counts are not strict
like-for-like percentage comparisons. #658 measured all 32 production paths;
its only changed row gained one covered branch while the denominator also
grew (9/12 to 10/13). In #659, all 211 measured paths retained covered-line
counts; `goal-context.js` reported 50/60 to 49/59 because c8 merged V8 ranges
when the module ran as both an imported library and a child entry point. That
is report-map drift, not lost behavior coverage. #660 and #661 changed no
production source, so a new production c8 comparison did not apply.

The canonical discovery route remains `tests/run-all.js`, which accepts an
explicit file list; CI runs it at `.github/workflows/ci.yml:120-134`, and
release runs the aggregate at `.github/workflows/release.yml:43-50`. Darwin
also has a separate 11-file installer subset at
`.github/workflows/ci.yml:151-165`, sourced from
`tests/_lib/macos-installer-files.js`. The prevalidated replacement is
included in the integrated aggregate so the deletion's contract remains
executable. The integrated aggregate passed all 196/196 test files. The
separate Darwin subset passed all 11/11 files and 239/239 cases. The catalog
check passed with no uncovered required scripts.

GitNexus could not resolve the shared helper path (`UNKNOWN`); text confirms
its seven importing suites, so the empty graph result remains unresolved. The
named `runInstaller` impact was LOW but partial with no indexed callers; text
search confirms the suite consumers. No source behavior changed in this
integration, and the B-cohort boundary remains reserved for issue #641 and
issues #662–#681.

**Progress after #682:** all 196 Cohort A inventory rows are reconciled,
including the replacement owner for the prevalidated deletion. Its integrated
aggregate and Darwin-specific verification passed.

### Issue #662 — Cohort B batch 01

This batch keeps five independent suites and rewrites five weak suites; no
complete duplicate justified deletion. The baseline run on the assigned HEAD
passed all ten paths at 40/40 cases. The rewritten batch passes all ten paths
at 44/44 cases.

| Test file | Disposition | Owned contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/policy-static-guardrails.test.js` | Keep | Exact execution-policy wording, ordering, and source ownership; the assertions protect policy text consumed by agents. | 5 |
| `tests/portable-sed.test.js` | Rewrite | Retains replacement and no-match behavior. Controlled Linux and Darwin probes require the exact GNU and BSD `sed -i` argument vectors and verify the replacement result. | 3 |
| `tests/portable-skill-mirrors.test.js` | Keep | Mirror reconciliation accepts the public `portable-skill` name independently from the stable skill ID. | 1 |
| `tests/portable-skill-names.test.js` | Keep | Public names, stable IDs, collision rejection, migration ledger, rollback pins, and unsafe-path rejection remain covered. | 8 |
| `tests/portable-stat.test.js` | Rewrite | Sets a fixed mtime and asserts epoch `1580702706`. Controlled GNU and BSD stat probes validate their exact flags and derive the epoch from that file; the missing-file case proves stat is not called. | 4 |
| `tests/portable-timeout.test.js` | Rewrite | Retains completion, timeout exit 124, exit propagation, and empty-command behavior. A constrained lookup probes the `gtimeout` arguments and the actual Perl fallback, including its alarm exit 124. | 5 |
| `tests/portable-workflow-runtime.test.js` | Keep | Explicit handoff isolation, legacy default paths, and standalone JavaScript status behavior remain covered. | 6 |
| `tests/post-edit-advisory.test.js` | Keep | CRLF normalization, clean-file no-op, root package reminders, nested-package exclusion, and Composer lockfile reminder remain covered. | 5 |
| `tests/post-obs.test.js` | Rewrite | A local fake curl returns healthy status and observation ID, captures the exact `-d @file` payload bytes, and proves a repeated observation is deduplicated. Unavailable service, missing input, and `TMPDIR` contracts remain covered; no network is used. | 4 |
| `tests/postcompact-restore.test.js` | Rewrite | Reads `handoff-latest.md`, parses the hook JSON, checks `hookEventName === "PostCompact"` and included handoff content, and preserves no-handoff silence plus minimal-profile suppression. | 3 |

All ten paths remain recursively discovered by `tests/run-all.js`. On Node
`v24.21.0` / Darwin, the explicit ten-suite aggregate passed 44/44 cases.
The required neighboring-owner run also passed: `set-handoff-state` 6/6,
`skill-retirement-migration` 16/16, `gen-cursor-sync` 14/14, `detect-phase`
8/8, and `skill-resume-family-isolation` 12/12. Combined with the assigned
batch, the 15-path run passed 100/100 cases.

The GNU sed/stat branches are exercised with controlled command shims; BSD
sed/stat run on the host and their alternate argument contracts are separately
checked with the same constrained probes. The gtimeout and Perl fallback
probes restrict command lookup. The post-observation tests put a local curl
stub first in `PATH` and make no network requests. Each of the five rewritten
suites rejected an isolated wrong-behavior mutation in a temporary copy of
its source script; no production file in the worktree was mutated.

The production line/branch paired comparison is **NOT_APPLICABLE**: no
production path changed. The five source scripts and shared helpers remain
unchanged. Pre-edit GitNexus impact for the suite paths was `UNKNOWN`; text
search confirmed inventory-only references, and `tests/run-all.js` discovers
suites recursively. The recorded `validateRenamedSkillNames` CRITICAL and
`resolveSkillIdentity` HIGH warnings are preserved by keeping those
production functions unchanged. No support assets were assigned to this
batch.

Final gates passed: `node scripts/ci/catalog.js --check` reported zero
uncovered scripts; `node scripts/ci/gen-claude-marketplace-package.js --check`
passed; `node scripts/ci/validate-changelog-fragments.js` passed with 0
fragments and 24 markers; Markdownlint reported 0 errors for the canonical and
generated review documents; and `git diff --check` passed.

### Issue #663 — Cohort B batch 02

This batch keeps five independent suites and rewrites five weak suites; no
suite is deleted. The ten assigned paths pass at 105/105 cases. Inventory rows
208–217 retain every frozen rank, count, and assignment metric; only their
disposition status changed.

| Test file | Disposition | Owned contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/pre-agent-warmstart.test.js` | Rewrite | Invokes the hook as a subprocess and parses its JSON. Covers the opt-out response plus reviewer, worker, explorer, and monitor context filtering and character budgets. | 6 |
| `tests/pre-bash-dispatch.test.js` | Keep | Preserves core-guard and protected-branch composition; removes the retired pending-review fixture and proves active module hooks pass in order, then block later hooks. | 6 |
| `tests/pre-bash-guard.test.js` | Rewrite | Retains root deletion and `.env` target-scoped security cases; observes remote-download pipes, chmod 777/666, commit/push `--no-verify`, exact template writes, suffixed template-name blocking, and mixed `tee` targets with quoted paths. | 38 |
| `tests/pre-edit-batch-gate.test.js` | Keep | Independent edit batch gate thresholds, session bookkeeping, override, fast-worker marker, and fail-open contracts remain unchanged. | 6 |
| `tests/pre-edit-guard.test.js` | Keep | Independent sensitive-path, template, lockfile, lint-config, and path-sanitization contracts remain unchanged. | 12 |
| `tests/pre-route.test.js` | Keep | Retains route ranking and the sole create-PR forwarding/ahead-count contract. | 8 |
| `tests/precommit-runner.test.js` | Rewrite | Scratch commands write ordered markers; parsed summary JSON verifies step status, changed paths, overall result, and redirected cache files. Existing non-repository, skipped-step, full/fast, and failure cases remain covered. | 5 |
| `tests/precompact-archive.test.js` | Rewrite | Reads the scratch handoff artifact and checks branch, active OpenSpec task counts, working-tree status, recent commit message, and commit ID; syntax check and real-repository isolation remain covered. | 2 |
| `tests/prepare-release-cli.test.js` | Rewrite | Snapshots every `prepare-release.js paths` target for read-only/rejected operations and compares complete release-tree state after normal, resumed, interrupted, and recovery-slot rollbacks. Branch, publication, docs, and security contracts remain covered. | 18 |
| `tests/pretool-branch-safety-dedup.test.js` | Keep | Adds a second session ID and proves a reminder is deduplicated within one session while remaining independent in another. | 4 |

`tests/run-all.js:43` recursively discovers these suites, and CI runs the
aggregate at `.github/workflows/ci.yml:134`. The exact ten-path run passed
105/105 cases. The neighboring owner checks passed: `hooks-wiring` 8/8,
`documentation-platform-parity` 11/11, `harness-govern-security` 7/7, and
`release-runner` 25/25. The hook registration file remains unchanged: warmstart,
the edit batch gate, and precompact are deliberately not registered there;
`pre-route` remains the create-PR forwarding owner. No support helper or
fixture asset was assigned to this batch or changed.

The `.env.template` regression was first observed RED: the guard suite passed
27/28, with only the template write blocked. Two later mixed-target `tee`
regressions also ran RED (32/34): each allowed a secret `.env` destination when
paired with a template path. Four suffix regressions then ran RED (34/38):
`.env.template.production` and `.env.template2` were wrongly allowed by both
redirection and `tee`. The Bash change aligns the allowlist with the exact
template names in `pre-edit-guard.sh`, preserves `tee` while removing exact
allowlisted template path tokens, and checks every remaining secret target
within each `tee` command. It leaves the `.env` redirection block intact. The
focused guard suite passed 38/38, including `.env` path-prefix blocking,
template-only redirection/`tee` allowlisting, suffixed-name blocking, and
mixed-target blocking in either order with quoted paths containing spaces. A
negative control restoring the former `tee` filter reproduced the mixed-target
bypass.

GitNexus upstream impact could not resolve
`scripts/hooks/pre-bash-guard.sh` (`risk: UNKNOWN`). Repository text search
confirmed `pre-bash-dispatch.sh` invokes it and `hooks-wiring` owns registration
coverage, so the unresolved graph result is not treated as evidence of no
callers. The issue-worktree `detect_changes --scope all` report covered 43
changed symbols across 13 files, with 0 affected processes and low overall
risk; that overall result does not resolve the hook file's UNKNOWN impact.

The initial macOS kcov 43 attempt failed with `task_for_pid failed with 5`,
even after its documented ad-hoc debugger entitlement. That remains the
historical kcov result; a later paired Bash-native measurement supersedes the
earlier coverage blocker. Node c8 does not instrument this Bash file and is not
used as a substitute.

The paired guard measurement used Bash 5.2.37 on Darwin and the same final
38-case `tests/pre-bash-guard.test.js` corpus and helpers on both source
revisions. The before source is `0310bca8^` (SHA-256
`ac262d6847de7be5533c2a772e835ea70e510e8e9f36db6df2ecad40e7bc6325`); the
after source is `0310bca80251fafc3b6e29737b9ae568fe02d3bc` (SHA-256
`7275d17004f473058b84a3fd85b8d2ff28131e1f441373f383417e3203e98bf8`).
The Bashcov 4.0.0 lexer supplied the executable-line denominator; a
`BASH_ENV`-installed Bash `DEBUG` trap recorded only executed lines whose
`BASH_SOURCE` was the guard. Disposable copies with status-preserving
predicate wrappers measured the nine primitive Boolean predicates (18
possible outcomes). Both revisions covered **30/33 executable lines and
15/18 branch outcomes**. The three uncovered outcomes are identical on both
sides: the empty-command predicate's true outcome, the nonzero
`DHPK_ALLOW_NO_VERIFY` predicate's false outcome, and the unmatched
git/no-verify gate's false outcome.

The baseline guard passed **35/38** cases; the three expected failures are the
new `.env.template` allowlist regressions. The revised guard passed **38/38**.
Traced and plain runs had identical output and exit status. The disposable
branch probe also passed true, false, and short-circuited-operand controls,
rejected a changed source hash, and matched pristine versus instrumented test
output and status. No production guard copy was instrumented or modified.

The generator synchronized the canonical inventory and this quality review
into the Claude marketplace package byte-for-byte and regenerated its packaged
Bash guard from the canonical hook. No other production or support source
changed, and the frozen queue metrics remain unchanged.

### Issue #664 — Cohort B batch 03

This batch keeps seven independent suites and rewrites three weak suites; no
suite is deleted. The ten assigned paths pass at 76/76 cases. Inventory rows
218–227 retain every frozen rank, count, and assignment metric; only their
disposition status changed.

| Test file | Disposition | Owned contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/profile-scoped-claude-capability-bundle.test.js` | Keep | Profile selection, safe rejection, deterministic planning, publication, and probe binding remain covered; the standalone fixture now removes its temporary source root in `finally`. | 23 |
| `tests/project-agent-projection-baseline.test.js` | Keep | Historical selection, the portable core boundary, Host evidence, redaction, and read-only behavior remain covered. The fixture's `evidenceFields` and `runtimeStatuses` values still have no assertion consumer and are not credited as coverage. | 4 |
| `tests/project-agent-projection-plan.test.js` | Keep | Dependency closure, Host evidence, malformed-input failures, identity changes, and inventory validation remain covered. | 15 |
| `tests/project-agent-projection-publisher.test.js` | Rewrite | Calls the public publisher lifecycle with a temporary project: verifies install receipt schema and managed paths, successful validation, authorized update and rollback to prior bytes, and uninstall that removes owned output while preserving foreign content. Missing-input rejection remains covered. | 2 |
| `tests/project-agent-provider-adapters.test.js` | Keep | Shared directory and AGY direct-file shapes, evidence-gated sibling references, and Claude, Cursor, and Codex discovery bindings remain covered. | 9 |
| `tests/project-agent-runtime-assets.test.js` | Keep | Source-independent execution, tamper and source drift detection, stale-descriptor and symlink refusal, and rename migration remain covered. | 4 |
| `tests/project-workflow-resources.test.js` | Keep | Legacy runner closure, rename migration, and preservation of edited receipt-owned content remain covered. | 3 |
| `tests/projection-artifact-store.test.js` | Rewrite | Publishes old bytes, injects an unplanned file into the next staged tree before `stage()`, verifies staging rejects it, aborts, and confirms the previously published bytes remain unchanged. | 5 |
| `tests/projection-usage-binding.test.js` | Keep | Usage fingerprints remain bound through compilation, materialization refusal, and parity diagnostics. | 4 |
| `tests/provider-adapter.test.js` | Rewrite | Uses separate registry probe and executor callbacks; confirms one probe, no executor call, mismatched-provider refusal, and rejection of an invalid capability status. Existing receipt, timeout, side-effect, attestation, and provider mapping cases remain covered. | 7 |

`tests/run-all.js:43` recursively discovers the ten suites, and CI invokes the
aggregate at `.github/workflows/ci.yml:134`. The exact ten-path run passed
76/76 cases. The four changed suites passed 37/37 focused cases; the adjacent
owner checks passed `agents-skills-package` 33/33,
`distribution-projection-contract` 20/20, `distribution-rollback-proof` 7/7,
`capability-bundle-activation` 2/2, and `provider-cli-adapters` 5/5, for
67/67 neighboring cases.

Negative controls used in-memory module overrides and did not modify
production files. A rollback implementation that leaves updated bytes failed
the publisher test (1/2); a stage operation that accepts an unplanned entry
failed the artifact-store test (4/5); and a probe that accepts an unrecognized
status failed the provider-adapter test (6/7). The checks failed on the new
assertions as intended.

Both assigned fixtures remain. The baseline fixture's `evidenceFields` and
`runtimeStatuses` keys have no assertion consumer and are explicitly not counted
as protected behavior. `tests/run-all.js` discovers every assigned suite;
none belongs to the macOS installer subset. No production path changed, so a
production line/branch comparison is **NOT_APPLICABLE**. GitNexus pre-edit
impact for the store and publisher APIs reported CRITICAL risk for
`ProjectionArtifactStore` and HIGH/partial impact for `stageArtifact`; the
provider registry reported LOW impact. Those production APIs were left
unchanged. GitNexus `detect_changes --scope all` reports 33 changed symbols
across 8 files, 0 affected processes, and low overall risk. No production
symbols or execution flows changed.

### Issue #665 — Cohort B batch 04

This batch keeps six independent suites and rewrites four weak suites; no
suite is deleted. The ten assigned paths pass at 83/83 cases. Inventory rows
228–237 retain every frozen rank, count, and assignment metric; only their
disposition status changed.

| Test file | Disposition | Owned contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/provider-cli-adapters.test.js` | Keep | Bounded Codex argv and effort, AGY confirmation transport, explicit Claude Code and Cursor adapters, native Host routing, and target-specific callback arguments remain covered. | 5 |
| `tests/publish-gate-cli.test.js` | Rewrite | Publication requires both SOURCE and PACKAGE PASS and reports `PUBLISHED_PENDING` with a pending CONSUMER. The repository invocation verifies target-branch context while HEAD and tags stay unchanged; failure cases assert blocked evidence. Temporary stage inputs are removed. | 4 |
| `tests/receipt-json-primitives.test.js` | Keep | Descriptor-safe traversal, plain data shape and dense-array policy, cycle handling, configurable bounds, detached frozen clones, safe paths, and caller error context remain covered. | 10 |
| `tests/receipt-primitives.test.js` | Keep | Canonical bytes and digests, redaction, immutable writes, physical-root swap refusal, sequenced replay, process-lock ownership, bounded lease journals, and the compatibility facade remain covered. | 15 |
| `tests/redaction.test.js` | Keep | Authorization and connection-string values, tail truncation ordering, JSON-shaped keys, and Cursor session token names remain covered. | 4 |
| `tests/reference-integrity.test.js` | Keep | Dangling command/rule/path references, legacy branding, execution-policy fallback rules, and intentional references remain covered. | 16 |
| `tests/reference-route-policy.test.js` | Rewrite | Canonical and legacy route resolution, handoff parsing, immutable route context, terminal shape, bounded `--go`, and resume forwarding remain covered. The required skill-local parser can no longer be silently skipped when absent. | 7 |
| `tests/release-artifact-manifest.test.js` | Rewrite | The manifest binds all four package surfaces. Independent resealed mutations prove stale target, untrusted producer, and altered mode fingerprints are refused; scratch-package checks distinguish byte and mode changes. | 3 |
| `tests/release-evidence.test.js` | Keep | Required SOURCE/PACKAGE/CONSUMER stages, unavailable and failed gates, pending publication, completion, unhealthy post-publication state, and evidence validation remain covered. | 10 |
| `tests/release-parity.test.js` | Rewrite | Version parity and drift diagnostics cover package manifests, provenance, AGY pins, and changelog headings. The exported manifest list is asserted unchanged after comparison; every scratch repository is removed in `finally`. | 9 |

`tests/run-all.js` recursively discovers the assigned paths, and CI invokes the
aggregate at `.github/workflows/ci.yml:134`. `node scripts/ci/catalog.js
--check` passed with all required scripts covered. The frozen queue assigns no
primary helper or fixture to this batch. The four rewritten suites passed
23/23 focused cases; adjacent `git-flow-governance` and `release-runner` owner
checks are recorded with the batch verification. No production path changed,
so production line/branch comparison is **NOT_APPLICABLE**.

Pre-edit GitNexus impact was LOW for `runGate`,
`validateReleaseArtifactManifest`, and `checkParity`. The parser symbol also
reported LOW, while text search found additional consumers missing from the
graph. The initial file-level publish-gate result was UNKNOWN; a follow-up
symbol impact was LOW, and text search confirmed its release-runner and
governance consumers. No production API changed. GitNexus
`detect_changes --scope all` reports 41 changed symbols across 8 files,
0 affected processes, and low risk. Every changed symbol belongs to a test or
review document; no production symbol or execution flow changed.

### Issue #666 — Cohort B batch 05

This batch keeps all ten active suites and implements the separately
prevalidated deletion; no active suite is deleted. The ten assigned paths pass
at 84/84 cases. Inventory rows 238–246 and 248 retain every frozen rank, count,
and assignment metric; only their disposition status changed. The separate
deletion remains row 247 and consumes no active ordinal.

| Test file | Disposition | Owned contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/release-probe-batch.test.js` | Keep | Result ordering, bounded live workers, configured concurrency clamping, and invalid worker counts remain covered. | 2 |
| `tests/release-publication-bundle.test.js` | Keep | Exact release-note bytes, identity and tamper rejection, malformed types, writer rehash resistance, empty input refusal, and portable CLI publication remain covered. | 7 |
| `tests/release-runner.test.js` | Keep | Prepare/publish ordering, pre-tag gates, release-head identity, scoped staging, and real Git changelog-deletion handling remain covered. | 25 |
| `tests/release-verify-cli.test.js` | Keep | Dry-run and tag-mode parity, out-of-checkout verification, tag ancestry, blocked preflight, and non-blocking unavailable preflight remain covered. | 9 |
| `tests/release-workflow.test.js` | Keep | Workflow queueing, artifact-bound publication, consumer verification, immutable release recovery, and operator documentation remain covered. | 24 |
| `tests/render-test-timing.test.js` | Keep | Timing identity and runtime, slow or failed files, and missing or malformed evidence remain covered. | 2 |
| `tests/resolve-feature-cli.test.js` | Keep | Both feature argument forms, traversal rejection, and no-signal output remain covered. | 4 |
| `tests/resolve-feature.test.js` | Keep | Bash syntax, wrapper forwarding from an unrelated working directory, and JSON no-argument output remain covered. | 3 |
| `tests/resolve-invocation-class.test.js` | Keep | Route target classification, malformed or unknown target refusal, and symlink-escape prevention remain covered. | 7 |
| `tests/review-gate-authority-semantics.test.js` | Keep | A code-review PASS paired with a security-authority override does not synthesize semantic PASS; adjacent security tests do not own this exact composition. | 1 |

The separate prevalidated `tests/retirement-closure.test.js` deletion is
complete. Its export-only assertion is superseded by the acceptance and
rejection cases in `tests/validate-retirement-closure.test.js` (6/6). The
catalog had lacked the explicit owner map despite the earlier ledger claim;
after deleting the smoke suite, `catalog.js --check` failed on
`scripts/lib/retirement-closure.js`. Adding the map to
`tests/validate-retirement-closure.test.js` restored the check with zero
uncovered scripts. `catalog-claims` passed 39/39.

The recursive `tests/run-all.js` discovers every assigned suite; CI runs that
aggregate at `.github/workflows/ci.yml:134`. None belongs to the macOS subset.
No helper or fixture is primarily assigned to this batch, and none changed.
There is no runtime production behavior change. Paired `c8@10.1.3` reports on
Darwin / Node v26.10.0 used `catalog-claims` plus the retirement validator
before and after removing only the export smoke test. The validator module
retained 478/515 covered lines and 150/201 covered branches. `catalog.js`
increased from 297/371 to 298/372 covered lines and retained 23/46 covered
branches. The frozen queue baseline used Node v24.21.0; this local Node version
difference is unrelated measurement drift and both sides of the paired check
used the same runtime.

Pre-edit GitNexus impact resolved `COVERAGE_MAP` at LOW risk with no indexed
callers, processes, or modules. File-level impact was UNKNOWN; text search
confirmed the map feeds `resolveScriptCoverage`, the script-coverage gap scan,
`catalog.js --check`, and the CI validation job. GitNexus final
`detect_changes --scope all` reports 6 changed symbols, 6 changed files,
0 affected processes, and low risk. No runtime behavior or execution flow
changed; only the CI coverage-map constant changed.

### Issue #667 — Cohort B batch 06

This batch keeps four suites and rewrites six; no suite is deleted. The ten
assigned suites pass 123/123 focused cases after adding four cases. Inventory
rows 249–258 retain their frozen ranks, baseline case counts, and assignment
metrics; only disposition statuses changed. The frozen inventory counts total
119; the final cases column below totals 123 after one new continuity case and
three new companion-security cases.

| Test file | Disposition | Protected contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/review-gate-conformance.test.js` | Rewrite | The public report builder loads no workflow or receipt state and attempts no filesystem mutation; dynamic load and write probes replace the cwd and source-substring checks. | 13 |
| `tests/review-gate-cross-platform-differential.test.js` | Rewrite | Independent literals pin all 15 active case IDs, scenario kinds, adapter keys, and expected outcomes; every historical Sentinel outcome maps to a discovered direct, analogue, or historical-only owner. | 15 |
| `tests/review-gate-evidence-continuity.test.js` | Keep | Adds an event/receipt session-binding rejection between UNAVAILABLE and a trusted same-lane PASS; the rejected append leaves the pending head and receipts unchanged. | 9 |
| `tests/review-gate-receipt-bundle.test.js` | Keep | Portable bundle export/import, exact receipt bindings, and invalid or incomplete bundle rejection remain covered. | 11 |
| `tests/review-gate-receipt-store-security.test.js` | Rewrite | Ancestor swaps must fail at the public replay boundary with `MALFORMED_EVIDENCE`; descriptor identity proves no bytes were read from the outside file. | 16 |
| `tests/review-gate-receipt-store.test.js` | Rewrite | Redaction is asserted against raw content-addressed event bytes as well as the derived `inspect()` projection. | 23 |
| `tests/review-gate-runtime-attestation.test.js` | Rewrite | Every plan, obligation, source, identity, and evidence input is independently changed and must change its attested subject field or digest. | 7 |
| `tests/review-gate-runtime-cli.test.js` | Keep | Bounded Work Request preparation, status projection, private key creation, and repeat initialization statuses remain covered. | 6 |
| `tests/review-gate-runtime-companion-security.test.js` | Rewrite | Three public `observe` cases assert `MISSING_ARTIFACT`, misplaced-sidecar `FOREIGN_EVIDENCE`, and invalid structured verdict `MALFORMED_COMPANION`; mutated companions are re-signed and all cases leave status pending with zero receipts. | 21 |
| `tests/review-gate-runtime-consumer-e2e.test.js` | Keep | Materialized and installed consumers record durable, idempotent direct Review Gate observations. | 2 |

The active differential corpus carries all 17 original normalized Sentinel
outcomes without implying that retired lifecycle behavior is still live. Four
cases are explicitly historical-only (`resumed-malformed`, `retry-allowed`,
`retry-exhausted`, and `unresolved-resumed-block`); direct and analogue entries
name exact current test owners. Its four deterministic protections still name
the `.env`, `.git`, whole-home deletion, and session-start assertions.

| Primary support asset | Disposition | Ownership evidence |
| --- | --- | --- |
| `tests/_lib/review-gate-host-attestation-fixture.js` | Keep | Shared key enrollment, signing, and host-attestation setup used by 11 assigned consumers. |
| `tests/fixtures/review-gate/cross-platform-differential-v1.json` | Rewrite | Adds independent active-case expectations and the complete historical outcome/owner map. |
| `tests/fixtures/review-gate/reviewer-contract-v2.json` | Keep | Runtime CLI tests consume the fixture to verify the structured reviewer contract. |
| `tests/fixtures/review-gate/runtime-work-request-v1.json` | Keep | Runtime CLI and companion tests use it as the bounded prepare input. |
| `tests/fixtures/review-gate/sentinel-differential-v1.json` | Keep | Retains all 17 historical cases and four deterministic protections; the differential test verifies every named owner is discovered. |

All ten suites are discovered recursively by `tests/run-all.js` and run through
the CI aggregate; none belongs to the separate macOS installer subset. The
required script ownership check `node scripts/ci/catalog.js --check` passes
with zero uncovered scripts. No production source changed, so the comparison
for changed production files is **NOT_APPLICABLE**. For measurement evidence,
the same focused aggregate on Node `v26.10.0` / Darwin improved overall lines
from 8395/9775 (85.88%) to 8402/9775 (85.95%) and branches from 1688/2598
(64.97%) to 1700/2608 (65.18%). Three exercised modules gained coverage:
`review-gate-runtime-evidence.js` (+2 lines, +4 branches),
`review-gate-runtime-storage.js` (+4 lines, +4 branches), and
`reviewer-contract.js` (+1 line, +4 branches). The branch denominator rose by
10 as these focused scenarios exercised additional instrumented paths; no
production module lost covered lines or branches.

The full precommit runner reports **FAIL** because this repository has no
`lint:fix`, `build`, or `test:unit`/`test` package scripts, so it executed no
steps. The full repo-verify runner reports **PASS** with lint, typecheck, unit,
integration, and e2e stages skipped because their scripts/configuration are
absent. The focused aggregate above is the executed test evidence. Changelog
validation accepts the internal-change marker
`changelog.d/test-quality-batch-21.none`.

Pre-edit GitNexus file impacts for test suites and fixture paths were
`UNKNOWN`; text search corroborates recursive runner and CI ownership, and the
historical Sentinel fixture had no code consumer before this batch. `UNKNOWN`
is unresolved, not evidence of no callers. Final GitNexus
`detect_changes --scope all` reports 12 changed indexed files, zero affected
processes, and LOW risk; it reports no HIGH or CRITICAL risk.
The consolidated review checkpoint is complete: code review **APPROVE** after
confirming the owner-test assertion guard, security review **PASS** with no
production vulnerability or material coverage gap, and document review
**CONFIRMED** after reconciling 119 frozen cases plus four additions to 123 and
checking the generated copies.

### Issue #668 — Cohort B batch 07

This batch keeps three suites and rewrites seven; no suite is deleted. The ten
assigned suites pass 99/99 focused cases. The frozen inventory rows 259–268
total 94 baseline cases under the inventory's quoted-title counting rule.
The pre-edit aggregate registers three additional cases from the
`RETRY_INTEGRITY_VARIANTS` loop in
`tests/review-gate-runtime-observe-security.test.js`, so its executed baseline
is 97. This batch adds two directly declared cases (host key-ID mismatch and
invalid store-budget input), producing the verified final runtime total of 99.
The runner output, rather than a text count of `test(` spellings, is the case
total source. Inventory ranks, frozen case counts, and assignment metrics
remain unchanged; only dispositions were updated.

| Test file | Disposition | Protected contract and assertion evidence | Final cases |
| --- | --- | --- | ---: |
| `tests/review-gate-runtime-host-attestation-security.test.js` | Rewrite | The no-trust case now removes enrolled trust while signing with the enrolled fixture key; every rejected attestation asserts pending status, unchanged revision and chain digest, and zero receipts. | 7 |
| `tests/review-gate-runtime-host-trust-security.test.js` | Rewrite | A valid Ed25519 DER key paired with a different valid SHA-256 key ID is rejected before `.dhpk` state is created. | 7 |
| `tests/review-gate-runtime-init-security.test.js` | Rewrite | The no-lazy-init observe case uses current valid arguments; direct runtime evidence requires `SETUP_REQUIRED`, and the CLI leaves key, config, and state absent. | 17 |
| `tests/review-gate-runtime-observe-cli.test.js` | Keep | Successful observe envelope, bounded provenance, exact retry, status, and lifecycle verdict mismatch remain independently covered. | 2 |
| `tests/review-gate-runtime-observe-security.test.js` | Rewrite | Redaction markers are the actual foreign work and wave selectors or hostile evidence values checked against output and diagnostics. | 10 |
| `tests/review-gate-runtime-observe-states.test.js` | Keep | `CHANGES_REQUIRED` now asserts the exact persisted `MUST_FIX` finding (id, disposition, summary, and evidence); `BLOCKED`, idempotence, plan ordering, and tampered trust-policy rejection remain covered. | 5 |
| `tests/review-gate-runtime-review-findings.test.js` | Rewrite | `BLOCKED` and `UNAVAILABLE` command outcomes remain separate from the companion's semantic `PASS`; both produce exactly one review receipt. | 6 |
| `tests/review-gate-runtime-storage-security.test.js` | Rewrite | Deterministic race tests prove the symlink swap reaches the open boundary, is rejected with the bounded code, and leaves outside bytes unchanged; oversized config asserts `SETUP_REQUIRED`. | 22 |
| `tests/review-gate-security.test.js` | Keep | Authority override semantics, `MUST_FIX` continuity, and persisted command redaction retain their independent coverage. | 18 |
| `tests/review-gate-store-budget.test.js` | Rewrite | Invalid counters and increments across every budget field reject negative, fractional, unsafe-integer, `NaN`, and string values without mutation or payload disclosure. | 5 |

No shared helper or fixture is assigned to this batch; the previously audited
host-attestation helper and runtime work-request fixture remain unchanged. All
ten suites are discovered recursively by `tests/run-all.js`, run in the CI
aggregate, and are outside the separate macOS installer subset. The focused
aggregate passes **99/99** and `node scripts/ci/catalog.js --check` passes with
zero uncovered scripts. No production source changed, so production coverage
comparison is **NOT_APPLICABLE**.

Pre-edit GitNexus impact for named test helpers was LOW with no affected
execution processes or modules; unresolved file or symbol targets returned
UNKNOWN and were cross-checked against the recursive runner and CI workflow.
No production symbol changed. Final GitNexus `detect_changes --scope all`
reports 18 changed symbols across 12 changed files, zero affected processes,
and LOW risk; the result is complete and reports no HIGH or CRITICAL risk.
The full precommit runner reports **FAIL** because no configured lint, build,
or unit-test step exists; no precommit steps executed. The full repo-verify
runner reports **PASS**, with lint, typecheck, unit, integration, and e2e
stages skipped because their scripts or configuration are absent. Changelog
validation passes with the internal marker
`changelog.d/test-quality-batch-22.none`; generator consistency and
`git diff --check` also pass. Consolidated code, security, and document review
verdicts: code review **APPROVE**, security review **PASS**, and document review
**APPROVE** after clarifying the frozen quoted-title count against the three
table-driven runtime registrations. The final document review confirmed the
99-case total and byte-identical generated copies.

### Issue #669 — Cohort B batch 08

This batch keeps two suites and rewrites eight; all ten remain in the
discovered suite. The focused aggregate passed **93/93 cases** on Darwin:
the bounded-node suite registers its two portable cases and one explicit
incompatibility case there. The frozen inventory's 108 cases include the
Linux-only bounded-runner cases; the changed heap-forwarding assertion requires
verification by the Linux CI run. One helper regression case raises this batch's
Darwin runtime total from 92 to 93. The frozen case counts and ranks remain
unchanged.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/review-gate.test.js` | Rewrite | Rejected producer, lane, missing-evidence, and revision-conflict events now assert their exact blocking reason while retaining unchanged revision, digest, events, and receipts checks. | 10 |
| `tests/reviewer-companion-contract.test.js` | Rewrite | Reviewer pointers must link to the canonical contract; command outcomes and digest-only requirements are checked inside its structured-companion section. | 3 |
| `tests/reviewer-contract-v2.test.js` | Rewrite | Required conformance tokens must occur inside the active v2 contract, before the historical dispatch section. | 4 |
| `tests/reviewer-contract.test.js` | Keep | Owns the older shared-prompt, single-run artifact, retired Sentinel, orchestrator ownership, and reviewer-frequency guidance. | 4 |
| `tests/risk-router.test.js` | Rewrite | Each generated lane request is compared against the full decision, scope, identities, diff, risks, governing inputs, exclusions, and prior-findings binding. | 12 |
| `tests/run-agy.test.js` | Rewrite | Checks the exact ordered AGY argv and stdin; adds shell-injection and partial-helper-directory cleanup regressions for `restricted-path.js`. | 10 |
| `tests/run-all.test.js` | Keep | Owns option validation, deterministic sharding and worker assignment, timing evidence, output failures, and recursive discovery. | 13 |
| `tests/run-bounded-node-test.test.js` | Rewrite | The portable fallback child now asserts the configured `--max-old-space-size` value; the other timeout and fail-closed contracts remain. | 3 |
| `tests/run-cli-transport.test.js` | Rewrite | Replaces source-text matching with a controlled path substitution and verifies returned workdir/artifact descriptors still identify the original directories. | 25 |
| `tests/run-codex.test.js` | Rewrite | Checks the ordered Codex argv, exact workspace and sandbox values, private output destination, and model/effort binding. | 9 |

The assigned helper `tests/_lib/restricted-path.js` is kept and hardened:
tool names are validated and passed as an argument to `command -v`, resolved
targets must be executable regular files, and setup failures remove the
partially built directory. Its two consumers are the AGY and Codex wrapper
suites. All ten suites are recursively discovered by `tests/run-all.js` and
run in the CI aggregate. `run-bounded-node-test.test.js` is also in the
separate Darwin installer subset; its Linux-only branches remain CI-owned.
No production source changed, so production-file line and branch coverage is
**NOT_APPLICABLE**.

GitNexus resolved named helper impacts as LOW, with the two wrapper suites as
callers and no affected execution processes. Test-file targets returned
`UNKNOWN`; text search confirmed the recursive aggregate runner and both CI
aggregate/release routes. This unknown graph result is not treated as an
all-clear. Final `detect_changes --scope all` completed without partial or
truncated results: 31 changed symbols across 13 files, zero affected processes,
LOW risk.

The full precommit runner reports **FAIL** because the project has no
`lint:fix`, `build`, or test script; it executes no precommit steps. The
full repo-verify runner reports **PASS**, with lint, typecheck, unit,
integration, and e2e stages skipped because their scripts or configuration are
absent. The catalog check reports zero uncovered scripts. Changelog validation
passes with `changelog.d/test-quality-batch-23.none`, and generated marketplace
copies pass the generator check.

### Issue #670 — Cohort B batch 09

This batch keeps five suites and rewrites five; all ten remain discovered.
The focused aggregate passed **114/114 cases** on Darwin, compared with the
frozen baseline of 112. Two runtime cases were added to prove SessionEnd's
default and opt-in behavior and the current-session identity fallbacks. No
suite was deleted, and frozen ranks and case counts remain unchanged.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/run-portable-bounded-command.test.js` | Keep | Owns heap forwarding, exit 124 at the wall-time bound, descendant SIGKILL escalation, and malformed runner configuration. | 4 |
| `tests/run-skill.test.js` | Rewrite | An existing bare `.txt` helper now reaches the unsupported-type branch; the suite asserts the exact error and proves the helper emitted no output. | 11 |
| `tests/runtime-config.test.js` | Rewrite | Project settings are present while a controlled `PATH` omits Python; runtime accessors must return their documented defaults. Existing timeout precedence checks remain. | 13 |
| `tests/session-audit-integrity-fixtures.test.js` | Rewrite | Source discovery must return the exact selected Orca session, report each unavailable active-account root with redacted identity, and remain incomplete. Stale RED labels were removed. | 11 |
| `tests/session-end.test.js` | Rewrite | Controlled `pgrep`, `ps`, and `kill` seams prove default-off skips discovery and opt-in kills an orphan candidate while preserving a live-parent candidate. | 3 |
| `tests/session-env.test.js` | Rewrite | Sourcing twice preserves the exported environment, working directory, and scratch tree; session identity prefers the canonical value, falls back to the legacy value, and stays empty when absent. | 9 |
| `tests/session-install-health-ask.test.js` | Keep | Owns one-question composition, patch advisories, state-keyed suppression, configuration non-mutation, confirmation-before-write guidance, and SessionStart separation. | 21 |
| `tests/session-install-health-modules.test.js` | Keep | Owns mixed stack evidence, no-manifest inference, inherited module handling, and `laravel-mix` family routing. | 13 |
| `tests/session-install-health-version.test.js` | Keep | Owns version thresholds, malformed or missing state, project/user installation selection, age-qualified messaging, exact update commands, and pin precedence. | 23 |
| `tests/session-start-advisories.test.js` | Keep | Owns PHP module mismatch guidance and `dhpk_advise_once` per-session behavior. | 6 |

The five assigned fixtures are kept and remain referenced by
`tests/session-audit-integrity-fixtures.test.js`:

| Fixture | Disposition | Protected evidence |
| --- | --- | --- |
| `tests/fixtures/session-audit/agent-inventory.json` | Keep | Separates installation rows, package-owned role counts, and navigation entries. |
| `tests/fixtures/session-audit/baseline-v0.37.0.json` | Keep | Pins historical roots, report schema, and package-owned role sets. |
| `tests/fixtures/session-audit/generic-verification.json` | Keep | Shows that generic help and date scans cannot verify an arbitrary finding. |
| `tests/fixtures/session-audit/source-coverage.json` | Keep | Covers selected, unselected, and missing Orca accounts plus malformed and unsupported records. |
| `tests/fixtures/session-audit/typed-runtime-records.json` | Keep | Distinguishes typed runtime failures from historical prose and prompt context. |

The implement-step decision was **REASONER_REQUIRED** because the audit crossed
runtime, process-lifecycle, source-selection, and public shell-contract
boundaries; the read-only reasoner returned **READY_FOR_DISPATCH**. The scoped
work followed the in-process fast-worker route. All ten suites are discovered
by `tests/run-all.js` and run by CI and release; none is in the Darwin installer
subset. The catalog check confirms required script ownership. No production
source changed, so production-file line and branch coverage comparison is
**NOT_APPLICABLE**.

GitNexus resolved `discoverSources` at LOW risk with one direct caller,
`runAudit`, and no affected process; the changed test helpers also resolved
LOW with no affected process. Pre-edit Bash-file targets returned `UNKNOWN`;
text search confirmed each test's direct source path and the recursive test
runner. These unknown graph results are not treated as an all-clear. Final
`detect_changes --scope all` completed without partial or truncated results:
24 changed symbols across 9 indexed files, zero affected processes, LOW risk.

The catalog, generated marketplace package, changelog, and `git diff --check`
validations pass. Representative mutations for each rewritten contract were
caught by the corresponding suite; all temporarily mutated production files
were restored byte-for-byte. The full precommit runner reports **FAIL** because no
`lint:fix`, `build`, or test script exists, so it executes no steps. The full
repo-verify runner reports **PASS**, with lint, typecheck, unit, integration,
and e2e stages skipped because their scripts or configuration are absent.

### Issue #671 — Cohort B batch 10

This batch keeps four suites and rewrites six. The baseline and final focused
Darwin aggregate passed **103/103 executed cases** across all ten suites. The
frozen inventory's lexical total remains 91; `skill-bridge-family-isolation`
registers twelve fixture cases dynamically, so its two lexical cases execute
as fourteen. All suites remain discovered, and no production file changed.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/session-start.test.js` | Rewrite | Parses the single prefixed dispatch report and binds the configured worker target, source, catalog/host/runtime `NOT_RUN` statuses, and allowed fallback. Silent default and module validation remain. | 4 |
| `tests/session-usage-audit.test.js` | Rewrite | Issue-gate checks assert exact auth-unavailable and unverified reasons. The coverage fixture asserts complete scan versus incomplete source coverage, malformed count, redacted active account, and exact installation/identity/navigation counts across two cached versions. | 38 |
| `tests/set-handoff-state.test.js` | Rewrite | Compares the entire handoff after a state transition with the original bytes changed only in `state:`; invalid-state and leaf/parent symlink protections remain. | 6 |
| `tests/simplify-command-contract.test.js` | Rewrite | Degraded nested-worker handling and heavy-cleanup escalation now match their complete instruction clauses; canonical command and generated Cursor/Claude parity remain. | 7 |
| `tests/skill-audit-family-isolation.test.js` | Keep | Executes relocated family runners and binds the exact fixture IDs to the audit entries; behavioral fixtures remain distinct from authoring validation. | 12 |
| `tests/skill-baseline.test.js` | Rewrite | Pins the checked-in source commit and tree to the documented historical values. Removes one duplicate scratch-root rejection while retaining the provenance-root and non-current-root failures. | 6 |
| `tests/skill-bridge-family-isolation.test.js` | Keep | Runs the twelve registered bridge fixtures in relocated Skill trees, verifies authority and evidence boundaries, and checks source immutability. | 14 |
| `tests/skill-capability-families.test.js` | Rewrite | Matches each of the five governance modes to its procedure within the mode table, and binds implicit-invocation metadata to the `default_prompt`; retirement and external package protections remain. | 5 |
| `tests/skill-codemap-contract.test.js` | Keep | Owns the five documented output files, project-local write boundary, overwrite approval, and no-project-side-effect contract. | 1 |
| `tests/skill-coverage-integrity.test.js` | Keep | Owns helper-graph reachability and rejection behavior plus physical publication and ambiguous-script boundaries. | 10 |

The five primarily assigned helper assets are audited and kept unchanged:

| Helper | Disposition | Owned contract |
| --- | --- | --- |
| `tests/_lib/fixture-assertions.js` | Keep | Shared exact expected/present/absent fixture checks across eight consumers. |
| `tests/_lib/skill-audit-family-fixtures.js` | Keep | Audit-family registration and fixtures consumed by the runner suite and coverage validator. |
| `tests/_lib/skill-bridge-family-fixtures.js` | Keep | Bridge fixture registration and authority, transport, containment, and redaction evidence. |
| `tests/_lib/skill-directory-fixtures.js` | Keep | Shared directory registration and fixture-only evidence metadata. |
| `tests/_lib/skill-directory-isolation.js` | Keep | Physical Skill copying, environment scrubbing, local entry execution, and cleanup; separate consumers cover its isolation contract. |

The implement-step decision was **REASONER_REQUIRED** because the six rewrites
cross public shell output, issue-creation gates, filesystem integrity,
documentation contracts, and baseline provenance. The read-only reasoner
returned **READY_FOR_DISPATCH** and recommended no production or helper edits.
All ten suites are discovered by the recursive `tests/run-all.js` route used
by CI and release. `session-usage-audit.test.js` also runs in the Darwin
installer subset and passed with `TMPDIR=/private/tmp`. Both
`node scripts/ci/catalog.js --check` and
`node scripts/ci/validate-skill-directory-coverage.js --check` pass. No
production source changed, so production-file line and branch coverage
comparison is **NOT_APPLICABLE**.

GitNexus upstream impact resolved `withIsolatedSkill` at **HIGH** risk (25
upstream dependents, including 16 direct callers, and zero affected processes);
the shared helper was kept unchanged. `registerAuditFamilyFixtures` and
`registerBridgeFamilyFixtures` each resolved LOW with two direct callers,
including their suite and the coverage validator. `assertExpected` resolved
LOW with no graph callers and was kept unchanged. GitNexus returned `UNKNOWN`
for the six test-file targets; text search confirmed their assignment and the
recursive test discovery route. These graph results are not treated as an
all-clear. Final `detect_changes --scope all` evidence is recorded after the
implementation checks: the complete run reported three indexed documentation
sections touched across ten changed files, zero affected processes, and LOW
risk, with no partial or truncated result.

### Issue #672 — Cohort B batch 11

All ten assigned suites remain. Six are rewritten and four are kept. The
focused Darwin aggregate passed **77/77 cases before the edits** and
**78/78 after them**. The frozen inventory's lexical count remains 37; the
final runner count includes dynamically registered dependency, entry, family,
and goal-runtime fixtures. No production file changed.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/skill-declared-entry-coverage.test.js` | Rewrite | Keeps the canonical script-basename inventory scan and adds controlled public-invocation versus helper/prose cases. A runnable command must map to an executable/API role; prose mentioning a helper or example filename does not make it public. | 2 |
| `tests/skill-dep-audit-contract.test.js` | Keep | Relocated dependency-audit instructions preserve the independent review boundary, blocked/error behavior, explicit fix permission, and empty-project read behavior. | 1 |
| `tests/skill-dependency-evidence.test.js` | Keep | Fourteen executed cases require the coverage validator and Skill-local linter to agree on JavaScript, Python, shell, real dependency forms, and false-positive lookalikes. | 14 |
| `tests/skill-directory-coverage.test.js` | Keep | Retains complete instruction-only acceptance, path containment, missing-resource rejection, fixture binding, helper reachability, and inert-script classification. Removes the duplicate API-shape assertion already owned by the validation helper. | 15 |
| `tests/skill-directory-isolation.test.js` | Rewrite | Retains relocated execution, environment scrubbing, hostile-lookalike refusal, cache omission, symlink/escape rejection, and unavailable-tool behavior. Removes the export-only case because those seams are exercised by the behavior cases. | 4 |
| `tests/skill-flow-entry-isolation.test.js` | Rewrite | Pins all eight fixture IDs and their Skill-local entry paths before execution; repeated registration preserves the original local fixture instances. All eight relocated public-entry fixtures still execute. | 9 |
| `tests/skill-flow-family-isolation.test.js` | Rewrite | Pins the exact six `flow-guide` and four `flow-drive` fixture IDs and entry paths before execution; relocated family behavior and source immutability remain covered. | 12 |
| `tests/skill-goal-runtime-isolation.test.js` | Rewrite | Compares the 19 physical Review Gate files with the dependency closure independently declared by the `opsx-apply-goal` coverage manifest. Removes a literal self-comparison; each relocated fixture still asserts fixture-only, `NOT_RUN` host evidence. | 11 |
| `tests/skill-health-check-lint.test.js` | Keep | Owns capability skips for absent agents, non-invocable command filtering, and the independent command/Skill pairing boundary. | 3 |
| `tests/skill-health-check-resilience.test.js` | Rewrite | Requires each planted malformed Skill, agent, and command to produce its exact path/check, P1 severity, and nonempty safe fix hint; deterministic output and host-path redaction remain. | 7 |

The three primarily assigned helpers are audited: `tests/_lib/skill-flow-entry-fixtures.js`
is **rewritten** to make its own repeated registration idempotent while allowing
the shared registry to reject foreign ID collisions. The flow-family and
goal-runtime fixture helpers are **kept**; their ten and eight behavioral
fixtures remain consumed by the isolated suites and coverage validator.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH**; its bounded scope keeps every suite, rewrites
weak assertions in six suites, removes redundant checks, and makes no
production change.
`planner=skipped` because this is not an OpenSpec apply. All ten suites are
discovered by the recursive `tests/run-all.js` route used by CI and release.
`node scripts/ci/catalog.js --check` and
`node scripts/ci/validate-skill-directory-coverage.js --check` pass. Production
line/branch coverage comparison is **NOT_APPLICABLE** because no production
file changed. The full precommit runner reports **FAIL** without executing
steps because the root package defines no `lint:fix`, `build`, or supported
test script. Repo-verify reports **PASS** with lint, typecheck, unit,
integration, and e2e stages skipped because their scripts/configuration are
absent.

Pre-edit GitNexus upstream impact resolved `registerFlowEntryFixtures`,
`registerFlowFamilyFixtures`, and `registerGoalRuntimeFixtures` as **LOW**,
each with one direct graph caller in the coverage validator and zero affected
processes. `withIsolatedSkill` resolved **LOW** with one direct and one
transitive graph caller and zero affected processes when GitNexus used its
default `includeTests=false` filter. Re-running the same indexed worktree with
`includeTests=true` resolved **HIGH** with 25 upstream dependents, including
16 direct test callers, and zero affected processes. The earlier HIGH result
uses the test-inclusive scope; the LOW result excludes those test-suite
consumers. The shared helper was not changed. The edited
`validateSkillDirectoryCoverage` consumer resolved **LOW** with one direct
caller and zero affected processes. Text search confirmed the test-suite
imports and fixture registrations that the graph did not enumerate. These
filtered caller counts are not evidence that the suites are unused. Final
`detect_changes --scope all` evidence is recorded after implementation checks.

### Issue #673 — Cohort B batch 12

All ten assigned suites remain discoverable. Five are rewritten and five are
kept. The focused Darwin aggregate passed **51/51 cases before the edits** and
**50/50 after them**. The frozen inventory's lexical count remains 40; the
additional executed cases come from literal fixture loops. No production file
changed.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/skill-health-self-containment.test.js` | Rewrite | Keeps optional-directory, reachable-reference, internal-helper, orphan, containment, symlink-boundary, and independent command/Skill contracts. Removes duplicate-basename and symlinked-script cases already covered more strongly by `skill-coverage-integrity.test.js`. | 13 |
| `tests/skill-local-tool-isolation.test.js` | Rewrite | Keeps six relocated behavior fixtures. Version selection now binds `reference`, `loadedReferences`, and the loaded file to the exact requested version; JS status pins the structured strict/nocheck/unmarked buckets. | 6 |
| `tests/skill-migration.test.js` | Keep | Verifies version-module family selection and relative projections for canonical Skill and Codex paths. | 3 |
| `tests/skill-pilot-install-migration.test.js` | Keep | Exercises installer migration, receipt fingerprints, preservation of edited/unowned files, and rollback after materialization failure. | 3 |
| `tests/skill-pilot-isolation.test.js` | Rewrite | Retains the registry contract and all eight raw-directory behavior cases. Pilot assertions now require summary files inside the isolated project, exact step names/codes including the skipped typecheck step, and forwarded paths on their intended integration/e2e commands. | 9 |
| `tests/skill-policy-bundle-contract.test.js` | Keep | Pins canonical policy-root binding and the physical, declared resource closure for flow-guide and flow-drive bundles. | 3 |
| `tests/skill-public-name-routing.test.js` | Rewrite | Parses nonempty inline or folded frontmatter descriptions. Controlled cases prove a real alias is detected while ambiguous domain words and the documented subagent role are exempt. | 2 |
| `tests/skill-purpose-additions.test.js` | Rewrite | Validates the complete error list and requires one defect-specific diagnostic for missing, duplicate, baseline, unknown, unsafe, and absent-provenance cases; the historical 65-skill baseline remains pinned. | 2 |
| `tests/skill-purpose-decisions.test.js` | Keep | Retains full ledger validity, ownership boundaries, identity-drift rejection, and the separate retirement-wave contract. | 6 |
| `tests/skill-release-isolation.test.js` | Keep | Keeps blocked-release no-mutation behavior and exact preparation staging/PR evidence. | 3 |

The three primarily assigned helpers are audited: `tests/_lib/skill-local-tool-fixtures.js`
and `tests/_lib/skill-pilot-fixtures.js` are **rewritten** to strengthen
assertion ownership and scope. `tests/_lib/skill-release-fixtures.js` is
**kept**; its blocked and prepare fixtures already pin non-mutation and
release-scoped staging behavior.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH** and found no wholly redundant suite; only the
two repeated linter cases were removed. `planner=skipped` because this is not
an OpenSpec apply. All ten suites are found by the recursive
`tests/run-all.js` route used by CI and release, and none is in the explicit
macOS installer subset. `node scripts/ci/catalog.js --check` and
`node scripts/ci/validate-skill-directory-coverage.js --check` pass. Production
line/branch comparison is **NOT_APPLICABLE** because no production file
changed. The full precommit runner reports **FAIL** without executing steps
because the root package has no `lint:fix`, `build`, or supported test script;
repo-verify reports **PASS** with those unconfigured stages skipped.

Pre-edit GitNexus upstream impact resolved
`registerLocalToolFixtures`, `registerPilotFixtures`, and
`registerReleaseFixtures` as **LOW**, each with two direct callers (its suite
and the coverage validator) and zero affected processes. `summaryFor`,
`assertRunnerContract`, `escapeRegExp`, and the purpose-additions `errors`
helper each resolved **LOW**; their graph callers stayed within the assigned
test/helper files. The changed test-file targets resolved **UNKNOWN**. Text
search confirmed that `tests/run-all.js` recursively discovers them and CI
and release run that aggregate; the explicit macOS subset omits all ten.
UNKNOWN file targets are not treated as unused. Final
`detect_changes --scope all` reported **24 changed symbols across 9 files**,
**0 affected symbols**, **LOW** risk, and no affected processes; the result was
complete with no partial or truncated output.

### Issue #674 — Cohort B batch 13

All ten assigned suites remain discoverable. Seven are rewritten and three
are kept; one repeated selector test is removed. The focused Darwin aggregate
passed **122/122 cases before the edits** and **121/121 after them**. The
frozen inventory's lexical count remains 75. No production file changed.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/skill-remaining-entry-isolation.test.js` | Rewrite | Swift fixture fallback now requires the expected Swift shebang and a missing-interpreter diagnostic with exit 127; physical-entry and symlink checks remain. | 33 |
| `tests/skill-resource-sync-security.test.js` | Rewrite | Rejections must carry the synchronizer-specific error prefix and leave a complete snapshot of the disposable fixture tree unchanged, including symlink targets and file bytes. | 36 |
| `tests/skill-resource-sync.test.js` | Rewrite | Asserts typed `copy`, `orphan`, and `ledger` records by exact type and destination instead of matching JSON text. | 7 |
| `tests/skill-resume-family-isolation.test.js` | Keep | Retains the existing isolated resume-family behavior and shared fixture ownership. | 12 |
| `tests/skill-retirement-migration.test.js` | Rewrite | Binds each of seven literal retirement records to its corresponding frozen inventory record; independent migration and routing checks remain. | 16 |
| `tests/skill-routing-contract.test.js` | Keep | Retains the selector contract and its independent routing assertions. | 2 |
| `tests/skill-routing-frontend-regression.test.js` | Rewrite | Requires the complete profile list to equal the expected one-item list, rejecting unintended extra profiles. | 2 |
| `tests/skill-routing-progressive-loading.test.js` | Rewrite | Removes the duplicate selected-reference resolution case already owned by the routing-contract suite; discovery visibility and frontmatter-budget checks remain. | 2 |
| `tests/skill-routing-projection-parity.test.js` | Keep | Retains the independent projection-parity contract. | 7 |
| `tests/skill-runtime-path-contract.test.js` | Rewrite | Checks each resume and save helper path independently, preventing one match from satisfying multiple path expectations. | 4 |

The primarily assigned `tests/_lib/skill-remaining-entry-fixtures.js` helper
is **rewritten** to narrowly recognize the unavailable Swift interpreter;
`tests/_lib/skill-resume-family-fixtures.js` is **kept**. Both historical
baseline fixtures, `tests/fixtures/distribution-surface-baseline.json` and
`tests/fixtures/invocation-inventory-baseline.json`, are **kept** unchanged.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH** and found no production changes. `planner=skipped`
because this is not an OpenSpec apply. The recursive `tests/run-all.js`
discovery route is used by CI and release; none of these suites is in the
explicit macOS installer subset. The fixture registries are consumed by
`scripts/ci/validate-skill-directory-coverage.js`. Catalog, directory-coverage,
resource-sync, strict distribution, and strict retirement-closure validations
pass. Production line/branch coverage comparison is **NOT_APPLICABLE** because
no production file changed.

Pre-edit GitNexus upstream impacts for the changed shared helper symbols were
**LOW**, with at most two direct callers and zero affected processes. Test
suite/helper symbols also resolved **LOW** within their assigned test paths.
Changed test-file targets resolved **UNKNOWN**; text search confirmed the
recursive test runner, CI/release aggregate ownership, fixture registry
consumers, and omission from the macOS subset. UNKNOWN targets are not treated
as unused. Final GitNexus `detect_changes --scope all` reported **14 changed
symbols across 11 files**, **0 affected symbols**, **LOW** risk, and no affected
processes. The complete result contained no partial or truncated output.

### Issue #675 — Cohort B batch 14

All ten assigned suites remain discoverable. Nine are rewritten and one is
kept; one duplicate sorted-help-list assertion is removed while the suite and
its other contracts remain. The focused Darwin aggregate passed **69/69 cases
before the edits** and **77/77 after them**. The frozen inventory's lexical
count is 70 because the completion-evidence file contains a test-shaped string
literal. No production file changed.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/skill-setup-family-isolation.test.js` | Rewrite | Parses the settings template as JSON, pairs every ecosystem opening marker with its own generic closure, checks every adapter's missing-argument exit, and verifies dangling-symlink and mode-only snapshot changes. | 14 |
| `tests/skill-topology.test.js` | Rewrite | Calls the canonical v2 topology and inventory validators directly, without fallback aliases. | 9 |
| `tests/skill-usage-contract.test.js` | Rewrite | Requires the frozen `{ok, errors}` validator result shape and exact fault-specific diagnostics across malformed contracts. | 13 |
| `tests/skill-usage-projections.test.js` | Rewrite | Keeps projection and generator checks; removes only the sorted help list duplicate owned by `tests/flow-guide-usage-help.test.js`. | 5 |
| `tests/source-gate-cli.test.js` | Rewrite | Checks exact command, exit, environment, and failure evidence; removes temporary step files and scratch repositories in `finally` cleanup. | 6 |
| `tests/stack-evidence.test.js` | Rewrite | Uses `DHPK_STACK_CENSUS_FILES=1` to verify the file cap deterministically instead of asserting a wall-clock limit. | 12 |
| `tests/standalone-package-assets.test.js` | Rewrite | Checks complete dependency and supporting-asset records, unsafe sources and destinations, duplicate destinations, unknown asset IDs, and symlinked files plus directory ancestors. | 7 |
| `tests/statusline.test.js` | Rewrite | Verifies one staged file renders a staged count of 1 and a modified count of 0. | 3 |
| `tests/stop-advisory-dispatch-completion-evidence.test.js` | Keep | Retains the independent completion-evidence behavior and warning boundary. | 4 |
| `tests/stop-advisory-dispatch-graduation.test.js` | Rewrite | Verifies generated candidate report content and exact seeded count increment; missing backing files remain uncounted and no draft is created. | 4 |

The assigned `tests/_lib/skill-setup-family-fixtures.js` helper is **rewritten**
to snapshot dangling symlinks, entry types, and mode bits while preserving its
fixture registry metadata and assertion. No other helper or fixture row is
assigned in this batch.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH** and found no production changes. `planner=skipped`
because this is not an OpenSpec apply. The recursive `tests/run-all.js`
discovery route is used by CI and release; none of these suites is in the
explicit macOS installer subset. The fixture registry is consumed by
`scripts/ci/validate-skill-directory-coverage.js`. Catalog, directory-coverage,
resource-sync, strict distribution, and strict retirement-closure validations
are run for this batch. Production line/branch coverage comparison is
**NOT_APPLICABLE** because no production file changed.

Pre-edit GitNexus upstream impact for the changed shared helper's
`registerSetupFixtures` was **LOW**, with two direct callers and zero affected
processes. Test-local helper symbols resolved **LOW** within their assigned
test paths. `fileSnapshot` and `fingerprint` had no graph callers, so text
search confirmed their exports, imports, and uses in the isolation suite.
The unchanged production `collectStandalonePackageAssets` impact was
**CRITICAL**, with five direct callers, one process, and eight modules; its
result was partial. That production symbol was not edited. UNKNOWN and empty
caller results were not treated as an all-clear. Final GitNexus
`detect_changes --scope all` reported **43 changed symbols across 14 files**,
**0 affected symbols**, **LOW** risk, and no affected processes. The result was
complete with no partial or truncated output.

### Issue #676 — Cohort B batch 15

All ten assigned suites remain discoverable. Four are rewritten and six are
kept; one explicitly assigned, unreferenced historical fixture is deleted.
The focused Darwin aggregate passed **57/57 cases before the edits** and
**58/58 after them**. No production file changed.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/stop-advisory-dispatch-modules.test.js` | Rewrite | Parses the surfaced event as JSON and asserts the exact `systemMessage` shape, prefix, and findings content. | 3 |
| `tests/stop-dispatch-audit.test.js` | Rewrite | Repeats two source paths across four ledger lines and verifies the below-threshold result is silent and non-blocking. | 4 |
| `tests/subagent-context-budget.test.js` | Keep | Retains independent static/observed usage, cold-context, scenario, and fail-closed packet checks. | 5 |
| `tests/subagent-stop-quality.test.js` | Rewrite | Adds an evidence-rich reviewer report that must pass silently, alongside the existing block and retry contracts. | 13 |
| `tests/subagent-stop-verify.test.js` | Rewrite | Starts with two liveness entries for the same worker type and asserts Stop removes exactly one while retaining the other and an unrelated worker. | 3 |
| `tests/symlink-write-guidance.test.js` | Keep | Retains the distinct symlink-safe destination guidance contract. | 1 |
| `tests/sync-develop.test.js` | Keep | Retains real Git remote alignment, force-with-lease, stale-head refusal, divergent-tree, and unchanged-ref checks. | 7 |
| `tests/task4-consolidation.test.js` | Keep | Retains its independent skill and read-only permission text contracts. | 7 |
| `tests/task4-defects.test.js` | Keep | Retains observable CLI and workflow regressions, including the named hostile-argument security invariant. | 11 |
| `tests/tdd-e2e-contracts.test.js` | Keep | Retains independent TDD and E2E routing and handback policy contracts. | 4 |

The assigned fixture `tests/fixtures/subagent-stop/lin-blog-2026-07-17.json` is
**deleted**. It records a retired Sentinel incident; exact-path, distinctive
field, and fixture-directory searches found no test, loader, or runtime
consumer. No helper is assigned to this batch.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH** and found no production change. `planner=skipped`
because this is not an OpenSpec apply. The recursive `tests/run-all.js`
discovery route is used by CI and release; none of these suites is in the
explicit macOS installer subset. The JSON fixture is not a discovered test.
Catalog, skill-directory coverage, resource-sync, strict distribution, strict
retirement-closure, changelog, and generated marketplace checks are run for
this batch. Production line/branch coverage comparison is **NOT_APPLICABLE**
because no production file changed.

Pre-edit GitNexus upstream impacts for the four rewritten suite files were
**LOW**, each with zero indexed callers and zero affected processes. The
fixture path resolved **UNKNOWN** because it is not indexed. A repository-wide
search found only its inventory and review-ledger references, with no test,
script, or fixture-loader consumer; the UNKNOWN result was not treated as an
all-clear. No proposed edit had HIGH or CRITICAL risk. Final GitNexus
`detect_changes --scope all` reported **7 changed symbols across 8 files**,
**0 affected symbols**, **LOW** risk, and no affected processes. The result was
complete with no partial or truncated output.

### Issue #677 — Cohort B batch 16

The nine assigned suites are **3 keep / 6 rewrite**. The explicitly assigned
trap-sheet fixture is **deleted** after its only runtime consumer was rewritten
to assert the public loader contract directly. The frozen inventory retains
both the suite ownership and the fixture's `reviewed: delete` disposition.
The focused Darwin aggregate passed **68/68 cases before the edits** and
**66/66 after them**.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/test-entrypoint-dedup.test.js` | Keep | Retains the fast-worker aggregate entry/catalog mapping and SessionStart advisory ownership contracts. | 2 |
| `tests/timestamps.test.js` | Keep | Retains timestamp format, canonical UTC ISO output, and integer epoch proximity checks. | 3 |
| `tests/transcript.test.js` | Rewrite | Checks JSON path extraction, legacy and environment fallbacks, key precedence, and empty output on malformed JSON. | 5 |
| `tests/trap-sheet-detection.test.js` | Rewrite | Checks active-module override; root-only manifest/file signals for JS, Vue, PHP, Swift, and Python; no vendor recursion; and separation from SessionStart activation. | 8 |
| `tests/userpromptsubmit-skill-hint.test.js` | Rewrite | Parses emitted JSON and asserts the UserPromptSubmit event and additionalContext, alongside negative filters, real-route wording, and fail-closed metadata behavior. | 15 |
| `tests/utils.test.js` | Rewrite | Checks canonical UTC timestamps, filesystem round trips, logging/error behavior, line and ANSI handling, package-manager command selection, and subprocess helpers. | 16 |
| `tests/validate-agent-plugin-package.test.js` | Rewrite | Requires semantically invalid parsed provenance to exit 1 with structural PASS, provenance FAIL, and a schema diagnostic; retains valid, alias, and malformed-receipt cases. | 4 |
| `tests/validate-agents-behavior.test.js` | Rewrite | Exercises fable and inherit model acceptance and distinct validator behavior for names, tools, discovery, INDEX.md, effort, maxTurns, and optional fields. Parser-only duplication is covered by `tests/frontmatter.test.js`. | 11 |
| `tests/validate-agents-skills.test.js` | Keep | Retains structural PASS/runtime-boundary reporting and validation of an external project receipt. | 2 |

The deleted fixture was `tests/fixtures/trap-sheet-detection/cases.json`.
Before editing, GitNexus upstream impacts for the nine suite files and
`scripts/ci/validate-agent-plugin-package.js` were **LOW**, with zero resolved
callers and processes. The fixture path was **UNKNOWN** because JSON fixtures
are not indexed; a repository search found its only runtime consumer in
`tests/trap-sheet-detection.test.js` and no additional test, script, or loader
consumer. That UNKNOWN result was resolved with the text search, not treated as
an all-clear. No pre-edit impact was HIGH or CRITICAL.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH**; `planner=skipped` because this is not an
OpenSpec apply. CI and release use recursive `tests/run-all.js` discovery, and
none of these nine suites is in the explicit macOS installer subset. Because
the validator CLI changed, production line/branch coverage comparison is
required. On Node `v26.10.0` / Darwin with c8 `10.1.3`, the exact nine-suite
aggregate covered **55/60 lines and 11/14 branches before** and **56/61 lines
and 11/14 branches after** in `scripts/ci/validate-agent-plugin-package.js`;
the rewrite added one covered line and lost no covered lines or branches.
GitNexus `detect-changes --scope all` reported **20 changed symbols across 12
files**, **0 affected processes**, and **LOW** risk, with no partial or
truncated result.

### Issue #678 — Cohort B batch 17

The nine assigned suites are **6 keep / 3 rewrite**. The focused Darwin
aggregate passed **78/78 cases before the edits** and **79/79 after them**.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/validate-changelog-fragments-cli.test.js` | Keep | Retains its changelog-fragment CLI and failure-reporting contracts. | 13 |
| `tests/validate-commands.test.js` | Keep | Retains command discovery and invocation-policy checks; removed the stale RED comment and a redundant assertion without changing the suite's disposition. | 12 |
| `tests/validate-cursor-plugin-package.test.js` | Rewrite | Adds a parsed-invalid receipt regression requiring exit 1, structural PASS, provenance FAIL, consumer NOT_RUN, and a provenance-schema diagnostic. | 4 |
| `tests/validate-cursor-sync.test.js` | Keep | Retains dedicated CLI exit and `PASS [cursor-sync]` output ownership required by the catalog; generator and CI also validate the checked-in package. | 1 |
| `tests/validate-distribution.test.js` | Keep | Retains strict distribution boundary and package validation contracts. | 7 |
| `tests/validate-harness.test.js` | Rewrite | Removes the source-regex assertion; keeps executable shell checks, including the route and symlink cases. | 12 |
| `tests/validate-invocation-policy.test.js` | Keep | Retains independent checks for invocation policy behavior and its protected artifacts. | 17 |
| `tests/validate-json-cli-termination.test.js` | Rewrite | Builds entrypoint fixtures from the exported registry and verifies a missing registered entrypoint fails with its identity. | 3 |
| `tests/validate-modules.test.js` | Keep | Retains module validation behavior and boundary checks. | 10 |

The read-only reasoner recommended deleting `tests/validate-cursor-sync.test.js`
because the package tree is also checked by the generator test and direct CI
invocation. Final verification showed that `node scripts/ci/catalog.js --check`
requires a dedicated `tests/validate-cursor-sync*.test.js` owner for that CLI;
deleting the suite left one script uncovered. The suite therefore remains
**Keep** to preserve script ownership and its direct CLI output contract. No
primary helper or fixture is assigned to this batch.

The implement-step decision was **REASONER_REQUIRED**. The read-only reasoner
returned **READY_FOR_DISPATCH**; `planner=skipped` because this is not an
OpenSpec apply. CI and release use recursive `tests/run-all.js` discovery, and
none of the nine assigned suites is in the explicit macOS installer subset.
The Cursor validator CLI changed. Its saved same-runtime pre-edit coverage
report is `/tmp/dhpk-issue-678-cov-before/coverage-summary.json`; the CLI
started at **60/65 covered lines and 2/15 branches** and finished at **62/67
covered lines and 14/22 branches**. The aggregate added two covered lines and
twelve covered branches. Final GitNexus `detect_changes --scope all` reported
**6 changed symbols across 11 files**, **0 affected processes**, and **LOW**
risk; the response had no partial or truncated result marker.

Pre-edit GitNexus upstream impacts for all nine suite files and
`scripts/ci/validate-cursor-plugin-package.js` were **LOW**, with zero resolved
callers and affected processes. A repository text search confirmed the
validator's direct CI workflow invocation despite the empty graph caller set.
No pre-edit impact was HIGH or CRITICAL. The disposition values are updated in
the inventory without changing its frozen numeric fields or ranks.

### Issue #679 — Cohort B batch 18

The nine assigned suites are **7 keep / 2 rewrite / 0 delete**. The focused
aggregate passed **70/70 cases on the committed baseline** and **71/71 after
the edits**; the baseline was run from a detached worktree at `HEAD`.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/validate-openai-metadata.test.js` | Keep | Retains canonical OpenAI metadata, mirror parity, invocation-policy, and validator diagnostic coverage. | 17 |
| `tests/validate-plugin.test.js` | Keep | Retains plugin path/reverse-registration checks and goal-script dependency-boundary validation. | 19 |
| `tests/validate-references.test.js` | Keep | Retains real-tree CLI success plus dangling and whitelisted-reference behavior. | 5 |
| `tests/validate-retirement-closure.test.js` | Keep | Retains exact retirement-wave closure and mutation rejection for routes, packages, projections, and renamed entries. | 6 |
| `tests/validate-skill-directory-coverage.test.js` | Keep | Retains per-identity coverage reporting and unknown-argument exit behavior. | 2 |
| `tests/validate-skill-purpose-decisions.test.js` | Rewrite | Replaces duplicate library-only happy-path coverage with real CI CLI subprocess checks: clean ledger exits 0 with `PASS [skill-purpose-decisions]`; malformed isolated ledger exits 1 with an actionable `ERROR [skill-purpose-decisions]` naming the ledger. | 2 |
| `tests/validate-skills-size.test.js` | Keep | Retains size thresholds, shrink-only allowlist boundaries, module-owned skill discovery, and final-line counting. | 6 |
| `tests/validate-skills.test.js` | Keep | Retains skill discovery, orphan handling, strict frontmatter behavior, and structural validation. | 11 |
| `tests/validate-test-hooks.test.js` | Rewrite | Requires the shell suite to exit 0 with a positive-count PASS summary; the embedded shell contract covers valid module activation, silent no-module behavior, and no Docker diagnostics for startup/compact while keeping the independent learning-db library checks. | 3 |

The reasoner assigned no helper or fixture as a primary support asset to this
batch. No production source changed, so production line/branch coverage is
**N/A**. CI discovers these suites recursively through `tests/run-all.js`.
The implement-step decision was **REASONER_REQUIRED**; the read-only reasoner
returned **READY_FOR_DISPATCH**; `planner=skipped` because this is not an
OpenSpec apply.

Pre-edit GitNexus file-level upstream impacts for the changed test and script
targets returned **UNKNOWN** because those paths are not indexed. Those empty
caller sets remain unresolved, not an all-clear. Text search independently
confirmed recursive `tests/run-all.js` discovery, the `scripts/ci/catalog.js`
coverage mapping for `scripts/validate/test-hooks.sh`, and the CI workflow's
direct invocation of `validate-skill-purpose-decisions.js`. The inventory
changes only the nine assigned status values; its numeric signals, rank
columns, and all other rows remain frozen. Final detect-changes evidence is
left to the parent flow, which owns that pre-commit check.

### Issue #680 — Cohort B batch 19

The nine assigned suites are **8 keep / 1 rewrite / 0 delete**. The focused
baseline and final aggregates each passed **81/81 cases** on Node `v26.10.0`
and Darwin.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/validate-workflow-policy.test.js` | Keep | Retains workflow action pins, runner and Node baselines, permissions, timeouts, and checkout-less command policy. | 26 |
| `tests/verify-codex-native-package.test.js` | Keep | Retains generated package parity, membership/content/frontmatter drift, routing provenance, and consumer evidence states. | 8 |
| `tests/verify-platform-packages.test.js` | Keep | Retains four-platform package outputs, declared runtime overlaps, and rewritten policy links. | 4 |
| `tests/verify-publication-bundle.test.js` | Rewrite | Replaces a self-computed hash comparison with execution of the release workflow's producer-bound digest guard; a tampered downloaded verifier must fail before Node runs. | 4 |
| `tests/verify-release-parity-cli.test.js` | Keep | Retains branch-independent tag-version parity across package provenance, manifests, and bilingual generator pins. | 4 |
| `tests/verify-runner.test.js` | Keep | Retains installed runner mode selection, local typecheck fallback, skips, and failure reporting against scratch repositories. | 6 |
| `tests/verify-staged-package-version.test.js` | Keep | Retains tracked manifest/provenance version parity and invalid-target rejection. | 5 |
| `tests/version-diff.test.js` | Keep | Retains verified, incompatible, missing-pin, and unverified advisory output behavior. | 7 |
| `tests/version-family-skills.test.js` | Keep | Retains Laravel/PHPUnit selector and CLI behavior, copied-package independence, retirement checks, and routing rejection. | 17 |

No helper or fixture was assigned to this batch, and no production file changed;
production line and branch coverage comparison is N/A. CI recursively discovers
these suites through `tests/run-all.js`; the script ownership check passed with
`node scripts/ci/catalog.js --check`. The rewritten publication case passes the
real workflow guard with the original verifier, then rejects a tampered
downloaded copy before the mock Node command runs. A temporary workflow copy
with the digest comparison removed made the rewritten suite fail at its
producer-binding assertion; the mutation was removed afterward.

The implement-step decision was **REASONER_REQUIRED**; the read-only reasoner
returned **READY_FOR_DISPATCH**; `planner=skipped` because this is not an
OpenSpec apply. The reasoner's indexed-worktree impacts for the nine test files
were **LOW**, with zero resolved callers and affected processes/modules and no
HIGH/CRITICAL result. A separate test-file query returned **UNKNOWN**, so text
search confirmed aggregate-runner discovery and CI use instead of treating an
empty caller set as proof of non-use. The release verifier itself had **LOW**
impact with three direct callers and zero affected processes. The inventory
changes only these nine disposition cells; frozen numeric fields, ranks, and
all other rows remain unchanged.

### Issue #681 — Cohort B batch 20

The nine assigned suites are **6 keep / 3 rewrite / 0 delete**. The focused
baseline and final aggregates each passed **9/9 suites and 180/180 cases** on
Node `v26.10.0` / Darwin.

| Test file | Disposition | Protected contract and assertion evidence | Final Darwin cases |
| --- | --- | --- | ---: |
| `tests/worker-context-benchmark.test.js` | Rewrite | Uses fixed oracle expectations, fixture-specific replies, and verifies all nine scores; a negative-control response stays transport-PASS but scores fail. | 23 |
| `tests/workflow-coordinator-delivery.test.js` | Keep | Retains PR authorization and provider/CI adapter behavior for merge identity, reruns, ambiguity, and missing transport. | 12 |
| `tests/workflow-coordinator-evidence-continuity.test.js` | Keep | Retains selective lane refresh, freshness expiry, premise invalidation, and exact authority override contracts. | 27 |
| `tests/workflow-coordinator-security.test.js` | Keep | Retains hostile-object and secret non-disclosure checks, evidence bindings, gate ownership, routing, and review-finding safety contracts. | 76 |
| `tests/workflow-coordinator.test.js` | Rewrite | Removes a duplicate freeze/input-preservation test; the history loop already checks those properties for every history, including merge-ready. | 18 |
| `tests/workflow-docs.test.js` | Keep | Retains bilingual route guidance, update-docs contracts, README links, and command-index coverage. | 3 |
| `tests/workflow-package-closure.test.js` | Keep | Retains inventory escape, symlink, renamed-ID, cache, and source-bundle closure checks. | 5 |
| `tests/workflow-package-runtime.test.js` | Rewrite | Parses the analyzer JSON and checks schema version, nonempty phase, nonnegative P0/P1 counts, and the exact exit status derived from those counts. | 7 |
| `tests/write-handoff.test.js` | Keep | Retains explicit destinations, full payloads, atomic replacement, symlink safety, detect/write revalidation, and unavailable-Python behavior. | 9 |

No helper or fixture was assigned to this batch, and no production file changed;
production line and branch coverage comparison is N/A. CI recursively discovers
these suites through `tests/run-all.js`; the required script ownership check
passed. The benchmark's score-mutation control failed when the score was forced
to pass, the runtime suite rejected a mutated analyzer exit status, and the
coordinator history loop rejected unfrozen output. Each mutation ran in a
disposable copy and was removed.

The implement-step decision was **REASONER_REQUIRED**; the read-only reasoner
returned **READY_FOR_DISPATCH**; `planner=skipped` because this is not an
OpenSpec apply. GitNexus impact on `WorkflowCoordinator` was **MEDIUM** with
nine direct graph callers and zero identified processes; `runBenchmark` and
`scoreResponse` were **LOW**, each with two direct callers and zero identified
processes. The analyzer entry point had **LOW** impact with one direct caller.
Impact on `physicalSkillTree` was **HIGH, partial**, with callers in package
closure/publication and indirect CI, release, and packaging paths. That result
does not clear the surface: neither the symbol nor its callers were changed.
File-target impacts for the nine suites remained **UNKNOWN**; text search
confirmed recursive test discovery, CI execution, and the script ownership
mapping. The inventory changes only these nine disposition cells; frozen
metrics, ranks, and all other rows remain unchanged.

### Issue #683 — Cohort B integration

Decision: **REASONER_REQUIRED**; reasoner result: **READY_FOR_DISPATCH**;
`planner=skipped` because this is not an OpenSpec apply. The reasoner approved
the Bash-native paired measurement and its output, source-identity, line-trace,
branch-control, and instrumentation-parity checks before this integration
entry was written.

The 20 closed batch ledgers (#662–#681) reconcile to all **195 assigned formal
suites**: **100 keep, 95 rewrite, 0 active-suite delete**. Every formal-suite
inventory row has one disposition. The separately tracked, prevalidated
`tests/retirement-closure.test.js` deletion in #666 is not an active suite and
uses no queue ordinal; its acceptance and rejection contract is now owned by
`tests/validate-retirement-closure.test.js`, with an explicit catalog mapping.

All **31 primarily assigned support assets** were audited. The 16 helpers are
**10 reviewed keep, 1 audited keep, and 5 reviewed rewrite**. The 15 fixtures
are **7 reviewed keep, 5 audited keep, 1 audited rewrite, and 2 reviewed
delete**. The inventory records each path's primary consumer and disposition.
The batch ledgers retain replacement behavior evidence and controlled negative
checks for rewritten assertions; independent document, configuration,
publication, installation, and safety contracts remain explicitly covered.

The affected production-area comparisons retain or increase covered counts:

| Production area | Covered lines before → after | Covered branches before → after | Integration result |
| --- | ---: | ---: | --- |
| `scripts/hooks/pre-bash-guard.sh` (#663) | 30/33 → 30/33 | 15/18 → 15/18 | Bash 5.2.37 paired measurement; method and source hashes recorded in #663 above. |
| `scripts/ci/catalog.js` (#666) | 297/371 → 298/372 | 23/46 → 23/46 | Catalog ownership map adds one covered line; branch coverage is retained. |
| `scripts/ci/validate-agent-plugin-package.js` (#677) | 55/60 → 56/61 | 11/14 → 11/14 | One additional covered line; no covered branch lost. |
| `scripts/ci/validate-cursor-plugin-package.js` (#678) | 60/65 → 62/67 | 2/15 → 14/22 | Two additional covered lines and twelve additional covered branches. |

Known measurement differences are recorded with their owners. The #666 paired
comparison used Node v26.10.0 on both sides, while the frozen inventory used
Node v24.21.0; this environment difference does not affect the within-batch
comparison. In #667, adding exercised scenarios raised the aggregate branch
denominator from 2598 to 2608 while covered branches rose from 1688 to 1700;
the three affected production modules gained coverage and none lost covered
lines or branches. The c8 report-map merge documented in #659 is likewise
report-map drift, not lost execution; it is not a Cohort B production change.

The first local focused aggregate launched all 195 suites and passed 193. The
`tests/session-usage-audit.test.js` failure was the documented Darwin
`TMPDIR=/private/tmp` requirement from #671; rerunning that suite with the
required environment passed 38/38. `tests/verify-platform-packages.test.js`
requires a clean source checkout for provenance-bound generation, so its
failure on this uncommitted integration worktree is not a clean verification
result. After commit `20d4c4a7`, the clean-checkout aggregate with
`TMPDIR=/private/tmp` passed **195/195 suites**; the provenance-bound package
verification passed in that clean run. `node scripts/ci/catalog.js --check`
reported zero uncovered scripts. CI recursively discovers these suites
through `tests/run-all.js`; the explicit Darwin subset and all changed
production areas are represented in the batch records above. The clean full
GitHub CI run for PR #729 completed successfully as run
[`36482524115`](https://github.com/hmj1026/dhpk/actions/runs/36482524115):
390/390 test files passed, the catalog reported zero uncovered scripts,
Markdown lint passed, and the macOS installer harness passed. The conditional
Release rehearsal job was skipped. PR #729 merged into `develop` at
`3559f82a` on 2026-09-28. Issue #679's `scripts/validate/test-hooks.sh` change
is an embedded test support suite, not a runtime production path; its assigned
focused tests pass.

Pre-edit GitNexus impact on the canonical ledger path returned **UNKNOWN**
(`target not found`), so it was not treated as an all-clear. Repository text
search found no direct path references to this ledger; canonical-to-marketplace
copying is owned by `scripts/ci/gen-claude-marketplace-package.js`. Only the
canonical ledger was edited directly; the generated package copy is refreshed
by that generator.

### Issue #684 — Full inventory and clean CI verdict

Decision: **REASONER_REQUIRED**; read-only reasoner result:
**READY_FOR_DISPATCH**; `planner=skipped` because this issue is not an OpenSpec
apply. The reasoner verified the frozen inventory, both cohort ledgers, support
asset assignments, aggregate discovery, CI subsets, deletion owners, and the
integrated CI evidence before this verdict was written.

The frozen inventory contains 393 original formal suites: 391 assigned active
rows plus the two separately tracked prevalidated deletions. Every original
row has exactly one disposition: **219 keep, 171 rewrite, and 3 delete**. The
active rows account for 219 keep, 171 rewrite, and one deletion; the remaining
two deletions are `tests/claude-capability-bundle.test.js` (#644) and
`tests/retirement-closure.test.js` (#666). Their discovered replacement
assertion owners are `tests/profile-scoped-claude-capability-bundle.test.js`
and `tests/validate-retirement-closure.test.js`. The active deleted duplicate,
`tests/plugin-user-config-behavior.test.js` (#661), has runtime behavior owned
by `runtime-config` and `load-project-config`, while
`plugin-user-config-metadata` protects its independent manifest contract.

All **54 support assets** have one inventory row and a recorded disposition:
the 24 helpers are **17 keep and 7 rewrite**; the 30 fixtures are **20 keep,
8 rewrite, and 2 delete**. Each helper and 29 fixtures have a recorded primary
consumer. The one fixture without a consumer,
`tests/fixtures/subagent-stop/lin-blog-2026-07-17.json`, was audited and deleted
in #676. Batch ledgers record the observable assertions and controlled
negative checks for rewrites. Independent document, configuration,
installation, publication, and safety contracts remain owned by retained
suites. Shared helpers and fixtures are support assets, not extra formal
suites.

The current aggregate discovers sorted recursive `tests/**/*.test.js` files
while excluding `tests/_lib`; CI and release invoke `tests/run-all.js`. The
separate Darwin installer job runs its explicit 11-file subset from
`tests/_lib/macos-installer-files.js`; those files are also members of the
aggregate, not additional suites. The marketplace package's copies of the
review ledger and inventory are generated projections from the canonical
files, not separate suite rows. The final clean CI evidence and catalog result
for the integrated cohort is recorded above. The batch ledgers record each
affected production-file comparison: covered lines and branches were retained
or increased except for the documented #659 c8 report-map merge on
`goal-context.js` (50/60 to 49/59), which reflects merged V8 ranges rather than
lost execution coverage. No other affected production path lost covered
lines or branches. This includes #644's catalog ownership-map line.

The pre-edit GitNexus impact for this documentation target returned
**UNKNOWN** because the indexed graph could not resolve the file; that result
was not treated as an all-clear. Text search found no direct import or path
references. The marketplace generator owns the generated documentation copy,
and this change edits only the canonical review ledger before regeneration.

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
number #644, implemented and reviewed in PR #688. The deletion at original
ordinal 247, `tests/retirement-closure.test.js`, was implemented by B batch 05 /
issue #666. Neither file is counted as an
active suite or silently removed from the inventory.

The CSV records candidate signals and stable ranks for triage. Numeric signals
such as `test_case_count`, assertion counts, and coverage values are measured
at the frozen `source_commit` and remain baseline data after a suite rewrite;
the batch tables above record the final case counts separately. For example,
`tests/dispatch-platform-validation.test.js` has 3 baseline cases in the
inventory and 4 after issue #649 adds a receipt case. The rank sorts
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
`tests/fixtures/subagent-stop/lin-blog-2026-07-17.json`, had no static consumer
and was explicitly held for an ownership audit in issue #676. That audit
confirmed no test, loader, or runtime consumer, and batch 15 deletes it. These
assignments are recorded per path in the CSV; batch owners must verify actual
ownership before changing shared support files. The assigned
`tests/fixtures/trap-sheet-detection/cases.json` fixture remained owned by B
batch 16 / issue #677; after its only runtime consumer was rewritten to check
the documented loader contract, batch 16 deletes it while preserving its
inventory row and ownership history.

Nine A suites are also in the macOS installer subset listed by
`tests/_lib/macos-installer-files.js` (11 files total). Discovery uses sorted
recursive `tests/**/*.test.js` files while excluding `_lib`; the aggregate
runner accepts one explicit suite path for focused measurements. CI also runs
the macOS subset. Every PR still needs a clean full CI pass because local runs
from a modified checkout can fail provenance checks.

### Cohort B — issue #641

The B queue uses the same frozen source commit,
`be3008af83d31e67a7c37797fd397deaf9726cc4`, and inventory SHA-256 recorded
above. The 391 active suites are split without overlap: Cohort A owns active
ordinals 1–196; Cohort B owns 197–391 (original ordinals 198–393). B assigns
its active paths in order to issues #662–#681:

| Batch | Issue | Active ordinals | Formal suites |
| --- | ---: | ---: | ---: |
| 01 | #662 | 197–206 | 10 |
| 02 | #663 | 207–216 | 10 |
| 03 | #664 | 217–226 | 10 |
| 04 | #665 | 227–236 | 10 |
| 05 | #666 | 237–246 | 10 |
| 06 | #667 | 247–256 | 10 |
| 07 | #668 | 257–266 | 10 |
| 08 | #669 | 267–276 | 10 |
| 09 | #670 | 277–286 | 10 |
| 10 | #671 | 287–296 | 10 |
| 11 | #672 | 297–306 | 10 |
| 12 | #673 | 307–316 | 10 |
| 13 | #674 | 317–326 | 10 |
| 14 | #675 | 327–336 | 10 |
| 15 | #676 | 337–346 | 10 |
| 16 | #677 | 347–355 | 9 |
| 17 | #678 | 356–364 | 9 |
| 18 | #679 | 365–373 | 9 |
| 19 | #680 | 374–382 | 9 |
| 20 | #681 | 383–391 | 9 |

The prevalidated deletion of `tests/retirement-closure.test.js` was implemented
by B batch 05 / issue #666 at its original-order insertion point. It is not a
formal suite and consumes no active ordinal. The frozen inventory records
ownership and baseline signals; per-issue ledger sections record the final
`keep`, `rewrite`, and `delete` decisions.

The inventory's B metrics are measured from the frozen source, before any A
suite rewrites. Candidate ranks sort by static forwarding-test reuse count
(descending), repeated lowercased test-title count (descending), assertion-call
count (ascending), API-shape assertion count (descending), static-artifact
matcher assertion count (descending), covered `scripts/` lines (ascending),
covered `scripts/` branches (ascending), and active ordinal. These lexical
counts reproduce all 196 A rows. The test-title count includes each distinct
lowercased title that appears in more than one of the original 393 flat suites.
`test_case_count` extracts single- or double-quoted titles after `test(` using
`\btest\s*\(\s*(['"])(.*?)\1`. `duplicate_test_titles` stores the repeated
lowercased title strings sorted per row. The assertion-call scan uses
`\bassert(?:\.[A-Za-z_$][\w$]*)?\s*\(` and includes matches in comments.
An API-shape match is an assertion call whose opening source line contains
`typeof` or `hasOwnProperty`; a static-artifact match is an
`assert.match` or `assert.doesNotMatch` call. These are triage signals, not
semantic judgments.

The forwarding-test signal counts only literal static `require` or `import`
specifiers resolving to another `.test.js` suite. No B suite has such a
static reference, so every B value is zero; this scan cannot rule out dynamic
forwarding. For measured suites, the coverage tail is `(0, lines, branches)`;
an unavailable run sorts as `(1,)` only after all earlier signals tie, then
active ordinal breaks any remaining tie.

Each B suite was measured independently through `tests/run-all.js` on Node
`v24.21.0` / Darwin with c8 `10.1.3`, using fresh V8 and report directories.
The inventory sums covered lines and branches for `scripts/` files and excludes
`scripts/lib/bounded-child-process.js`, which the aggregate runner loads for
every suite. `specific_script_modules_touched` counts the remaining script
files with at least one covered line or branch. The 195 accepted isolated runs
passed. The Darwin subset entries are `tests/run-bounded-node-test.test.js`
(batch 08 / #669) and `tests/session-usage-audit.test.js` (batch 10 / #671);
their measurements used `TMPDIR=/private/tmp`. The first default-TMPDIR run of
`session-usage-audit` failed 37/38 at the exact status assertion
(`verified` expected, `needs-verification` actual); rerunning with the
subset's `TMPDIR=/private/tmp` passed 38/38. The inventory uses the successful
rerun's coverage, and the row preserves that initial failure note. The
bounded-node suite passed 3/3 on Darwin and reported `SKIP_INCOMPATIBLE` for
its Linux-only cgroup case.

The aggregate suite runs in CI at `.github/workflows/ci.yml:120-134` and in
release verification at `.github/workflows/release.yml:43-50`. The separate
Darwin installer subset runs at `.github/workflows/ci.yml:151-165` and is
listed in `tests/_lib/macos-installer-files.js`. A clean CI run remains
required because local runs from a dirty checkout can fail provenance checks.
At the frozen baseline, 31 B support assets (16 helpers and 15 fixtures) were
assigned to the batch and issue of their lowest-original-ordinal B primary
consumer. The previously unreferenced
`tests/fixtures/subagent-stop/lin-blog-2026-07-17.json` was audited in batch 15
under issue #676 and deleted; all remaining support assets retain their
primary-consumer assignments.

## Test consolidation — issue #739

This section records the consolidation effort planned in
[#739](https://github.com/hmj1026/dhpk/issues/739): merge small, fast suites into
the suite that owns their contract, and apply the test-writing standard in
`skills/tdd-workflow/tests.md` to every moved assertion. Batch
tickets append their keep, rewrite, or delete outcomes below the baseline.

### Issue #740 — Baseline inventory, family map, and timing

Decision: **REASONER_REQUIRED**; read-only reasoner result:
**READY_FOR_DISPATCH**; `planner=skipped` because this issue is not an OpenSpec
apply. The reasoner checked the draft family map against the test files and
found batches grouped by name prefix instead of by production contract. Its
corrections are applied: it split or narrowed those batches, excluded two
suites that skip without a host tool, added the runtime cap, and computed
catalog entries across all batches at once.

#### Baseline

The baseline commit is `a8d40727e199fcd7aaed0358221fd6cff3b04231` on `docs/test-writing-standard`, the
branch that carries the test-writing standard. It was not yet merged into
`develop` when this baseline was taken. Later suite additions are tracked
separately and do not change this denominator.

`tests/run-all.js` discovers **393 suites** at that commit: every
`tests/**/*.test.js` except `tests/_lib`. All 393 are flat
`tests/*.test.js` files and total 86,916 lines. The count is one lower than the
394 estimated in #739.

The per-suite inventory is [the consolidation baseline](test-consolidation-baseline.csv).
Each row records the line count, measured runtime, test count, CI shard,
catalog production owner, and family-map disposition. The CI shard is the
`partitionFiles(files, 4)` bucket that CI's `--shard-index` selects. The catalog
owner lists every `scripts/` file that `scripts/ci/catalog.js` resolves to the
suite, through `COVERAGE_MAP` (marked) or the `<stem>.test.js` and
`<stem>-*.test.js` naming rule. 140 suites own no script.

#### Timing

Runtime comes from `DHPK_TEST_TIMING_FILE`. Each shard ran the same way as the
CI test job, one shard at a time on a clean checkout:

```sh
OUT="$(mktemp -d)"
for s in 0 1 2 3; do
  DHPK_TEST_JOBS=4 DHPK_TEST_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  DHPK_TEST_TIMING_FILE="$OUT/timing-shard-$s.json" \
  node tests/run-all.js --shard-index "$s" --shard-count 4
done
```

The run used Node `v26.9.0` on Linux (WSL2, 8 CPUs), without the CI
cgroup wrapper `scripts/ci/run-bounded-node-test.sh`. Absolute values differ from
CI runners, so use them for relative cost. Each batch re-measures its own
suites before and after the merge. All four shards passed.

| Shard | Files | Wall time | Slowest worker |
| --- | --- | --- | --- |
| 0 | 98 | 43.3 s | 43.3 s |
| 1 | 99 | 49.1 s | 49.0 s |
| 2 | 98 | 64.9 s | 64.8 s |
| 3 | 98 | 86.6 s | 86.6 s |

Per-suite runtime has a median of 152 ms, a 75th percentile of 651 ms,
and a 90th percentile of 2503 ms. Shard 3 is the longest because it holds
`install-codex-skills-reconciliation.test.js` (78.8 s).

#### Coverage

The per-production-file line and branch coverage baseline is
[the coverage baseline](test-consolidation-coverage-baseline.csv). One full
aggregate run produced it on the same commit and machine:

```sh
V8_DIR="$(mktemp -d)" REPORT_DIR="$(mktemp -d)"
DHPK_TEST_JOBS=4 npx --yes c8@10.1.3 \
  --temp-directory "$V8_DIR" \
  --report-dir "$REPORT_DIR" \
  --reporter=json-summary \
  node tests/run-all.js
```

The run passed 393/393 suites. The CSV keeps the 220 canonical production files
under `scripts/` and `skills/`. It omits 32 generated package copies under
`generated/` and `plugins/`, which are projections of those sources.
Together the 220 files have 63,829/74,964 lines (85.15%) and
18,542/25,400 branches (73.00%) covered. c8 measures only
JavaScript loaded under the repository root. Shell and Python production
files are not instrumented and have no row. A batch compares each affected
file against a fresh focused run, as the review rules above require; this
aggregate baseline is the reference point, not a substitute for that.

#### Exclusion rules

A suite is excluded from every batch when at least one rule applies. 81 suites are
excluded; a suite can match more than one rule.

- **Slow** (42): measured runtime of at least 2,500 ms (about the 90th
  percentile), or an entry in `WEIGHT_HINTS` or `TIMEOUT_HINTS` in
  `tests/run-all.js`. A slow suite may be split or optimized instead.
- **Safety-critical** (42): suites that own ADR-0017 safety branches or
  fail-closed invariants: Review Gate core, runtime, and receipt store; Risk
  Router; Workflow Coordinator; Platform Adapters; receipt primitives and
  redaction; the reviewer contract; and the focused Sentinel cases that
  ADR-0017 carries into the differential corpus.
- **Environment-isolated** (13): members of the Darwin installer subset in
  `tests/_lib/macos-installer-files.js`, where a merge would change that explicit
  file list and its per-file environment overrides, and suites that skip or
  exit when a host tool is missing. A merged owner would silently inherit
  that skip.

| Suite | Runtime | Reason |
| --- | --- | --- |
| `tests/bounded-child-process.test.js` | 5686 ms | slow: 5686 ms measured (>= 2500 ms) |
| `tests/catalog-claims.test.js` | 6344 ms | slow: 6344 ms measured (>= 2500 ms) |
| `tests/ci-review-gate-adapter.test.js` | 536 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/claude-review-gate-adapter.test.js` | 220 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/cli-dispatch-launcher.test.js` | 456 ms | environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/codex-native-install-smoke.test.js` | 198 ms | environment-isolated: exits the whole process when the live codex CLI is absent, so merging would skip the owner too |
| `tests/codex-review-gate-adapter.test.js` | 73 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/codex-review-gate-e2e.test.js` | 361 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/codex-runtime-contract.test.js` | 17621 ms | slow: 17621 ms measured (>= 2500 ms) |
| `tests/consumer-gate-cli.test.js` | 22107 ms | slow: 22107 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/consumer-platform-probe.test.js` | 6314 ms | slow: 6314 ms measured (>= 2500 ms) |
| `tests/dep-audit.test.js` | 2553 ms | slow: 2553 ms measured (>= 2500 ms) |
| `tests/dhpk-distribution.test.js` | 10001 ms | slow: 10001 ms measured (>= 2500 ms) |
| `tests/emit-review-gate.test.js` | 114 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/gen-cursor-plugin-package.test.js` | 2422 ms | slow: carries a tests/run-all.js scheduling hint |
| `tests/git-provider-review-gate-adapter.test.js` | 185 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/harness-facade-cli.test.js` | 14427 ms | slow: 14427 ms measured (>= 2500 ms) |
| `tests/harness-operation-receipts.test.js` | 191 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/harness-receipt-identity-lifecycle.test.js` | 812 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/install-assets.test.js` | 3842 ms | slow: 3842 ms measured (>= 2500 ms) |
| `tests/install-codex-runtime-assets.test.js` | 15553 ms | slow: 15553 ms measured (>= 2500 ms) |
| `tests/install-codex-skills-planning.test.js` | 41726 ms | slow: 41726 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/install-codex-skills-reconciliation.test.js` | 78777 ms | slow: 78777 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/install-codex-skills-uninstall.test.js` | 33193 ms | slow: 33193 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/install-codex-skills.test.js` | 19466 ms | slow: 19466 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/install-codex-sync-shared.test.js` | 10050 ms | slow: 10050 ms measured (>= 2500 ms) |
| `tests/install-cursor-harness.test.js` | 21085 ms | slow: 21085 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/install.test.js` | 1992 ms | environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/issue-237-cursor-runtime-contract.test.js` | 255 ms | environment-isolated: requires Linux bwrap with a shared network namespace and returns early otherwise |
| `tests/issue-733-codex-runtime-binding.test.js` | 3076 ms | slow: 3076 ms measured (>= 2500 ms) |
| `tests/multi-ai-sync-agy-platform.test.js` | 3549 ms | slow: 3549 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/multi-ai-sync-configured-platform-validation.test.js` | 2915 ms | slow: 2915 ms measured (>= 2500 ms) |
| `tests/multi-ai-sync-cursor-capabilities.test.js` | 31430 ms | slow: 31430 ms measured (>= 2500 ms) |
| `tests/multi-ai-sync-source-validation.test.js` | 3426 ms | slow: 3426 ms measured (>= 2500 ms) |
| `tests/prepare-release-cli.test.js` | 5602 ms | slow: 5602 ms measured (>= 2500 ms) |
| `tests/receipt-json-primitives.test.js` | 41 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/receipt-primitives.test.js` | 157 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/redaction.test.js` | 31 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-authority-semantics.test.js` | 335 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-conformance.test.js` | 51 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-cross-platform-differential.test.js` | 5203 ms | slow: 5203 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-evidence-continuity.test.js` | 2329 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-receipt-bundle.test.js` | 73 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-receipt-store-security.test.js` | 1732 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-receipt-store.test.js` | 3306 ms | slow: 3306 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-attestation.test.js` | 70 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-cli.test.js` | 699 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-companion-security.test.js` | 6783 ms | slow: 6783 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-consumer-e2e.test.js` | 12954 ms | slow: 12954 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-host-attestation-security.test.js` | 2515 ms | slow: 2515 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-host-trust-security.test.js` | 442 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-init-security.test.js` | 1600 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-observe-cli.test.js` | 786 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-observe-security.test.js` | 4093 ms | slow: 4093 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-observe-states.test.js` | 2426 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-review-findings.test.js` | 2387 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-runtime-storage-security.test.js` | 5403 ms | slow: 5403 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-security.test.js` | 4479 ms | slow: 4479 ms measured (>= 2500 ms); safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate-store-budget.test.js` | 34 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/review-gate.test.js` | 1068 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/reviewer-contract-v2.test.js` | 47 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/reviewer-contract.test.js` | 43 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/risk-router.test.js` | 63 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/run-bounded-node-test.test.js` | 18081 ms | slow: 18081 ms measured (>= 2500 ms); environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/run-cli-transport.test.js` | 5598 ms | slow: 5598 ms measured (>= 2500 ms) |
| `tests/run-codex.test.js` | 2258 ms | slow: carries a tests/run-all.js scheduling hint |
| `tests/run-portable-bounded-command.test.js` | 13855 ms | slow: 13855 ms measured (>= 2500 ms) |
| `tests/session-install-health-ask.test.js` | 2601 ms | slow: 2601 ms measured (>= 2500 ms) |
| `tests/session-usage-audit.test.js` | 996 ms | environment-isolated: member of the Darwin installer subset in tests/_lib/macos-installer-files.js |
| `tests/skill-pilot-install-migration.test.js` | 11406 ms | slow: 11406 ms measured (>= 2500 ms) |
| `tests/skill-pilot-isolation.test.js` | 2837 ms | slow: 2837 ms measured (>= 2500 ms) |
| `tests/skill-remaining-entry-isolation.test.js` | 10707 ms | slow: 10707 ms measured (>= 2500 ms) |
| `tests/subagent-stop-quality.test.js` | 701 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/subagent-stop-verify.test.js` | 99 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/validate-harness.test.js` | 3760 ms | slow: 3760 ms measured (>= 2500 ms) |
| `tests/validate-retirement-closure.test.js` | 15355 ms | slow: 15355 ms measured (>= 2500 ms) |
| `tests/verify-platform-packages.test.js` | 2503 ms | slow: 2503 ms measured (>= 2500 ms) |
| `tests/workflow-coordinator-delivery.test.js` | 517 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/workflow-coordinator-evidence-continuity.test.js` | 102 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/workflow-coordinator-security.test.js` | 137 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |
| `tests/workflow-coordinator.test.js` | 79 ms | safety-critical: ADR-0017 named safety branch or fail-closed invariant |

#### Family map

The map names **67 batches**. They merge 152 source suites into 67 owner
suites, which would take the suite from 393 to 241 files if every batch merged. The
remaining 93 eligible suites have no same-contract partner and stay
standalone; the CSV lists them. Each batch has one owner and at most 10
sources. The owner is the existing suite for the shared production script or
contract, so no batch creates a new owner file.

Merged runtime is the sum of measured member runtimes. Each batch is capped
at 5,000 ms, twice the slow threshold, so a merged file does not become a new
slow unit that unbalances a shard. The largest batch is 4.2 s. That is far
below the 180 s default per-file budget, so no batch needs a `TIMEOUT_HINTS` entry.
"Catalog entries" lists the scripts whose catalog test owner the batch
removes: scripts left with no owner once every batch is applied, and existing
`COVERAGE_MAP` entries that point at one of the batch's sources. The batch adds
or repoints each listed entry to its owner suite in the same change, so
`node scripts/ci/catalog.js --check all` stays green. 64 entries are listed in total.

| Batch | Owner | Sources | Contract | Merged runtime | Catalog entries |
| --- | --- | --- | --- | --- | --- |
| F01 `skill-isolation` | `skill-directory-isolation` | 6: `skill-bridge-family-isolation`, `skill-flow-entry-isolation`, `skill-flow-family-isolation`, `skill-local-tool-isolation`, `skill-release-isolation`, `skill-resume-family-isolation` | Relocated Skill directory isolation through the shared skill-directory-isolation harness | 4.2 s | none |
| F02 `skill-relocated-contracts` | `skill-runtime-path-contract` | 3: `skill-codemap-contract`, `skill-dep-audit-contract`, `skill-policy-bundle-contract` | Relocated Skill documents keep physical, self-contained runtime paths | 0.3 s | none |
| F03 `skill-directory-coverage` | `skill-directory-coverage` | 4: `skill-coverage-integrity`, `skill-declared-entry-coverage`, `skill-dependency-evidence`, `validate-skill-directory-coverage` | scripts/lib/skill-directory-coverage.js and its CI validator | 0.7 s | `scripts/ci/validate-skill-directory-coverage.js` |
| F04 `skill-health` | `skill-health-self-containment` | 2: `skill-health-check-lint`, `skill-health-check-resilience` | Skill health checks (lint, resilience, self-containment) | 1.5 s | none |
| F05 `skill-routing` | `skill-routing-projection-parity` | 5: `skill-routing-contract`, `skill-routing-frontend-regression`, `skill-routing-progressive-loading`, `skill-public-name-routing`, `version-family-skills` | Normalized family router and public-name routing (scripts/lib/skill-routing-projection.js) | 0.6 s | none |
| F06 `skill-lifecycle` | `skill-retirement-migration` | 4: `skill-migration`, `skill-capability-families`, `consolidate-remaining-dhpk-skill-families`, `portable-skill-names` | Skill retirement, migration, and naming in the distribution inventory | 0.8 s | none |
| F07 `skill-purpose` | `skill-purpose-decisions` | 2: `skill-purpose-additions`, `validate-skill-purpose-decisions` | scripts/lib/skill-purpose-decisions.js and its CI validator | 0.5 s | `scripts/ci/validate-skill-purpose-decisions.js` |
| F08 `skill-usage` | `skill-usage-contract` | 1: `skill-usage-projections` | scripts/lib/skill-usage.js contract and projections | 0.3 s | none |
| F09 `skill-resource-sync` | `skill-resource-sync-security` | 1: `skill-resource-sync` | scripts/lib/skill-resource-sync.js and scripts/ci/sync-skill-resources.js | 1.1 s | none |
| F10 `distribution-inventory` | `distribution-inventory-validate` | 5: `distribution-scoped-counts`, `distribution-projection-inventory`, `internal-cli-transport-inventory`, `internal-runtime-skills`, `harness-platform-matrix` | scripts/lib/distribution-inventory.js checked-in inventory views | 0.4 s | `scripts/lib/internal-runtime-skills.js` |
| F11 `distribution-projection` | `distribution-projection-contract` | 5: `distribution-compiler`, `distribution-projection-parity`, `distribution-rollback-proof`, `distribution-selection-plan-binding`, `projection-usage-binding` | Distribution compiler and projection contract | 0.9 s | `scripts/lib/distribution-compiler.js`, `scripts/lib/distribution-projection-parity.js` |
| F12 `validate-agents` | `validate-agents-behavior` | 1: `validate-agents-skills` | scripts/ci/validate-agents.js and validate-agents-skills.js | 2.9 s | `scripts/ci/validate-agents-skills.js` |
| F13 `validate-skills` | `validate-skills` | 1: `validate-skills-size` | scripts/ci/validate-skills.js | 1.0 s | none |
| F14 `validate-tree` | `validate-plugin` | 2: `validate-commands`, `validate-modules` | Real-tree plugin, command, and module validators | 1.7 s | `scripts/ci/validate-commands.js`, `scripts/ci/validate-modules.js` |
| F15 `cursor-sync` | `gen-cursor-sync` | 2: `cursor-sync-package`, `validate-cursor-sync` | Cursor sync package generator, library, and validator | 1.0 s | `scripts/ci/validate-cursor-sync.js`, `scripts/lib/cursor-sync-package.js` |
| F16 `references` | `validate-references` | 1: `reference-integrity` | scripts/ci/validate-references.js and real-tree reference integrity | 0.5 s | none |
| F17 `changelog` | `changelog-fragments` | 2: `validate-changelog-fragments-cli`, `current-changelog` | Changelog fragments library, CLI, and current section | 1.0 s | `scripts/ci/validate-changelog-fragments.js` |
| F18 `codex-native` | `codex-native-package-validate` | 5: `codex-native-activation`, `codex-native-experimental-gate`, `codex-plugin-manifest`, `gen-codex-native-package`, `verify-codex-native-package` | Codex native package, activation, and manifest | 1.9 s | `scripts/ci/gen-codex-native-package.js`, `scripts/ci/verify-codex-native-package.js`, `scripts/lib/codex-native-activation.js` |
| F19 `codex-discovery` | `check-codex-discovery` | 1: `codex-discovery-registry` | Codex discovery registry and read-only discovery check | 1.1 s | `scripts/lib/codex-discovery-registry.js` |
| F20 `context-budget` | `context-budget` | 1: `discovery-budget-parity-separation` | Discovery context budgets and budget-parity separation | 0.2 s | `scripts/lib/discovery-budget.js` |
| F21 `claude-user-config` | `plugin-user-config-metadata` | 2: `claude-user-config-probe`, `gen-claude-user-config` | Claude plugin userConfig metadata, generator, and consumer probe | 0.3 s | `scripts/ci/gen-claude-user-config.js`, `scripts/release/claude-user-config-probe.js` |
| F22 `claude-profile-bundle` | `profile-scoped-claude-capability-bundle` | 2: `claude-profile-probe`, `gen-claude-profile-bundles` | Profile-scoped Claude capability bundle, generator, and probe | 2.2 s | `scripts/ci/gen-claude-profile-bundles.js`, `scripts/release/claude-profile-probe.js` |
| F23 `capability-bundle` | `capability-bundle-selection` | 1: `capability-bundle-activation` | Capability bundle selection and activation | 0.1 s | `scripts/lib/capability-bundle-activation.js` |
| F24 `workflow-package` | `workflow-package-closure` | 1: `workflow-package-runtime` | Flow workflow package closure and self-contained runtime | 1.4 s | none |
| F25 `project-agent-projection` | `project-agent-projection-plan` | 1: `project-agent-projection-baseline` | Project agent projection plan and baseline | 0.5 s | `scripts/ci/project-agent-projection-baseline.js` |
| F26 `consumer-probes` | `parallel-consumer-probes` | 1: `release-probe-batch` | Parallel consumer probes and bounded probe batch | 0.2 s | `scripts/lib/release-probe-batch.js` |
| F27 `hook-events` | `hooks-wiring` | 1: `default-hook-events` | hooks.json wiring and default hook events | 0.1 s | none |
| F28 `codex-skill-surface` | `codex-skill-metadata` | 2: `codex-skill-layout`, `codex-supporting-parity` | Codex skill layout, metadata, and supporting-asset parity | 0.1 s | none |
| F29 `gen-claude-manifest` | `gen-claude-manifest` | 1: `gen-claude-manifest-generate` | scripts/ci/gen-claude-manifest.js | 0.3 s | none |
| F30 `agent-plugin` | `gen-agent-plugin-package` | 2: `agent-plugin-package`, `validate-agent-plugin-package` | Agent Plugin package library, generator, and validator | 1.2 s | `scripts/ci/validate-agent-plugin-package.js`, `scripts/lib/agent-plugin-package.js` |
| F31 `cursor-package` | `cursor-plugin-package` | 4: `validate-cursor-plugin-package`, `cursor-consumer-evidence`, `cursor-harness-adapt`, `cursor-session-home` | Cursor plugin package library and Cursor runtime helpers | 0.6 s | `scripts/ci/validate-cursor-plugin-package.js`, `scripts/lib/cursor-consumer-evidence.js`, `scripts/lib/cursor-harness-adapt.js`, `scripts/lib/cursor-session-home.js` |
| F32 `agy-plugin` | `agy-plugin-install` | 3: `agy-plugin-package`, `agy-path-contract`, `install-agy-plugin` | AGY plugin package, install lifecycle, path contract, and CLI | 3.2 s | `scripts/ci/install-agy-plugin.js`, `scripts/lib/agy-path-contract.js`, `scripts/lib/agy-plugin-package.js` |
| F33 `agy-adapt` | `agy-adapt-agents` | 1: `agy-adapt-agents-extended` | scripts/agy-adapt-agents.js | 0.7 s | none |
| F34 `native-shared-skills` | `native-shared-skill-install` | 1: `install-native-shared-skills` | Native shared-skill install library and CLI | 2.1 s | `scripts/ci/install-native-shared-skills.js` |
| F35 `native-dispatch` | `native-dispatch-policy` | 1: `native-fallback-contract` | Native-only dispatch policy and fallback contract | 0.1 s | none |
| F36 `dispatch` | `dispatch-engine` | 10: `dispatch`, `dispatch-config`, `dispatch-config-report`, `dispatch-contract`, `dispatch-platform-validation`, `dispatch-projection`, `dispatch-scheduler`, `issue-534-p1-dispatch-contract`, `issue-534-p1-failure-matrix`, `gen-dispatch-projection` | scripts/lib/dispatch*.js contract, engine, scheduler, config, and projection | 0.9 s | `scripts/ci/gen-dispatch-projection.js`, `scripts/dispatch-config-report.js`, `scripts/lib/dispatch-config.js`, `scripts/lib/dispatch-contract.js`, `scripts/lib/dispatch-platform-validation.js`, `scripts/lib/dispatch-projection.js`, `scripts/lib/dispatch-scheduler.js` |
| F37 `provider-adapters` | `provider-adapter` | 1: `provider-cli-adapters` | Provider adapter and provider CLI adapters | 0.1 s | `scripts/lib/provider-cli-adapters.js` |
| F38 `harness-facade` | `harness-facade-contract` | 4: `harness-docs`, `harness-release-aggregation`, `harness-surfaces`, `harness-workflow-config` | scripts/lib/harness.js facade, surfaces, and release aggregation | 0.3 s | `scripts/lib/harness-result.js`, `scripts/lib/harness-surfaces.js` |
| F39 `multi-ai-sync` | `multi-ai-sync-skill-contract` | 3: `multi-ai-sync-cursor-discovery`, `multi-ai-sync-parity`, `harness-govern-toml-fallback` | harness-govern multi_ai_sync fast contracts | 0.5 s | none |
| F40 `session-start` | `session-start` | 2: `session-start-advisories`, `trap-sheet-detection` | scripts/hooks/session-start.sh advisories and trap-sheet detection | 0.5 s | `scripts/hooks/_lib/advise-once.sh`, `scripts/hooks/_lib/detect-stack-hints.sh` |
| F41 `session-install-health` | `session-install-health-version` | 1: `session-install-health-modules` | scripts/hooks/_lib/install-health.sh | 1.4 s | none |
| F42 `stop-advisory` | `stop-advisory-dispatch-graduation` | 3: `stop-advisory-dispatch-completion-evidence`, `stop-advisory-dispatch-modules`, `stop-dispatch-audit` | Stop-hook dispatch advisory and audit | 1.9 s | `scripts/hooks/_lib/stop-dispatch-audit.sh` |
| F43 `bash-guards` | `pre-bash-guard` | 1: `pre-bash-dispatch` | PreToolUse Bash guard and its dispatch wrapper | 2.2 s | `scripts/hooks/pre-bash-dispatch.sh` |
| F44 `edit-guards` | `pre-edit-guard` | 1: `pre-edit-batch-gate` | PreToolUse Edit guard and batch gate | 1.5 s | `scripts/hooks/pre-edit-batch-gate.sh` |
| F45 `project-config` | `load-project-config` | 2: `runtime-config`, `session-env` | Project config loading and the libraries it sources | 0.9 s | `scripts/hooks/_lib/runtime-config.sh`, `scripts/hooks/_lib/session-env.sh` |
| F46 `portable-shell` | `portable-stat` | 2: `portable-sed`, `portable-timeout` | Portable sed, stat, and timeout shell helpers | 2.3 s | `scripts/hooks/_lib/portable-sed.sh`, `scripts/hooks/_lib/portable-timeout.sh` |
| F47 `handoff-resume` | `write-handoff` | 3: `set-handoff-state`, `detect-phase`, `portable-workflow-runtime` | opsx-apply-resume handoff write, state, and phase detection | 0.7 s | none |
| F48 `compaction-hooks` | `postcompact-restore` | 1: `precompact-archive` | PreCompact archive and PostCompact restore hooks | 0.3 s | `scripts/hooks/precompact-archive.sh` |
| F49 `flow-handoff` | `flow-handoff-contract` | 4: `flow-contract`, `flow-drive-invocation`, `flow-guide-ownership`, `flow-guide-usage-help` | Flow handoff contract, flow-drive invocation, and flow-guide ownership | 0.6 s | `skills/flow-guide/scripts/usage-card.js` |
| F50 `opsx-goal` | `opsx-goal-analyze` | 4: `opsx-goal-budget`, `opsx-goal-footprint`, `opsx-goal-policy-fallback`, `opsx-apply-goal-guardrails` | OpenSpec apply-goal analyzer, budget, footprint, and guardrails | 0.6 s | none |
| F51 `policy-docs` | `opsx-orchestration-decision-policy` | 6: `execution-policy-kernel`, `policy-static-guardrails`, `tdd-e2e-contracts`, `cli-worker-timeout-recovery`, `parallel-dispatch-contract`, `legacy-cli-role-agent-contract` | Execution policy and dispatch prompt static contracts | 0.5 s | none |
| F52 `platform-docs` | `documentation-platform-parity` | 2: `platform-installation-docs`, `workflow-docs` | Bilingual platform, installation, and workflow documentation | 0.2 s | none |
| F53 `command-disposition` | `command-skill-disposition` | 4: `command-skill-portability`, `command-front-door-parity`, `simplify-command-contract`, `command-namespace` | Command-to-Skill disposition, portability, and namespace | 0.3 s | `scripts/lib/command-namespace.js` |
| F54 `platform-provenance` | `platform-provenance` | 2: `platform-boundary`, `platform-conformance` | Platform provenance, boundary, and conformance | 0.5 s | none |
| F55 `release-workflow` | `release-workflow` | 1: `git-flow-governance` | Static release workflow and git-flow policy | 0.1 s | none |
| F56 `release-evidence` | `release-evidence` | 1: `consumer-evidence-normalization` | scripts/lib/release-evidence.js consumer status vocabulary | 0.1 s | none |
| F57 `release-publication` | `release-publication-bundle` | 1: `verify-publication-bundle` | Release publication bundle and standalone verifier | 0.4 s | `scripts/release/verify-publication-bundle.js` |
| F58 `release-parity` | `release-parity` | 1: `verify-release-parity-cli` | Release parity library and CLI | 0.3 s | `scripts/ci/verify-release-parity.js` |
| F59 `release-gates` | `gate-runner` | 3: `source-gate-cli`, `package-gate-cli`, `publish-gate-cli` | Gate runner and SOURCE, PACKAGE, PUBLISH gate CLIs | 1.7 s | `scripts/release/package-gate.js`, `scripts/release/publish-gate.js`, `scripts/release/source-gate.js` |
| F60 `test-infra` | `verify-test-shards` | 2: `render-test-timing`, `run-all` | Aggregate runner, shard verification, and timing rendering | 0.3 s | `scripts/ci/render-test-timing.js` |
| F61 `repo-runners` | `precommit-runner` | 1: `verify-runner` | Skill-local precommit and verify runners | 2.4 s | none |
| F62 `cli-dispatch` | `cli-role-resolver` | 1: `cli-dispatch-context` | CLI role resolver and dispatch context | 0.1 s | none |
| F63 `resolve-feature` | `resolve-feature-cli` | 2: `resolve-feature`, `feature-resolver` | Feature resolution library, shell entry, and CLI | 0.4 s | `scripts/lib/feature-resolver.js` |
| F64 `project-agent-publisher` | `project-agent-projection-publisher` | 2: `project-agent-runtime-assets`, `project-workflow-resources` | Project projection publisher runtime closure | 0.6 s | none |
| F65 `project-agent-providers` | `project-agent-provider-adapters` | 1: `project-agent-host-binding-policy` | Project agent provider adapters and Host binding policy | 0.1 s | `scripts/lib/project-agent-host-binding-policy.js` |
| F66 `cross-cli` | `cross-cli-parity` | 1: `check-cross-cli-drift` | Cross-CLI parity library and drift check | 0.2 s | `scripts/check-cross-cli-drift.sh` |
| F67 `task4` | `task4-defects` | 1: `task4-consolidation` | Task 4 consolidation and defect regressions | 0.9 s | none |

Suite names in the table omit the `tests/` prefix and `.test.js` suffix. Each
batch ticket records test-name parity, before-and-after coverage for every
affected production file, per-file runtime, and a keep, rewrite, or delete
outcome for each moved assertion, as #739 requires.

The pre-edit GitNexus impact for this ledger returned **UNKNOWN**
(`target not found`), so it was not treated as an all-clear. Text search
found no reference to the ledger outside its generated marketplace copy.
This change adds only documentation and the two CSV files. No test, runner,
or catalog mapping changed.

### Issue #787 — Skill layout, isolation, and coverage

**Decision: REASONER_REQUIRED**
**Reasoner result: READY_FOR_DISPATCH**
**Conclusion:** the four listed batches have independent owners and bounded
write scopes. Keep the 135 registered test names except for the two duplicated
source-fingerprint assertions whose exact contract remains owned by the
per-fixture `finally` checks. Extract shared fixture setup, add the validator's
catalog owner, and verify every rewritten behavior with a controlled named RED
followed by a restored GREEN. Keep the four merged suites under the 180-second
per-file limit.
**Evidence:** the batch ownership and catalog map are listed in the family map
above; the test rejection rules are in `skills/tdd-workflow/tests.md` under
“Rejection Checklist”; the issue acceptance criteria require name parity,
mutation evidence, fresh before/after c8 runs, timing, catalog validation, and
generated-package checks. The earlier F03 overlap is between
`tests/skill-directory-coverage.test.js` (fixture-covered coverage behaviors)
and `tests/skill-coverage-integrity.test.js` / `tests/skill-declared-entry-coverage.test.js`
(the declaration and dependency graph contracts); the separate F03 owner keeps
the behavior assertions and extracts only shared fixture setup.
**Next actions:** execute F01–F04 independently, capture named mutation
evidence, run fresh focused timing and c8 reports on both sides, validate the
catalog and generated marketplace package, then review the whole diff.
`planner=skipped` because this is not an OpenSpec apply.

**Review correction:** the first F03 consolidation draft replaced the
canonical physical script/basename scan with a second validator CLI call. Code
review showed that a physical `new-tool.js` mentioned only by basename could
then be missing from the coverage registry while the CLI still passed. The
final change restores the independent scan in
`tests/_lib/skill-declared-entry-audit.js` and adds a synthetic unregistered
`new-tool.js` fixture to the retained named test. This remains test-only; the
validator API and runtime behavior do not change.

#### Source-suite disposition

`KEEP` preserves a contract assertion; `REWRITE` changes its setup or oracle
to assert externally visible behavior and has a named mutation proof;
`DELETE` is limited to a duplicate contract with its remaining owner named.
Generated parameterized test names count as registered names.

| Batch / source suite | Outcome | Assertion disposition and owner |
| --- | --- | --- |
| F01 `skill-bridge-family-isolation` | KEEP, REWRITE, DELETE | Kept the isolated bridge fixtures; rewrote the raw-directory registry and caller-visible usage-card checks. Deleted only `bridge-family canonical Skill sources remain unchanged after all relocations`; the bridge fixture cases in `skill-directory-isolation.test.js` fingerprint the canonical sources in `finally`. |
| F01 `skill-flow-entry-isolation` | KEEP, REWRITE | Kept every isolated public-entry case; rewrote the Skill-local entry registry. |
| F01 `skill-flow-family-isolation` | KEEP, REWRITE, DELETE | Kept the isolated flow fixtures and rewrote the family entry matrix. Deleted only `flow-family fixture sources remain canonical after all relocations`; each corresponding flow fixture in `skill-directory-isolation.test.js` checks canonical-source fingerprints in `finally`. |
| F01 `skill-local-tool-isolation` | REWRITE | Reworked Laravel and PHPUnit local-version guidance, missing-version fail-closed behavior, and the JavaScript missing-directory case to assert actionable diagnostics. |
| F01 `skill-release-isolation` | REWRITE | Reworked the release preparation contract to inspect explicit file arguments and output metadata; retained expected-output metadata because the directory-coverage validator consumes it. |
| F01 `skill-resume-family-isolation` | KEEP, REWRITE | Kept Save/Resume handoff, symlink rejection, local extractor, and post-observation contracts; rewrote the registry check to pin canonical owners and synchronized local entries. |
| F02 `skill-codemap-contract` | KEEP, REWRITE | Preserved the test name and its five literal output-file and write-boundary contract. Removed an incidental assertion that the temporary `projectDir` remained empty after reading instructions; this checked setup state, not Codemap behavior. `tests/codemaps-generate.test.js` owns generated-output behavior. |
| F02 `skill-dep-audit-contract` | KEEP, REWRITE | Preserved the named independent-review contract and strengthened it to require local instructions, no peer review dependency, no self-approval, and an explicit fix route. |
| F02 `skill-policy-bundle-contract` | KEEP | Moved all three generated policy-bundle checks with their names intact, including physical resource boundaries and parent-of-rules resolution. |
| F03 `skill-coverage-integrity` | KEEP, REWRITE | Kept all ten registered contracts. Rewrote the four declarations around public/helper classification, helper caller validity, public-entry reachability, and required caller classification; the other integrity and symlink contracts remain unchanged. |
| F03 `skill-declared-entry-coverage` | KEEP, REWRITE | Kept the runnable-declaration/prose-example contract and restored its independent recursive scan of physical Skill scripts against `SKILL.md` basenames and the coverage registry. Added a synthetic `new-tool.js` fixture so a documented bare basename with no role is explicitly detected. |
| F03 `skill-dependency-evidence` | KEEP | Kept all fourteen generated evidence cases with their names and production linter behavior. |
| F03 `validate-skill-directory-coverage` | KEEP | Kept both CLI contracts: one PASS per canonical inventory identity and exit 2 for unknown arguments. |
| F04 `skill-health-check-lint` | KEEP | Kept all three health-lint contracts, including agent capability skips and command-file filtering. |
| F04 `skill-health-check-resilience` | KEEP, REWRITE | Kept all seven resilience contracts. Rewrote malformed-entry P1 fix hints to six literal safe steps and made the P2-visibility test use a deliberate duplicate-description fixture while retaining the canonical P1=0 assertion. |

The only deleted registered test names are the two F01 canonical-source
fingerprints listed above. The other 133 names match the 135-name baseline
exactly. The F02 temporary-directory assertion was removed inside its retained
named test; it was not a registered test deletion. No test assertion was
removed without a named remaining owner.

#### Controlled mutation evidence

Every mutation below made only the named test RED; restoring the source made
the owner suite GREEN again. All owner runs reported the full final count.

| Batch | Mutated contract and sole expected RED test | Restored GREEN |
| --- | --- | --- |
| F01 | `bridge-family registry exposes the exact raw-directory entry matrix` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `flow entry registry pins every expected Skill-local entry before execution` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `isolated public entry flow-guide-usage-local-card` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `laravel-local-version-guidance` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `phpunit-local-version-guidance` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `laravel-missing-version-blocked` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `phpunit-missing-version-blocked` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `js-status-missing-directory` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `release-prepare-explicit-files` | `skill-directory-isolation.test.js`: 58/58 |
| F01 | `resume-family registry exposes canonical owners and synchronized local entries` | `skill-directory-isolation.test.js`: 58/58 |
| F02 | `runtime path repair preserves handoff and optional-provider contracts` | `skill-runtime-path-contract.test.js`: 9/9 |
| F02 | `skill documents never resolve Skill scripts through CLAUDE_PLUGIN_ROOT` | `skill-runtime-path-contract.test.js`: 9/9 |
| F02 | `relocated codemap Skill retains its five literal output files and write boundary` | `skill-runtime-path-contract.test.js`: 9/9 |
| F02 | `relocated dependency audit keeps a local independent review contract without a peer` | `skill-runtime-path-contract.test.js`: 9/9 |
| F03 | `documented public scripts cannot be reclassified as internal helpers` | `skill-directory-coverage.test.js`: 43/43 |
| F03 | `a helper cannot list itself as its caller` | `skill-directory-coverage.test.js`: 43/43 |
| F03 | `every declared helper must be reachable from the fixture-covered public entry` | `skill-directory-coverage.test.js`: 43/43 |
| F03 | `a required_by caller must be a declared public, API, or helper entry` | `skill-directory-coverage.test.js`: 43/43 |
| F03 | `every script basename declared by a canonical Skill has an explicit coverage role` (mutation: make the bare-basename matcher always false) | Disposable filtered copy: owner 43/43 after restore |
| F04 | `malformed entries produce deterministic P1 findings with safe fix hints` | `skill-health-self-containment.test.js`: 23/23 |
| F04 | `canonical source tree has zero P1 findings while P2 advisories remain visible` | `skill-health-self-containment.test.js`: 23/23 |

F01's ten RED/GREEN records are in `/tmp/dhpk-issue787-f01-mutation-evidence.log`.
F03's declared-entry mutation changed only the test helper's bare-basename
match to `false` in a disposable filtered copy. The named canonical-role test
was the only RED (owner 42/43); restoring the helper returned the owner to
43/43. The synthetic physical `scripts/new-tool.js` has a backtick basename in
`SKILL.md` but no coverage role. This assertion and its RED/GREEN outcome are
recorded here; the raw command logs remain local under `/tmp` and are not part
of the PR. F01's log is `/tmp/dhpk-issue787-f01-mutation-evidence.log`. F02 and
F04 mutation logs were captured during their batch runs.

#### Focused timing and c8 comparison

The baseline was a fresh c8 run on clean base
`49d521801ca71972f16fa105fb66267bf64b8bf2` with Node v26.9.0. The final run
used four merged suites, Node v26.9.0, c8 10.1.3, and fresh temporary coverage
directories. Test names and totals came from `tests/run-all.js` output.

| Batch | Baseline suites / runtime sum | Final owner / runtime | Final tests | New `TIMEOUT_HINTS` |
| --- | ---: | ---: | ---: | --- |
| F01 | 7 / 4,377 ms | `skill-directory-isolation.test.js` / 4,216 ms | 58/58 | none |
| F02 | 4 / 232 ms | `skill-runtime-path-contract.test.js` / 143 ms | 9/9 | none |
| F03 | 5 / 687 ms | `skill-directory-coverage.test.js` / 633 ms | 43/43 | none |
| F04 | 3 / 1,497 ms | `skill-health-self-containment.test.js` / 1,748 ms | 23/23 | none |
| **Total** | **19 / 6,793 ms** | **4 / 6,740 ms** | **133/133** | **none** |

The runner's measured elapsed time was 2,356 ms before and 4,277 ms after; the
table's batch runtime sums are per-file timings and are not wall-clock totals.
Every owner is far below the 180-second default. All four owner suites pass,
and `node scripts/ci/catalog.js --check all` reports PASS with zero uncovered
entries.

| Affected production file | Baseline lines | Final lines | Baseline branches | Final branches |
| --- | ---: | ---: | ---: | ---: |
| `scripts/ci/validate-skill-directory-coverage.js` | 52/55 | 52/55 | 5/7 | 5/7 |
| `scripts/lib/bounded-child-process.js` | 36/50 | 36/50 | 2/8 | 2/8 |
| `scripts/lib/bounded-filesystem.js` | 122/169 | 122/169 | 16/36 | 16/36 |
| `scripts/lib/skill-directory-coverage.js` | 472/521 | 472/521 | 193/261 | 194/262 |
| `skills/skill-scope/scripts/skill-lint.js` | 1266/1390 | 1266/1390 | 415/494 | 410/489 |

The `skill-lint.js` raw c8 branch count is an unrelated V8 range-map variance,
not a behavior-path loss: its source SHA-256 is unchanged from the base; the
report has 79 uncovered branches both before and after, with no previously
covered shared arm becoming zero. The overlapping branch ranges were remapped
when execution changed from 19 source-suite processes to four owner-suite
processes. Read-only counter checks confirm the extensionless relative require
path at line 589 (130 hits), the path/stem predicates at lines 586 and 592
(1,027 and 7 hits), the two capability-skip conditions at line 1042 and 1091,
and the unresolved-route check at line 319 remain exercised. The raw c8 figures
are retained here rather than adjusted or hidden. F03's shared coverage module
gains one covered and one total branch.

The test-name diff is exactly 135 to 133, with no unplanned removals or new
names. The two deletions are the redundant canonical-source fingerprint tests
owned by the F01 fixture `finally` checks above. The generated marketplace
package is regenerated from this ledger and checked with
`node scripts/ci/gen-claude-marketplace-package.js --check` before delivery.

Pre-edit GitNexus impact was **UNKNOWN** for the dynamically discovered test
suites and their catalog owner; text search of `tests/run-all.js` confirms
runtime `*.test.js` discovery, and source/reference checks were used for those
UNKNOWN results. GitNexus impact for `validateSkillDirectoryCoverage` was
**LOW** (eight impacted symbols); the `COVERAGE_MAP` consumer impact was also
**LOW**. These findings did not indicate an unreviewed caller.

### Issue #788 — Skill routing, lifecycle, purpose, usage, and resource sync

Decision: **CLEAR**; read-only reasoner result: **READY_FOR_DISPATCH**;
`planner=skipped` because this issue is not an OpenSpec apply. The issue merges
five contract families across 13 source suites. Every baseline test name is
retained: the exact name multiset is **139 before and 139 after**, with no
deleted or added names. Each owner has one final `run()` call. The only
`COVERAGE_MAP` change assigns
`scripts/ci/validate-skill-purpose-decisions.js` to
`skill-purpose-decisions.test.js`.

#### Source-suite disposition

`KEEP` preserves the assertion, `REWRITE` changes its oracle and has a
controlled mutation proof, and `DELETE` removes a source file after all of its
tests have moved. There were no assertion deletions.

| Batch / source suite | Outcome and owner |
| --- | --- |
| F05 `skill-routing-contract` (2 tests) | KEEP unchanged; `skill-routing-projection-parity.test.js` |
| F05 `skill-routing-frontend-regression` (2 tests) | KEEP unchanged; `skill-routing-projection-parity.test.js` |
| F05 `skill-routing-progressive-loading` (2 tests) | KEEP unchanged; `skill-routing-projection-parity.test.js` |
| F05 `skill-public-name-routing` (2 tests) | KEEP unchanged; `skill-routing-projection-parity.test.js` |
| F05 `version-family-skills` (17 tests) | KEEP unchanged; `skill-routing-projection-parity.test.js` |
| F06 `skill-migration` (3 tests) | KEEP unchanged; `skill-retirement-migration.test.js` |
| F06 `skill-capability-families` (5 tests) | KEEP unchanged; `skill-retirement-migration.test.js` |
| F06 `consolidate-remaining-dhpk-skill-families` (4 tests) | KEEP unchanged; `skill-retirement-migration.test.js` |
| F06 `portable-skill-names` (8 tests) | KEEP unchanged; `skill-retirement-migration.test.js` |
| F07 `skill-purpose-additions` (2 tests) | KEEP unchanged; `skill-purpose-decisions.test.js` |
| F07 `validate-skill-purpose-decisions` (2 tests) | KEEP unchanged; `skill-purpose-decisions.test.js` |
| F08 `skill-usage-projections` (5 tests) | Three KEEP; two REWRITE; `skill-usage-contract.test.js` |
| F09 `skill-resource-sync` (7 tests) | Six KEEP; one REWRITE; `skill-resource-sync-security.test.js` |

F05 and F06 owners are 1,247 and 1,237 lines, above the usual 800-line
guideline. The issue requires one owner suite for each family and assigns all
13 source suites; these two files are the scoped exceptions. F09's owner is
799 lines.

#### Controlled mutation evidence

| Batch | Mutated contract and expected RED test | Restored GREEN |
| --- | --- | --- |
| F05 | `skill routing descriptions use public dhpk names, never legacy aliases` | `skill-routing-projection-parity.test.js`: 32/32; `/tmp/dhpk-issue788-f05-public-name-mutation.log` |
| F08 | `generated usage artifacts bind to one catalog revision and derive Argument Hints` | RED 17/18, then `skill-usage-contract.test.js`: 18/18; `/tmp/issue788-f08-revision-red.log`, `/tmp/issue788-f08-revision-green.log` |
| F08 | `$flow-guide help variants remain metadata-only and deterministic` | RED 17/18, then `skill-usage-contract.test.js`: 18/18; `/tmp/issue788-f08-determinism-red.log`, `/tmp/issue788-f08-determinism-green.log` |
| F09 | `skill-resource-sync exports the four foundation API functions` | RED in a disposable archive when the planner omitted the copy action, then `skill-resource-sync-security.test.js`: 43/43; `/tmp/dhpk-issue788-f09-a1-full-mutation-FIIokU/mutation-red.log`, `mutation-green.log` |

F06 and F07 assertions were not rewritten, so no mutation run was required.
F06 had one intermediate assembly-only failure caused by its editing script
expanding a literal `$` in a regex; the original assertion was restored and
the final owner passed 36/36.

#### Focused timing and c8 comparison

The baseline and final runs used Node v26.9.0, Linux, four jobs, fresh timing
files, and fresh c8 10.1.3 directories. The baseline was reproduced from clean
commit `b51784e4135b2ce6b2ffc1e101f1d5b65796e1a1`; the final run used the five
owner suites. The exact test-name multiset remains 139/139.

| Batch | Baseline files / runtime sum | Final owner / runtime | Final tests | New `TIMEOUT_HINTS` |
| --- | ---: | ---: | ---: | --- |
| F05 | 6 / 721 ms | `skill-routing-projection-parity.test.js` / 455 ms | 32/32 | none |
| F06 | 5 / 820 ms | `skill-retirement-migration.test.js` / 568 ms | 36/36 | none |
| F07 | 3 / 514 ms | `skill-purpose-decisions.test.js` / 320 ms | 10/10 | none |
| F08 | 2 / 418 ms | `skill-usage-contract.test.js` / 576 ms | 18/18 | none |
| F09 | 2 / 873 ms | `skill-resource-sync-security.test.js` / 751 ms | 43/43 | none |
| **Total** | **18 / 3,346 ms** | **5 / 2,670 ms** | **139/139** | **none** |

The runner's measured elapsed time was 1,101 ms before and 1,027 ms after;
the table sums per-file runtimes rather than wall-clock time. Every owner is
below the 180-second default. `node scripts/ci/catalog.js --check all` passes
with zero uncovered entries.

| Affected production file | Baseline lines | Final lines | Baseline branches | Final branches |
| --- | ---: | ---: | ---: | ---: |
| `scripts/ci/_lib/frontmatter.js` | 70/129 | 70/129 | 8/12 | 8/12 |
| `scripts/ci/_lib/report.js` | 36/51 | 36/51 | 3/6 | 3/6 |
| `scripts/ci/context-budget.js` | 197/365 | 197/365 | 29/83 | 29/83 |
| `scripts/ci/gen-skill-usage.js` | 127/245 | 145/245 | 13/31 | 23/40 |
| `scripts/ci/sync-skill-resources.js` | 51/76 | 51/76 | 11/16 | 11/16 |
| `scripts/ci/validate-skill-purpose-decisions.js` | 41/48 | 41/48 | 3/9 | 3/9 |
| `scripts/lib/agy-path-contract.js` | 55/97 | 55/97 | 4/14 | 4/14 |
| `scripts/lib/asset-inventory.js` | 45/201 | 45/201 | 1/1 | 1/1 |
| `scripts/lib/bounded-child-process.js` | 36/50 | 36/50 | 2/8 | 2/8 |
| `scripts/lib/bounded-filesystem.js` | 109/169 | 109/169 | 11/26 | 11/26 |
| `scripts/lib/capability-bundle-selection.js` | 448/849 | 448/849 | 96/208 | 96/208 |
| `scripts/lib/discovery-budget.js` | 158/245 | 158/245 | 38/67 | 38/67 |
| `scripts/lib/distribution-compiler.js` | 85/494 | 85/494 | 2/22 | 2/22 |
| `scripts/lib/distribution-inventory-regeneration.js` | 13/40 | 13/40 | 1/1 | 1/1 |
| `scripts/lib/distribution-inventory.js` | 1786/2518 | 1786/2518 | 544/876 | 562/894 |
| `scripts/lib/distribution-projection-contract.js` | 317/585 | 317/585 | 40/114 | 40/114 |
| `scripts/lib/distribution-projection-parity.js` | 155/461 | 155/461 | 29/49 | 29/49 |
| `scripts/lib/harness-surfaces.js` | 25/25 | 25/25 | 1/1 | 1/1 |
| `scripts/lib/internal-runtime-skills.js` | 64/77 | 64/77 | 15/31 | 17/33 |
| `scripts/lib/project-agent-host-binding-policy.js` | 35/240 | 35/240 | 1/1 | 1/1 |
| `scripts/lib/project-agent-projection-plan.js` | 146/647 | 146/647 | 15/46 | 15/46 |
| `scripts/lib/project-agent-provider-adapters.js` | 102/483 | 102/483 | 1/1 | 1/1 |
| `scripts/lib/skill-purpose-decisions.js` | 420/486 | 420/486 | 93/177 | 93/177 |
| `scripts/lib/skill-resource-sync.js` | 1074/1172 | 1074/1172 | 251/349 | 249/347 |
| `scripts/lib/skill-routing-projection.js` | 165/201 | 165/201 | 24/55 | 24/55 |
| `scripts/lib/skill-topology.js` | 214/281 | 214/281 | 24/65 | 24/65 |
| `scripts/lib/skill-usage.js` | 843/940 | 843/940 | 211/308 | 207/304 |
| `skills/flow-guide/scripts/_lib/runtime-loader.js` | 42/52 | 42/52 | 6/10 | 6/10 |
| `skills/flow-guide/scripts/_lib/skill-usage.js` | 552/940 | 552/940 | 78/152 | 78/152 |
| `skills/flow-guide/scripts/usage-card.js` | 211/316 | 211/316 | 34/69 | 34/69 |
| `skills/laravel/scripts/resolve-version.js` | 37/44 | 37/44 | 8/10 | 8/10 |
| `skills/laravel/scripts/version-resolver.js` | 213/276 | 213/276 | 46/72 | 46/72 |
| `skills/phpunit/scripts/resolve-version.js` | 30/54 | 30/54 | 3/8 | 3/8 |
| `skills/phpunit/scripts/version-resolver.js` | 183/195 | 183/195 | 41/70 | 41/70 |

All 34 files have unchanged line coverage or an improvement. The only raw c8
branch decreases are `skill-resource-sync.js` (251/349 to 249/347; 71.92% to
71.76%) and `skill-usage.js` (211/308 to 207/304; 68.51% to 68.09%). Both are
unrelated V8 range-map drift: every production source file is byte-identical
to the baseline, and a coordinate comparison of the 2,932 branch locations
present on both sides found no previously covered common arm becoming
uncovered. In `skill-resource-sync.js`, c8 no longer emits the two broad
enclosing ranges at lines 685–694 and 1008–1029; the narrower child ranges
remain covered and the existing uncovered arm remains uncovered. In
`skill-usage.js`, four overlapping enclosing ranges at lines 427–476 are
omitted, while their child ranges remain. Raw c8 counts and percentages are
reported without normalization; this is instrumentation mapping drift rather
than an assertion or production-path loss.

The generated marketplace package is regenerated from this ledger in a clean
tracked-source snapshot and checked with
`node scripts/ci/gen-claude-marketplace-package.js --check` before delivery.

### Issue #789 — F10 distribution inventory consolidation

F10 only; F11–F17 and F29 remain open. Clean baseline:
`10a48f7589db09530d785e7a6f56365c8101ec66` on `develop`.
Production implementations are unchanged. The catalog now assigns
`internal-runtime-skills.js` to `distribution-inventory-validate.test.js`.

#### Dispositions and names

| Source suite | Tests | Checklist disposition | Collected owner |
| --- | --- | --- | --- |
| `distribution-scoped-counts` | 8 | 5 KEEP, 2 REWRITE, 1 DELETE | `distribution-inventory-validate` |
| `distribution-projection-inventory` | 3 | KEEP unchanged | `distribution-inventory-validate` |
| `internal-cli-transport-inventory` | 1 | KEEP unchanged | `distribution-inventory-validate` |
| `internal-runtime-skills` | 2 | KEEP unchanged | `distribution-inventory-validate` |
| `harness-platform-matrix` | 5 | KEEP unchanged, including its earlier #639 rewrite | `distribution-inventory-validate` |

Each source is one labeled owner block; its source file is deleted. Existing
31 owner tests are unchanged. Suite count: 365 to 360. Name multisets:
50 baseline names, exactly 49 final names after excluding only
`canonical count never silently equals a scoped count when they truly differ (regression guard against count aliasing)`.
That redundant assertion is completely owned by the collected literal
canonical/promoted-core, Claude-published and Codex-published count tests.
Their stronger literal expectations are retained.

The Claude structural verification test retains its name but now pins literal
IDs `['a', 'b', 'c', 'd']` and count `4`, replacing a shared-helper oracle.
The README test retains its name but derives the forbidden count independently
from manifest `skills.length`, rather than the production count helper.
Remaining moved assertions retain observable contracts and negative paths.
The 952-line owner is a scoped exception to the usual 800-line limit because
F10 requires these five named blocks in the existing owner; no timeout hint
or new suite is added.

#### Mutation evidence

Both mutations used a disposable tracked-source copy, never this checkout's
production files. Omitting fixture `c` from `generateClaudeSkillRoots` invokable
selection makes `Claude-published count is the same inventory-derived set used by structural verification`
RED (47/49, with its literal count guard also failing); restoring returns 49/49.
Appending `84 skills are installed by default.` to disposable `README.md`
makes `neither bilingual README claims the canonical skill total as a default-install count (task 4.2 regression guard)`
RED (48/49); restoring returns 49/49. Run the merged owner after the controlled
defect and again after restoration.

Raw evidence is retained under `/tmp/dhpk-issue789-f10`: mutation logs
`claude-mutation-{red,green}.log`, `readme-mutation-{red,green}.log`, the disposable
`mutation-tree`, baseline/final name lists, and `test-name-comparison.json`.

#### Fresh timing and coverage

Node v26.9.0, Linux, c8 10.1.3, jobs=4, fresh reports. Baseline per-file timings
(owner, scoped counts, projection inventory, CLI inventory, runtime skills,
platform matrix): 113, 91, 100, 89, 59, 107 ms, sum 559 ms. Final owner:
114 ms, below the default 180,000 ms budget. Instrumented wall time:
313 ms before, 165 ms after. These focused results do not claim full-suite or
CI shard speed improvements.

Reproduce on the recorded baseline and final revision respectively, with fresh
report directories (the cached c8 path is specific to this environment):

```bash
DHPK_TEST_TIMING_FILE=/tmp/dhpk-issue789-f10/parent-baseline/timing.json \
  node /home/paul/.npm/_npx/1d50dde519b2be3f/node_modules/c8/bin/c8.js \
  --reports-dir /tmp/dhpk-issue789-f10/parent-baseline/coverage \
  --reporter json --reporter json-summary node tests/run-all.js --jobs 4 \
  tests/distribution-inventory-validate.test.js \
  tests/distribution-scoped-counts.test.js \
  tests/distribution-projection-inventory.test.js \
  tests/internal-cli-transport-inventory.test.js \
  tests/internal-runtime-skills.test.js tests/harness-platform-matrix.test.js
DHPK_TEST_TIMING_FILE=/tmp/dhpk-issue789-f10/parent-after-timing.json \
  node /home/paul/.npm/_npx/1d50dde519b2be3f/node_modules/c8/bin/c8.js \
  --reports-dir /tmp/dhpk-issue789-f10/parent-after-coverage \
  --reporter json --reporter json-summary node tests/run-all.js --jobs 4 \
  tests/distribution-inventory-validate.test.js
```

All 18 affected canonical dependencies, covered/total without normalization:

| Production file | Before lines | After lines | Before branches | After branches |
| --- | --- | --- | --- | --- |
| `scripts/ci/_lib/frontmatter.js` | 37/129 | 37/129 | 1/1 | 1/1 |
| `scripts/lib/agy-path-contract.js` | 55/97 | 55/97 | 4/14 | 4/14 |
| `scripts/lib/asset-inventory.js` | 45/201 | 45/201 | 1/1 | 1/1 |
| `scripts/lib/bounded-child-process.js` | 36/50 | 36/50 | 2/8 | 2/8 |
| `scripts/lib/bounded-filesystem.js` | 23/169 | 23/169 | 1/1 | 1/1 |
| `scripts/lib/distribution-compiler.js` | 103/494 | 103/494 | 3/29 | 3/29 |
| `scripts/lib/distribution-inventory-regeneration.js` | 13/40 | 13/40 | 1/1 | 1/1 |
| `scripts/lib/distribution-inventory.js` | 1918/2518 | 1918/2518 | 555/882 | 553/880 |
| `scripts/lib/distribution-projection-contract.js` | 337/585 | 337/585 | 43/132 | 42/131 |
| `scripts/lib/distribution-projection-parity.js` | 117/461 | 117/461 | 8/26 | 8/26 |
| `scripts/lib/harness-surfaces.js` | 25/25 | 25/25 | 1/1 | 1/1 |
| `scripts/lib/internal-runtime-skills.js` | 68/77 | 68/77 | 23/35 | 25/37 |
| `scripts/lib/project-agent-host-binding-policy.js` | 35/240 | 35/240 | 1/1 | 1/1 |
| `scripts/lib/project-agent-projection-plan.js` | 146/647 | 146/647 | 15/46 | 15/46 |
| `scripts/lib/project-agent-provider-adapters.js` | 102/483 | 102/483 | 1/1 | 1/1 |
| `scripts/lib/skill-routing-projection.js` | 89/201 | 89/201 | 11/18 | 11/18 |
| `scripts/lib/skill-topology.js` | 26/281 | 26/281 | 1/1 | 1/1 |
| `scripts/lib/skill-usage.js` | 531/940 | 531/940 | 96/164 | 95/163 |

All covered line counts are identical. Raw branch percentages decrease for
`distribution-inventory.js` (62.92% to 62.84%),
`distribution-projection-contract.js` (32.57% to 32.06%), and
`skill-usage.js` (58.53% to 58.28%). The literal raw-percentage non-decrease
criterion is not reported as PASS. Coordinate-level evidence classifies this
as unrelated V8 instrumentation range drift: the four varying production
scripts have identical baseline/final Git blobs, 1,334 common branch coordinates
retain the same 740 covered arms, and zero covered arms become uncovered.
All 28 removed ranges and 26 added ranges are covered. In the platform matrix,
one broad covered range at 1823–1867 is replaced by two covered ranges; covered
ranges at projection-contract 54–55 and skill-usage 573–574 disappear from the
final range map. Full coordinates and comparison code remain in
`branch-coordinate-audit.json` and `branch-coordinate-audit.cjs` in the evidence
folder, alongside both fresh `coverage-final.json` reports.

Safety coordinate comparison: platform matrix 25 covered among 42 common arms,
required surface plan 5 among 13, internal runtime validation 8 among 10, all
unchanged. This preserves existing negative paths; it does not claim complete
baseline branch coverage for those functions.

#### Integration evidence boundary

Catalog `--check all`, plugin validator, harness validator, and focused final
owner pass. Upstream impact for `validatePlatformCapabilityMatrix` is HIGH:
34 symbols, `phaseExecution` and `dispatch`, with a callable-value boundary;
surfaced before edits, production behavior preserved. Current GitNexus change
analysis returns all 35 changed symbols with LOW risk, no partial/truncated
marker; zero mapped processes is not used as proof of no effect.

Marketplace copies are regenerated from a tracked-source snapshot carrying
this diff, then checked with `gen-claude-marketplace-package.js --check`.
Review Gate, clean-checkout full tests, and PR CI are separate delivery gates.
The other batches of #789 and the integrated verdict of #743 remain incomplete.

### Issue #789 completed family consolidation

Baseline: `0e55d7529ce3d3552a5a5e0c22d146fc35599d04`. Fresh c8 10.1.3 reports with Node v26.9.0, `--jobs 4`, capture all affected owners and sources before moving them. The after run uses a clean tracked-source snapshot of the pending tree, so projection provenance checks see a clean checkout.

Focused suites: 24 → 9; collected cases 245 → 242; wall time 4326 → 6738 ms. These are focused measurements, separate from the full-suite and CI evidence.

#### Source dispositions

- F11: `tests/distribution-projection-contract.test.js` collects `tests/distribution-compiler.test.js`, `tests/distribution-projection-parity.test.js`, `tests/distribution-rollback-proof.test.js`, `tests/distribution-selection-plan-binding.test.js`, `tests/projection-usage-binding.test.js`.
- F12: `tests/validate-agents-behavior.test.js` collects `tests/validate-agents-skills.test.js`.
- F13: `tests/validate-skills.test.js` collects `tests/validate-skills-size.test.js`.
- F14: `tests/validate-plugin.test.js` collects `tests/validate-commands.test.js`, `tests/validate-modules.test.js`.
- F15: `tests/gen-cursor-sync.test.js` collects `tests/cursor-sync-package.test.js`, `tests/validate-cursor-sync.test.js`.
- F16: `tests/validate-references.test.js` collects `tests/reference-integrity.test.js`.
- F17: `tests/changelog-fragments.test.js` collects `tests/validate-changelog-fragments-cli.test.js`, `tests/current-changelog.test.js`.
- F29: `tests/gen-claude-manifest.test.js` collects `tests/gen-claude-manifest-generate.test.js`.

The detailed KEEP, REWRITE, and DELETE decisions and controlled mutation evidence follow. Source test names are retained except the explicitly documented deletions. No production public behavior is changed.

##### WRITER A: Issue #789 F11 — Writer A, attempt 1

##### WRITER A: Scope and decision

- Decision: CLEAR; the F11 packet fixed the owner file, the five source suites, the permitted duplicate deletion, and the seven required rewrites.
- Goal: consolidate the distribution projection test suites without changing production behavior.
- Non-goals: catalog, documentation, generated outputs, Git changes, production source edits, or changes outside the six assigned test paths.
- Branch: `feature/issue-789-test-consolidation` (provided task context).
- Baseline: parent reported 24 focused files PASS. This worker did not rerun that batch.
- Rules read: root `AGENTS.md`, `rules/execution-policy-kernel.md`, `rules/execution-policy.md`, and `skills/tdd-workflow/tests.md` / “Rejection Checklist”.
- The read-only reasoner provided the F11 packet and upstream impact findings before this write. Compiler impact was MEDIUM/53 and parity impact MEDIUM/33; UNKNOWN symbol lookups were checked against text references per the packet.

##### WRITER A: Owned repository paths

- Modified: `tests/distribution-projection-contract.test.js` — now 1,240 lines; the F11 >800-line exception applies. All moved assertions are inside labeled lexical blocks and the file has one `tinytest` `run()` call.
- Deleted after moving: `tests/distribution-compiler.test.js`, `tests/distribution-projection-parity.test.js`, `tests/distribution-rollback-proof.test.js`, `tests/distribution-selection-plan-binding.test.js`, `tests/projection-usage-binding.test.js`.

The moved suites contributed 20 names. Final owner has 39 tests: the original 20 plus 19 moved names. The only removed registered name is the approved duplicate below.

##### WRITER A: Exact source-suite names and dispositions

| Original suite | Registered test name | Disposition and evidence |
| --- | --- | --- |
| `distribution-compiler.test.js` | `compiler creates a plan, materializes it, and verifies a consumer stage` | REWRITE. Expected output fields are independent literals; the consumer verdict checks stage, plan identity, emitted stable ID, destination, and content, and rejects tampered content. Mutation m01 produced the named RED; restored owner run was 39/39. |
| `distribution-compiler.test.js` | `compiler carries external ownership provenance through artifact and evidence` | REWRITE. Pins the ownership fingerprint literal `24a0603c6b49c2acebe6352318303253790c9010f39db9b4a93d6da154013b70` and checks plan → artifact → evidence propagation with actual emitted output. Mutation m02 removed artifact propagation and produced the named RED; restored owner run was 39/39. |
| `distribution-projection-parity.test.js` | `projection parity emits canonical structural evidence for equivalent declared inputs` | REWRITE. Equivalent projections require zero mismatches/diagnostics; source fingerprint drift must return FAIL with a source fingerprint mismatch. Mutation m03 omitted that comparison and produced the named RED; restored owner run was 39/39. |
| `distribution-projection-parity.test.js` | `projection parity rejects an output fingerprint drift without reading budget state` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-projection-parity.test.js` | `projection parity rejects duplicate stable IDs and unsupported runtime stages` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-projection-parity.test.js` | `projection parity binds outer surface and profile labels to their compiler plan` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-projection-parity.test.js` | `projection parity rejects external ownership ledger drift and records provenance` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-projection-parity.test.js` | `projection parity rejects a stale ownership fingerprint between a plan and its artifact` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-rollback-proof.test.js` | `the prior inventory revision regenerates exactly the currently-committed plugin.json roots` | DELETE. Duplicate real-inventory roots contract is retained by `tests/gen-claude-manifest-generate.test.js:74` (F29 owner supplied by the packet). |
| `distribution-rollback-proof.test.js` | `the later (deprecated) inventory revision drops the skill from promotion without removing the flat root` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-rollback-proof.test.js` | `rollback: regenerating from the prior revision again reproduces the original root set, without any canonical source having been touched` | REWRITE. Captures canonical `SKILL.md` bytes before generation and compares them after prior/later generation and rollback. Mutation m04 appended a newline to the canonical Markdown source in the disposable copy and produced the named RED; restored owner run was 39/39. |
| `distribution-rollback-proof.test.js` | `failed Claude inventory reconciliation retains the previously accepted generated view` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-rollback-proof.test.js` | `failed Agent Plugin staging retains the previously accepted package tree` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-rollback-proof.test.js` | `failed Codex native staging retains the previously accepted package tree and diagnostic cause` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-rollback-proof.test.js` | `failed Cursor staging retains the previously accepted package tree and executable modes` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `distribution-selection-plan-binding.test.js` | `all migrated adapters retain compiler canonical selection identity in output plans` | REWRITE. Expected IDs are derived directly from inventory membership and skill/module surfaces plus lifecycle filtering; selection policy is checked against the inventory declaration and output intent remains asserted. Mutation m05 dropped Agent Plugin selected IDs and produced the named RED; restored owner run was 39/39. |
| `projection-usage-binding.test.js` | `distribution plans carry normalized usage and usage fingerprint for emitted skills` | REWRITE. Replaces the imported schema/helper expectations with literal schema, usage fingerprint, inventory revision, and visible usage values. Mutation m06 changed the schema version and produced the named RED; restored owner run was 39/39. |
| `projection-usage-binding.test.js` | `usage mutation changes the compiler selection and plan identities` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `projection-usage-binding.test.js` | `materialization rejects adapter usage metadata that differs from the accepted plan` | KEEP; assertion moved unchanged and passed in the 39/39 owner run. |
| `projection-usage-binding.test.js` | `projection parity reports usage independently from provenance` | REWRITE. Requires a usage fingerprint mismatch and no provenance mismatch when only usage changes; removes incidental `checkedFieldGroups` assertions. Mutation m07 omitted usage fields from comparison and produced the named RED; restored owner run was 39/39. |

Disposition totals for the 20 source names: KEEP 12, REWRITE 7, DELETE 1.

##### WRITER A: Verification evidence

- `node --check tests/distribution-projection-contract.test.js` — PASS (exit 0).
- `node tests/distribution-projection-contract.test.js` in the repository — PASS, 39/39.
- The same owner command in the disposable checkout before mutations — PASS, 39/39.
- Seven controlled mutations were made only under `/tmp/dhpk-consolidation/789/mutation-root`; each affected the exact named test, then its source and canonical fixture were restored and the owner suite returned 39/39:
  - m01 — consumer verifier receives an artifact with its outputs removed; RED: `compiler creates a plan, materializes it, and verifies a consumer stage`.
  - m02 — remove compiler propagation of `externalSkillPackagesFingerprint` into the artifact; RED: `compiler carries external ownership provenance through artifact and evidence`.
  - m03 — omit `sourceFingerprint` from plan and artifact parity field lists; RED: `projection parity emits canonical structural evidence for equivalent declared inputs`.
  - m04 — append a newline to `skills/dhpk-fastapi-pro/SKILL.md` on inventory generation; RED: `rollback: regenerating from the prior revision again reproduces the original root set, without any canonical source having been touched`.
  - m05 — make the Agent Plugin adapter pass an empty `selectedStableIds`; RED: `all migrated adapters retain compiler canonical selection identity in output plans`.
  - m06 — change the usage schema literal from v1 to v2; RED: `distribution plans carry normalized usage and usage fingerprint for emitted skills`.
  - m07 — omit usage fields from plan and artifact parity comparisons; RED: `projection parity reports usage independently from provenance`.
- Mutation logs: `/tmp/dhpk-consolidation/789/logs/m01-compiler-observes-published-output-red.log` through `m07-parity-reports-usage-separately-red.log`, with corresponding `*-restored-green.log` files.
- Post-mutation byte comparison confirmed the five production modules used by mutations and the canonical fastapi source match their pristine disposable-copy snapshots. The controlled mutations did not alter production scripts or canonical skill source.
- A final repository focused run after the mutation work again passed 39/39.
- All five source test paths are absent; owner has one `run()` call.

##### WRITER A: Not run / scope boundary

- The parent-provided 24-file baseline was not repeated by this worker.
- Full aggregate suite and `node scripts/ci/catalog.js --check` were not run; the packet explicitly excludes catalog work and requests the focused owner suite. Parent shared gate can resume with `node tests/run-all.js` if aggregate verification is required.
- No unresolved failure or blocker remains within F11.

##### WRITER B: Issue #789 writer B evidence

##### WRITER B: Identity and decision

- Task: `issue789-f12-f13-f14-f16`
- Attempt: `issue789-f12-f13-f14-f16-writer-b-20260930-01`
- Branch: `feature/issue-789-test-consolidation`
- Baseline: `0e55d7529ce3d3552a5a5e0c22d146fc35599d04`; parent supplied `PASS` baseline evidence.
- Decision: `CLEAR`; applied the settled packet from `/root/issue789_reasoner`.
- Impact note: the CLI impact result was `UNKNOWN` with zero resolved callers. Per the repository rule, this was not treated as an all-clear. Text confirmation found `tests/run-all.js` recursively discovers `*.test.js` at `tests/run-all.js:459`; `rg` found no runner/CI path references to the deleted suites. Remaining repo references are in the baseline/review inventory documents owned by the parent and the moved-suite labels in the owners.

##### WRITER B: Exact owned files

Changed only these assigned test paths:

- Owners: `tests/validate-agents-behavior.test.js`, `tests/validate-skills.test.js`, `tests/validate-plugin.test.js`, `tests/validate-references.test.js`.
- Deleted source suites: `tests/validate-agents-skills.test.js`, `tests/validate-skills-size.test.js`, `tests/validate-commands.test.js`, `tests/validate-modules.test.js`, `tests/reference-integrity.test.js`.

No catalog, documentation, generated, or production source files were edited. The shared worktree also contains parent/sibling changes; they were preserved.

##### WRITER B: Source case dispositions

Source cases total **46: 42 KEEP, 3 REWRITE, 1 DELETE**. Moved source cases are grouped in labeled lexical blocks; each owner has one final `run()` call.

##### WRITER B: F12 — `validate-agents-skills.test.js` → `validate-agents-behavior.test.js`

- REWRITE `validate-agents-skills CLI reports structural PASS and runtime boundary`: after initial PASS, remove `<outDir>/.dhpk-projection.json`; assert validator exit 1 and `projection receipt is missing`; clean and regenerate; assert PASS.
- REWRITE `validate-agents-skills CLI validates an external project receipt`: after initial PASS, remove `<projectRoot>/.agents/.dhpk-installed.json`; assert validator exit 1 with missing lifecycle receipt; clean disposable generated roots and regenerate; assert PASS.

##### WRITER B: F13 — `validate-skills-size.test.js` → `validate-skills.test.js`

All KEEP:

- `warns above 150 lines and fails an unallowlisted file above 250`
- `allows only seeded exceptions at or below their shrink-only baseline`
- `fails allowlist growth and a delisted file regression`
- `discovers module-owned skills as well as top-level skills`
- `counts the final logical line when SKILL.md has no trailing newline`
- `strict mode accepts the 150-line boundary and rejects warning-budget overflow`

##### WRITER B: F14 — `validate-commands.test.js`, `validate-modules.test.js` → `validate-plugin.test.js`

`validate-commands.test.js` KEEP:

- `real repo commands/ pass validation`
- `no commands/ directory — exits 0 (skip)`
- `a command file with no frontmatter fails`
- `a command file with empty description fails`
- `duplicate frontmatter keys fail`
- `INDEX.md is skipped even when malformed`
- `a well-formed command file passes`
- `canonical commands retire the approved aliases and retain supported adapters`
- `flow-guide routing, flow-drive implementation, and setup installation have deterministic executable contracts`
- `review and prompt skills state the Task 4 evidence and scope boundaries`

`validate-commands.test.js` REWRITE:

- `invocation inventory baseline distinguishes retired aliases from retained forwarding aliases`: no longer asserts historical count 44 or fixture-only `zh-tw`; checks historical alias identifiers against the live retired `do`/`zh-tw` files and six live forwarding aliases, including `explicit-only` metadata and forwarding text. Disposable mutations adding valid `commands/do.md` and removing `install-hooks` explicit-only metadata are both detected.

`validate-commands.test.js` DELETE:

- `retired /dhpk:do command has no forwarding adapter`: removed as duplicate/low-signal coverage; the canonical alias test already asserts `commands/do.md` is absent.

`validate-modules.test.js` all KEEP:

- `real repo modules/ pass validation`
- `no modules/ directory — exits 0 (skip)`
- `module directory missing module.yaml fails`
- `name mismatched with directory fails`
- `requires[] pointing at a non-existent module fails`
- `requires[] pointing at an existing module passes`
- `missing version/description warn but do not fail (non-strict)`
- `missing version/description fail under --strict`
- `provides.skills entry with no resolvable SKILL.md warns`
- `module with no triggers and no provided skills warns (no-op module)`

##### WRITER B: F16 — `reference-integrity.test.js` → `validate-references.test.js`

All KEEP:

- `real tree has zero reference-integrity findings`
- `check 1 flags a dangling @rules ref`
- `check 2 flags an unresolvable /dhpk command ref`
- `check 3 flags a dangling ${CLAUDE_PLUGIN_ROOT} path ref`
- `check 4 flags a predecessor-brand string`
- `check 5 flags a bare execution-policy.md reference without the plugin-root fallback`
- `check 5 does not flag a dual-path fallback block`
- `check 5 does not require dual-path fallback in rules/execution-policy.md`
- `check 5 flags reintroduced legacy fallback wording in rules/execution-policy.md`
- `check 5 does not require dual-path fallback in skills/dhpk-opsx-apply-goal/references/execution-bundle/rules/execution-policy.md`
- `check 5 flags reintroduced legacy fallback wording in skills/dhpk-opsx-apply-goal/references/execution-bundle/rules/execution-policy.md`
- `check 5 does not require dual-path fallback in skills/flow-drive/references/execution-bundle/rules/execution-policy.md`
- `check 5 flags reintroduced legacy fallback wording in skills/flow-drive/references/execution-bundle/rules/execution-policy.md`
- `check 5 does not require dual-path fallback in skills/flow-guide/references/execution-bundle/rules/execution-policy.md`
- `check 5 flags reintroduced legacy fallback wording in skills/flow-guide/references/execution-bundle/rules/execution-policy.md`
- `resolvable and intentional refs are not flagged`

##### WRITER B: Verification

- PASS: `node tests/run-all.js --jobs 4 tests/validate-agents-behavior.test.js tests/validate-skills.test.js tests/validate-plugin.test.js tests/validate-references.test.js` — 4/4 files, 91/91 cases. Re-run after mutation restoration: `/tmp/dhpk-consolidation/789/writer-b-restore-green.log`.
- PASS: `git diff --check -- <the nine owned test paths>` — no whitespace errors.
- PASS: `node --check` was run on all four owners before the final focused suite; the focused suite parsed and executed the final edits.
- PASS: actual receipt-removal observations and clean regeneration PASS are recorded in `/tmp/dhpk-consolidation/789/writer-b-receipt-mutation.log`.
- PASS: controlled defect mutations make the exact rewritten tests RED, then the live owners were rerun GREEN:
  - F12 validator mutation forces invalid projection results to exit 0; both receipt tests fail by exact name. `/tmp/dhpk-consolidation/789/writer-b-f12-defect-red.log`.
  - F14 valid `commands/do.md` mutation fails the rewritten alias test by exact name. `/tmp/dhpk-consolidation/789/writer-b-f14-mutation-1-red.log`.
  - F14 missing `install-hooks` explicit-only metadata mutation fails the same exact test by exact name. `/tmp/dhpk-consolidation/789/writer-b-f14-mutation-2-red.log`.
  - Repro command from repository root: `node /tmp/dhpk-consolidation/789/writer-b-mutation-repro.js`. All mutations run in disposable copies and are cleaned up.
- NOT RUN: full repository suite; parent supplied the pre-edit baseline PASS and is coordinating aggregate coverage/validation.

##### WRITER B: Judgment calls and remaining scope

- The project-root validator classifies a generated projection without `.agents/.dhpk-installed.json` as legacy-unbound because the generated legacy manifest remains. The test asserts exit 1 and the missing lifecycle receipt diagnostic; it removes only generated trees inside its disposable temp root before fresh regeneration.
- The F14 test uses `DHPK_789_COMMANDS_DIR` only as an optional live-tree root for controlled mutation runs. Normal execution defaults to the actual repository `commands/` directory.
- Parent owns reconciliation of stale suite paths in `docs/test-consolidation-baseline.csv`, `docs/test-suite-quality-review.md`, and `docs/test-suite-review-inventory.csv`.
- No commit, push, PR, generated projection, or release action was performed.

##### WRITER C: Issue #789 — Writer C (F15, F17, F29)

Attempt: `feature/issue-789-test-consolidation`, writer C, 2026-09-30.
Owned families and paths were taken from `/tmp/dhpk-consolidation/789/context.json`.

##### WRITER C: Result

Consolidated the retained source cases into one named lexical block per source
suite inside each family owner. Each owner invokes tinytest once. Removed the
five source files after moving their retained cases. No production code,
catalog, documentation, generated files, or Git metadata were changed by this
writer.

Modified owners:

- `tests/gen-cursor-sync.test.js`
- `tests/changelog-fragments.test.js`
- `tests/gen-claude-manifest.test.js`

Deleted sources:

- `tests/cursor-sync-package.test.js`
- `tests/validate-cursor-sync.test.js`
- `tests/validate-changelog-fragments-cli.test.js`
- `tests/current-changelog.test.js`
- `tests/gen-claude-manifest-generate.test.js`

##### WRITER C: Case dispositions

##### WRITER C: F15 — `tests/gen-cursor-sync.test.js`

Kept from `cursor-sync-package.test.js`:

- `missing cursor-sync membership falls back to agent-plugin skills`
- `cursor-sync validator rejects a missing skills tree and native hooks.json`
- `cursor-sync generator refuses output that overlaps canonical source trees`

Deleted `declared empty cursor-sync membership does not fall back to agent-plugin`.
The existing owner case `declared empty cursor-sync membership does not fall
back to agent-plugin skills` exercises materialization and asserts both zero
selected skills and an empty output skills directory, so it owns the stronger
output contract.

Kept from `validate-cursor-sync.test.js`:

- `checked-in cursor tree has a dedicated passing validator CLI contract`

##### WRITER C: F17 — `tests/changelog-fragments.test.js`

Kept all 13 cases from `validate-changelog-fragments-cli.test.js`:

- `check mode passes on an empty fragment directory`
- `check mode fails on an invalid fragment`
- `--diff-base fails when a user-visible file changed with no fragment`
- `--diff-base passes when a fragment covers the change`
- `--diff-base passes on a release-shaped diff: promoted section, no pending fragment`
- `--diff-base gives no exemption on a non-release base even when heading and manifest agree`
- `--diff-base gives no exemption when the base ref is unknown (fails closed)`
- `--diff-base still fails when an existing release heading is only reworded`
- `--diff-base still fails when a new section is hand-added without the manifest bump`
- `--diff-base still fails when CHANGELOG.md changed without adding a release section`
- `--write promotes fragments into CHANGELOG.md`
- `--diff-base passes for a bot-authored workflow change without a fragment`
- `--diff-base still fails for a human-authored workflow change without a fragment`

Kept from `current-changelog.test.js`:

- `current release has one changelog section`

The current-changelog case was checked with a duplicate-heading mutation in a
disposable copy of the consolidated owner. The mutated suite failed 35/36, with
the retained case reporting two current-version headings instead of one.

##### WRITER C: F29 — `tests/gen-claude-manifest.test.js`

Kept all six cases from `gen-claude-manifest-generate.test.js`:

- `promoted-core root skill stays registered under ./skills/`
- `optional module skill stays registered under its module root`
- `experimental skill still stays registered (host cannot hide at discovery time)`
- `a deprecated skill is excluded from generatedSkillIds`
- `a module root drops out only when every one of its skills is deprecated`
- `against the real checked-in inventory, generated roots equal the current plugin.json skills[] set (nothing is deprecated yet)`

The real-inventory/plugin-roots assertion remains in the owner as its collected
contract, including the check needed to justify the separate F11 duplicate-case
disposition.

##### WRITER C: Graph note

The reasoner packet recorded `cursor-sync-package` as LOW with three impacts and
the validator CLI as UNKNOWN with zero resolved callers; literal search found no
explicit references to the five source test paths in `tests/`, `scripts/`, or
`.github/`. Test discovery is dynamic through `tests/run-all.js`.

Local GitNexus file-target calls were inconsistent: one batched result reported
CRITICAL/975 for `tests/validate-cursor-sync.test.js` (four direct, 148 process,
20 module counts); serial exact-file reruns reported UNKNOWN, including a
lower-bound result with two callable-value references. This remains an analyzer
uncertainty and is surfaced to the parent; no alternate risk axis was used to
waive the CRITICAL result.

##### WRITER C: Verification

Pre-edit focused baseline:

- `node tests/gen-cursor-sync.test.js` — PASS, 14/14
- `node tests/cursor-sync-package.test.js` — PASS, 4/4
- `node tests/validate-cursor-sync.test.js` — PASS, 1/1
- `node tests/changelog-fragments.test.js` — PASS, 22/22
- `node tests/validate-changelog-fragments-cli.test.js` — PASS, 13/13
- `node tests/current-changelog.test.js` — PASS, 1/1
- `node tests/gen-claude-manifest.test.js` — PASS, 3/3
- `node tests/gen-claude-manifest-generate.test.js` — PASS, 6/6

Post-edit focused verification:

- `node --check tests/gen-cursor-sync.test.js && node --check tests/changelog-fragments.test.js && node --check tests/gen-claude-manifest.test.js` — PASS
- `node tests/gen-cursor-sync.test.js` — PASS, 18/18
- `node tests/changelog-fragments.test.js` — PASS, 36/36
- `node tests/gen-claude-manifest.test.js` — PASS, 9/9
- Baseline-to-owner test-name multiset check — PASS: F15 19 source/owner cases
  to 18 expected (one approved deletion); F17 36 to 36; F29 9 to 9.
- Duplicate-current-heading mutation in a disposable consolidated-owner copy —
  expected RED, exit 1: 35/36 passed and the retained assertion found 2 headings.
- `git diff --check -- <eight owned paths>` — PASS.
- `rg` literal source-path reference check — no explicit references found.

The parent supplied a full baseline PASS. This writer did not rerun the full
repository suite.

##### WRITER C: NOT RUN

- Fresh combined coverage/full-suite run — NOT RUN because the parent requested
  it after all sibling source deletions finish. Resume command:
  `node tests/run-all.js --coverage`.
- Review/release gates remain with the parent flow.

#### Registration reconciliation

Removed registration names:

- `the prior inventory revision regenerates exactly the currently-committed plugin.json roots`
- `retired /dhpk:do command has no forwarding adapter`
- `declared empty cursor-sync membership does not fall back to agent-plugin`

Added registration names:

- None.

#### Per-file focused timing

| File | Before ms | After ms |
| --- | --- | --- |
| `tests/distribution-inventory-validate.test.js` | 175 | 147 |
| `tests/distribution-projection-contract.test.js` | 148 | 677 |
| `tests/distribution-compiler.test.js` | 65 | merged |
| `tests/distribution-projection-parity.test.js` | 71 | merged |
| `tests/distribution-rollback-proof.test.js` | 187 | merged |
| `tests/distribution-selection-plan-binding.test.js` | 658 | merged |
| `tests/projection-usage-binding.test.js` | 77 | merged |
| `tests/validate-agents-behavior.test.js` | 2484 | 4041 |
| `tests/validate-agents-skills.test.js` | 1112 | merged |
| `tests/validate-skills.test.js` | 600 | 1290 |
| `tests/validate-skills-size.test.js` | 571 | merged |
| `tests/validate-plugin.test.js` | 1362 | 2211 |
| `tests/validate-commands.test.js` | 442 | merged |
| `tests/validate-modules.test.js` | 765 | merged |
| `tests/gen-cursor-sync.test.js` | 670 | 736 |
| `tests/cursor-sync-package.test.js` | 66 | merged |
| `tests/validate-cursor-sync.test.js` | 139 | merged |
| `tests/validate-references.test.js` | 360 | 428 |
| `tests/reference-integrity.test.js` | 114 | merged |
| `tests/changelog-fragments.test.js` | 74 | 1195 |
| `tests/validate-changelog-fragments-cli.test.js` | 1593 | merged |
| `tests/current-changelog.test.js` | 47 | merged |
| `tests/gen-claude-manifest.test.js` | 338 | 332 |
| `tests/gen-claude-manifest-generate.test.js` | 60 | merged |

All collected owners remain below the default 180 s budget. No `TIMEOUT_HINTS` entry is added.

#### Canonical production coverage

Covered/total counts below are raw fresh-report values. Branch range coordinates are independently compared; a raw drop is never described as raw non-decrease PASS.

| Production file | Before lines | After lines | Before branches | After branches |
| --- | --- | --- | --- | --- |
| `scripts/ci/_lib/codex-runtime.js` | 535/756 | 535/756 | 131/233 | 131/233 |
| `scripts/ci/_lib/frontmatter.js` | 84/129 | 84/129 | 16/18 | 16/18 |
| `scripts/ci/_lib/report.js` | 51/51 | 51/51 | 14/16 | 14/16 |
| `scripts/ci/gen-agents-skills.js` | 63/81 | 63/81 | 25/32 | 25/32 |
| `scripts/ci/gen-cursor-sync.js` | 39/46 | 39/46 | 4/10 | 4/10 |
| `scripts/ci/reconcile-skill-mirrors.js` | 108/140 | 108/140 | 29/48 | 29/48 |
| `scripts/ci/validate-agents-skills.js` | 44/52 | 47/52 | 17/22 | 19/23 |
| `scripts/ci/validate-agents.js` | 106/121 | 106/121 | 29/39 | 29/39 |
| `scripts/ci/validate-changelog-fragments.js` | 161/179 | 161/179 | 40/48 | 40/48 |
| `scripts/ci/validate-commands.js` | 38/46 | 38/46 | 5/10 | 5/10 |
| `scripts/ci/validate-cursor-sync.js` | 21/24 | 21/24 | 1/3 | 1/3 |
| `scripts/ci/validate-modules.js` | 79/89 | 79/89 | 13/25 | 13/25 |
| `scripts/ci/validate-plugin.js` | 130/166 | 130/166 | 26/53 | 26/53 |
| `scripts/ci/validate-references.js` | 328/343 | 328/343 | 97/107 | 97/107 |
| `scripts/ci/validate-skills.js` | 93/127 | 93/127 | 18/36 | 18/36 |
| `scripts/lib/agent-plugin-package.js` | 972/1308 | 972/1308 | 219/382 | 217/380 |
| `scripts/lib/agents-skills-package.js` | 598/847 | 601/847 | 128/222 | 132/224 |
| `scripts/lib/agy-path-contract.js` | 55/97 | 55/97 | 4/14 | 4/14 |
| `scripts/lib/asset-inventory.js` | 89/201 | 89/201 | 13/21 | 13/21 |
| `scripts/lib/bounded-child-process.js` | 36/50 | 36/50 | 2/8 | 2/8 |
| `scripts/lib/bounded-filesystem.js` | 142/169 | 142/169 | 34/54 | 34/54 |
| `scripts/lib/capability-bundle-selection.js` | 75/849 | 75/849 | 1/1 | 1/1 |
| `scripts/lib/changelog-fragments.js` | 178/188 | 178/188 | 43/53 | 43/53 |
| `scripts/lib/codex-native-package.js` | 658/921 | 658/921 | 111/211 | 110/210 |
| `scripts/lib/codex-role-neighbors.js` | 222/247 | 222/247 | 70/85 | 70/85 |
| `scripts/lib/cursor-harness-adapt.js` | 136/168 | 136/168 | 36/45 | 36/45 |
| `scripts/lib/cursor-plugin-package.js` | 1213/2440 | 1213/2440 | 254/453 | 253/452 |
| `scripts/lib/cursor-session-home.js` | 19/90 | 19/90 | 1/1 | 1/1 |
| `scripts/lib/cursor-sync-package.js` | 250/293 | 250/293 | 67/92 | 67/92 |
| `scripts/lib/distribution-compiler.js` | 402/494 | 402/494 | 206/245 | 196/235 |
| `scripts/lib/distribution-inventory-regeneration.js` | 13/40 | 13/40 | 1/1 | 1/1 |
| `scripts/lib/distribution-inventory.js` | 1943/2518 | 1943/2518 | 563/895 | 563/895 |
| `scripts/lib/distribution-projection-contract.js` | 519/585 | 519/585 | 236/300 | 233/297 |
| `scripts/lib/distribution-projection-parity.js` | 394/461 | 394/461 | 123/185 | 121/183 |
| `scripts/lib/harness-surfaces.js` | 25/25 | 25/25 | 1/1 | 1/1 |
| `scripts/lib/internal-runtime-skills.js` | 68/77 | 68/77 | 31/42 | 33/44 |
| `scripts/lib/platform-provenance.js` | 88/393 | 88/393 | 7/10 | 7/10 |
| `scripts/lib/project-agent-host-binding-policy.js` | 160/240 | 160/240 | 41/71 | 41/71 |
| `scripts/lib/project-agent-projection-plan.js` | 470/647 | 470/647 | 68/145 | 68/145 |
| `scripts/lib/project-agent-projection-publisher.js` | 1115/1788 | 1128/1788 | 149/393 | 154/398 |
| `scripts/lib/project-agent-provider-adapters.js` | 300/483 | 300/483 | 24/51 | 24/51 |
| `scripts/lib/projection-artifact-store.js` | 246/309 | 246/309 | 57/94 | 58/95 |
| `scripts/lib/redaction.js` | 13/23 | 13/23 | 1/1 | 1/1 |
| `scripts/lib/reference-registry.js` | 123/128 | 123/128 | 35/47 | 35/47 |
| `scripts/lib/skill-routing-projection.js` | 90/201 | 90/201 | 12/19 | 12/19 |
| `scripts/lib/skill-topology.js` | 26/281 | 26/281 | 1/1 | 1/1 |
| `scripts/lib/skill-usage.js` | 566/940 | 566/940 | 108/183 | 107/182 |
| `scripts/lib/standalone-package-assets.js` | 20/77 | 20/77 | 2/11 | 2/11 |

Common branch arms: 5000; covered 3077 → 3081. Unresolved comparisons: `[]`. The comparison includes every canonical `scripts/`, `skills/`, and `modules/` dependency loaded by this focused run. Shell paths are outside c8 instrumentation and rely on their behavioral negative tests.

Full raw reports, registration multisets, command metadata, mutation logs, and coordinate comparison are retained under `/tmp/dhpk-consolidation/789/`. The raw coverage reports preserve instrumentation differences; identical production blobs and zero lost common covered coordinates explain range drift only when all removed and added ranges are covered.

#### Parent reconciliation and evidence limits

All 91 moved source cases are accounted for: 78 KEEP, 10 REWRITE, and 3 DELETE; the final collected multiset is 242 names, with no added names. Each of the ten rewrites has an actual named RED under a disposable production defect and restored GREEN. Writer-level NOT RUN entries above describe their limited scope; the combined parent focused run passes 9/9 files and 242/242 cases.

F11's 1,240-line owner is the user-authorized scoped exception. The three collected deletion owners are the F29 real-inventory/plugin-roots case in `tests/gen-claude-manifest.test.js`, the canonical retired-alias case in `tests/validate-plugin.test.js`, and the declared-empty materialized-output case in `tests/gen-cursor-sync.test.js`.

The first baseline from the working checkout contained ignored Python bytecode caches; its four cache-exclusion branch differences are retained under `observed-before-with-python-cache/`. Both authoritative sides now run in clean detached worktrees. No ignored user files were removed. Coverage and registration files describe these clean runs. All 48 instrumented production blobs are identical, no covered line count falls, and no common covered branch arm is lost.

The literal raw branch-count and percentage non-decrease acceptance condition is not reported as PASS for the following files. Their identical production blobs, zero lost covered common coordinates, and covered removed/added instrumentation ranges support a V8 range-map exception for review:

| File | Removed covered ranges | Added covered ranges |
| --- | --- | --- |
| `scripts/lib/agent-plugin-package.js` | `587:29-591:47`, `591:49-604:0`, `59:-1-59:40`, `632:64-634:43`, `635:-1-635:98` | `588:-1-590:28`, `591:-1-591:22`, `597:-1-604:0` |
| `scripts/lib/codex-native-package.js` | `267:36-269:29`, `269:56-272:65` | `267:36-267:69` |
| `scripts/lib/cursor-plugin-package.js` | `377:65-378:64`, `708:-1-731:0`, `795:24-797:40` | `708:-1-710:82`, `730:-1-731:0` |
| `scripts/lib/distribution-compiler.js` | `186:-1-186:43`, `186:70-187:92`, `187:128-217:0`, `385:-1-385:62`, `385:64-404:72`, `401:-1-404:72`, `406:24-414:58`, `414:60-417:32`, `414:60-417:51`, `432:22-434:4`, `59:-1-74:5` | `59:-1-66:5` |
| `scripts/lib/distribution-projection-contract.js` | `218:-1-222:46`, `274:-1-277:56`, `411:-1-413:49`, `46:28-47:41`, `55:84-58:82` | `274:-1-277:49`, `411:-1-413:43` |
| `scripts/lib/distribution-projection-parity.js` | `108:93-111:96`, `137:-1-146:3` | none |
| `scripts/lib/skill-usage.js` | `573:-1-574:57` | none |

Graph uncertainty remains explicit: canonical catalog file UID is UNKNOWN with confirmed CLI/test references; ambiguous projected candidates include CRITICAL, and a batched Cursor test impact reported CRITICAL/975 before serial UNKNOWN results. These warnings were surfaced before writing. No zero or alternate risk axis is used as a safety claim. Catalog changes are eight explicit ownership mappings; the policy-resolution spec now points at the collected reference-integrity block. No other production code is edited.

The generic precommit runner remains NOT RUN here: the earlier attempt reported FAIL with no stages because this repository has no package.json scripts. Actual catalog, plugin, harness, changelog, Markdown, projection, graph, review, full-suite, and CI gates are recorded separately. Full-suite and CI results follow in the PR evidence after the reviewed tree is committed; they are not inferred from the focused PASS.

Static parent gates: catalog `--check all` reports 0 uncovered scripts; plugin
validator, harness validator, and changelog-fragment validator pass. Markdown
lint (cli2 0.23.2 / markdownlint 0.41.1) checks the ledger, updated spec, and
generated ledger with 0 issues. `git diff --check` passes. Marketplace
generation and its clean-snapshot `--check` pass. Current GitNexus
`detect_changes(scope: all)` reports 59 changed symbols, 28 changed files,
LOW risk, and no partial/truncated marker; no mapped processes is not evidence
of no effect. Code and documentation Review Gate results are pending at this
recording point and must resolve before commit.

### Issue #790 completed family consolidation

Baseline: `ad08d4cde6babde55a23d6a4bef8eb3f78f729b8`. Fresh c8 10.1.3 reports with Node v26.9.0, `--jobs 4`, capture all affected owners and sources before moving them. The after run uses a clean tracked-source snapshot of the pending tree, so projection provenance checks see a clean checkout.

Focused suites: 22 → 9; collected cases 229 → 227; wall time 6846 → 6461 ms. These are focused measurements, separate from the full-suite and CI evidence.

#### Source dispositions

- F18: `tests/codex-native-package-validate.test.js` collects `tests/codex-native-activation.test.js`, `tests/codex-native-experimental-gate.test.js`, `tests/codex-plugin-manifest.test.js`, `tests/gen-codex-native-package.test.js`, `tests/verify-codex-native-package.test.js`.
- F19: `tests/check-codex-discovery.test.js` collects `tests/codex-discovery-registry.test.js`.
- F21: `tests/plugin-user-config-metadata.test.js` collects `tests/claude-user-config-probe.test.js`, `tests/gen-claude-user-config.test.js`.
- F22: `tests/profile-scoped-claude-capability-bundle.test.js` collects `tests/claude-profile-probe.test.js`, `tests/gen-claude-profile-bundles.test.js`.
- F23: `tests/capability-bundle-selection.test.js` collects `tests/capability-bundle-activation.test.js`.
- F28: `tests/codex-skill-metadata.test.js` collects `tests/codex-skill-layout.test.js`, `tests/codex-supporting-parity.test.js`.

The detailed KEEP, REWRITE, and DELETE decisions and controlled mutation evidence follow. Source test names are retained except the explicitly documented deletions. No production public behavior is changed.

##### WRITER A: Issue 790 writer A evidence

##### WRITER A: Identity and scope

- Task: `#790 A:F18+F19`.
- Attempt ID: not supplied in the parent handoff.
- Worker: `/root/issue790_writer_a`.
- Branch/base: `feature/issue-790-test-consolidation` at `ad08d4cde6babde55a23d6a4bef8eb3f78f729b8`.
- Parent authoritative baseline evidence: 22 suites / 229 cases, PASS and clean (the original family-only baseline was 19 suites / 173 cases); `/tmp/dhpk-consolidation/790/before-focused.log`, `before-names.jsonl`, and `before-snapshot.json`.
- Worker write scope: two owner test files modified and six source test files deleted. No catalog, production, documentation, generated, or Git metadata files were edited by this worker.

##### WRITER A: Consolidation result

- F18 source cases: 54 across five source suites; 50 KEEP, 2 REWRITE, 2 DELETE. Owner: 10 existing cases + 52 retained/moved = 62 final cases.
- F19 source cases: 16 across one source suite; 16 KEEP. Owner: 9 existing cases + 16 moved = 25 final cases.
- Combined: 70 source registrations; 66 KEEP, 2 REWRITE, 2 DELETE; 68 source registrations retained. Both owners have exactly one outer `run(...)` call.
- F18 owner length: 1084 lines; the packet explicitly authorized its >800-line exception. F19 owner length: 681 lines.
- Source test names and order remain unchanged except for the two documented deletions. No test names or timeout hints were added.

Rewrites:
- `enabled native plugin reports ENABLED with version` — fixture includes `unrelated-plugin@marketplace` first and literal `dhpk@dhpk` second; assertions pin `dhpk@dhpk` and `0.57.0`.
- `root .codex-plugin/plugin.json skills path resolves to an existing directory` — runs `validateNativeCandidate` on the actual root manifest candidate and pins `./plugins/dhpk/skills/`.

Deletes and collected owners:
- `root .codex-plugin/plugin.json skills is a string, not an array` — the native structural validation case exercises the manifest value through `validateNativeCandidate`; its `path.isAbsolute` path rejects arrays.
- `thin wrapper vendors the tracked physical native package, not a symlink mirror` — the moved real-repo parity case compares the tracked `plugins/dhpk/` package with fresh physical generation.

##### WRITER A: Exact source case inventory

##### WRITER A: F18 — owner: `tests/codex-native-package-validate.test.js`

**`tests/codex-native-activation.test.js` — 15 source cases**
- KEEP: `codex missing from PATH reports NOT_INSTALLED`
- REWRITE: `enabled native plugin reports ENABLED with version` — literal dhpk@dhpk fixture plus unrelated enabled distractor; expected identity/version are independent literals.
- KEEP: `disabled native plugin reports DISABLED`
- KEEP: `no matching plugin entry reports AVAILABLE`
- KEEP: `non-zero exit reports UNAVAILABLE`
- KEEP: `timeout reports UNAVAILABLE`
- KEEP: `live probe waits 30 seconds by default so remote marketplace queries can finish`
- KEEP: `DHPK_CODEX_PROBE_TIMEOUT_MS overrides the default live-probe budget`
- KEEP: `DHPK_CODEX_PROBE_TIMEOUT_SECONDS is accepted when the millisecond override is unset`
- KEEP: `an explicit timeoutMs option outranks the environment override`
- KEEP: `invalid probe timeout environment values keep the 30 second default`
- KEEP: `non-JSON stdout reports UNAVAILABLE`
- KEEP: `missing installed array reports UNAVAILABLE`
- KEEP: `non-boolean enabled field reports UNAVAILABLE`
- KEEP: `normalizeActivationOverride accepts auto/enabled/inactive and rejects anything else`
- Source totals: 14 KEEP, 1 REWRITE, 0 DELETE.

**`tests/codex-native-experimental-gate.test.js` — 4 source cases**
- KEEP: `the native .codex-plugin/plugin.json now passes native-candidate structural validation (physical tracked package, no symlinks)`
- KEEP: `the marketplace-target wrapper plugin.json now passes native-candidate structural validation (./skills/, no parent-relative escape)`
- KEEP: `the tracked package contains exactly the inventory codex-native surface — no membership drift`
- KEEP: `the native Codex marketplace support decision remains Experimental until explicit graduation`
- Source totals: 4 KEEP, 0 REWRITE, 0 DELETE.

**`tests/codex-plugin-manifest.test.js` — 9 source cases**
- KEEP: `root .codex-plugin/plugin.json has a semver version`
- KEEP: `root .codex-plugin/plugin.json version matches .claude-plugin/plugin.json`
- DELETE: `root .codex-plugin/plugin.json skills is a string, not an array` — fully owned by tests/codex-native-package-validate.test.js: the native manifest is passed through validateNativeCandidate; path.isAbsolute rejects an array input.
- REWRITE: `root .codex-plugin/plugin.json skills path resolves to an existing directory` — pin ./plugins/dhpk/skills/ and validate the actual candidate tree with validateNativeCandidate.
- KEEP: `thin wrapper plugin.json name/version match the root manifest`
- KEEP: `thin wrapper skills path resolves to the same directory as the root manifest`
- DELETE: `thin wrapper vendors the tracked physical native package, not a symlink mirror` — fully owned by tests/codex-native-package-validate.test.js after the moved real-repo parity case in tests/verify-codex-native-package.test.js validates the tracked package against fresh physical generation.
- KEEP: `marketplace.json plugin name/version match the marketplace-target wrapper manifest`
- KEEP: `marketplace.json source.path resolves exactly to the tracked plugins/dhpk wrapper`
- Source totals: 6 KEEP, 1 REWRITE, 2 DELETE.

**`tests/gen-codex-native-package.test.js` — 18 source cases**
- KEEP: `native compiler plan preserves explicit selection, public identity, and generated output intent`
- KEEP: `native compiler materializes a non-invokable transport runtime without granting capability selection`
- KEEP: `compiler-backed native generation preserves the accepted package bytes`
- KEEP: `native materialization preserves executable source modes through the artifact store`
- KEEP: `materialized candidate contains only the explicit codex-native surface, as real files — not every promoted skill`
- KEEP: `an approved optional-lifecycle native exception is included alongside promoted native skills`
- KEEP: `materialized native packages use public names for directories, frontmatter, fingerprints, and provenance while retaining stable IDs`
- KEEP: `native materialization rejects a skill whose frontmatter name differs from its public directory name`
- KEEP: `regenerating into an existing outDir removes a skill directory dropped from the codex-native surface`
- KEEP: `rematerializing a selected skill removes files deleted from its canonical source`
- KEEP: `materialization rejects a symlinked output root instead of writing through it`
- KEEP: `materialization rejects a symlinked output ancestor before it can write outside the lexical root`
- KEEP: `generation is deterministic: two materializations of the same inventory produce identical fingerprints and provenance`
- KEEP: `fingerprint traversal rejects excessive directory depth before unbounded recursion`
- KEEP: `native projection uses one byte budget across all selected skills`
- KEEP: `native fingerprinting rejects symlink entries before following external targets`
- KEEP: `native verifier rejects symlinked package roots and ancestors before reading the package`
- KEEP: `CLI generates the real repo codex-native set with zero symlinks and provenance`
- Source totals: 18 KEEP, 0 REWRITE, 0 DELETE.

**`tests/verify-codex-native-package.test.js` — 8 source cases**
- KEEP: `passes when the tracked package matches a fresh generation from the same sources`
- KEEP: `fails and names the extra skill when the tracked package has drifted membership`
- KEEP: `fails when a canonical skill file changes content after the tracked package was generated`
- KEEP: `fails closed when the native provenance routing projection omits entries`
- KEEP: `fails and identifies tracked frontmatter whose name differs from its public directory`
- KEEP: `against the real repo, the tracked plugins/dhpk/ package matches a fresh generation`
- KEEP: `consumer-runtime verification preserves NOT_CONFIGURED without upgrading structural evidence`
- KEEP: `consumer-runtime verification stays NOT_CONFIGURED when no consumer adapter is supplied`
- Source totals: 8 KEEP, 0 REWRITE, 0 DELETE.

##### WRITER A: F19 — owner: `tests/check-codex-discovery.test.js`

**`tests/codex-discovery-registry.test.js` — 16 source cases**
- KEEP: `fingerprint failures block activation while retaining the invalid provider and identity evidence`
- KEEP: `empty fingerprint without fingerprint error remains malformed`
- KEEP: `fingerprint failure outranks duplicate activation for an invalid project provider`
- KEEP: `fingerprint failure reason remains primary while valid duplicate names stay observable`
- KEEP: `same public name and fingerprint merge into one effective entry with providers`
- KEEP: `runtime activation blocks duplicate invokable names even when integrity fingerprints match`
- KEEP: `runtime activation ignores overlapping non-invokable support skills`
- KEEP: `different fingerprints block without explicit precedence`
- KEEP: `explicit precedence selects a current owned provider and preserves conflict evidence`
- KEEP: `same canonical identity is retained as one provider when discovery repeats it`
- KEEP: `kind and public name form the identity and malformed providers are rejected`
- KEEP: `stable provider id is retained separately from the public name`
- KEEP: `default surface labels are applied consistently to the report providers`
- KEEP: `inactive native providers do not raise a runtime duplicate`
- KEEP: `active native providers still raise a runtime duplicate`
- KEEP: `active defaults to true when unspecified`
- Source totals: 16 KEEP, 0 REWRITE, 0 DELETE.

##### WRITER A: Verification

- `node --check tests/codex-native-package-validate.test.js && node --check tests/check-codex-discovery.test.js` — PASS, both exit 0.
- `node tests/codex-native-package-validate.test.js` — PASS, 62/62.
- `node tests/check-codex-discovery.test.js` — PASS, 25/25.
- `git diff --check -- <8 assigned paths>` — PASS, exit 0.
- Durable focused output: `/tmp/dhpk-consolidation/790/after-focused-a.log`.

##### WRITER A: Controlled mutation evidence

Both mutations ran only in a disposable `/tmp/dhpk-790-a-mutation-*` copy containing the owner test, tinytest harness, scripts, needed manifests, distribution inventory, and physical `plugins/dhpk/skills/`. The working-tree production files were never mutated; exact copies in the disposable tree were restored after each RED.

1. Activation: change disposable `scripts/lib/codex-native-activation.js` from `CODEX_NATIVE_PLUGIN_ID = 'dhpk@dhpk'` to `'dhpk@wrong'`; run the focused harness for `enabled native plugin reports ENABLED with version`. It failed that exact case (`AVAILABLE` vs expected `ENABLED`, exit 1, 0/1). Restore the disposable source; the exact case passed (exit 0, 1/1).
2. Manifest: set disposable root `.codex-plugin/plugin.json` `skills` to `./codex/skills/`; this is an existing symlink mirror into a physical temp `skills/` directory. Run the focused harness for `root .codex-plugin/plugin.json skills path resolves to an existing directory`. It failed that exact case on `validateNativeCandidate`'s `symlink-dependent skills root` error (exit 1, 0/1). Restore the manifest; the exact case passed (exit 0, 1/1).
- Full RED/GREEN output: `/tmp/dhpk-consolidation/790/mutation-a.log`.
- Post-run restore check: disposable production ID is `dhpk@dhpk`, disposable root manifest is `./plugins/dhpk/skills/`, and `git diff --exit-code -- scripts/lib/codex-native-activation.js .codex-plugin/plugin.json` passed.

##### WRITER A: Graph and reference evidence

- Graph refresh: `/tmp/dhpk-consolidation/790/graph-ready.json` reports READY at the branch base.
- Exact UID serial CLI impact for `File:tests/check-codex-discovery.test.js` and `File:tests/codex-plugin-manifest.test.js` returned 0 resolved callers and `risk=UNKNOWN`; the index warns that UNKNOWN is unresolved. The ambiguous name query also emitted corrupted duplicate candidates with CRITICAL labels. Parent re-audited and released this scoped writer while preserving that ambiguous CRITICAL warning; no risk axes were used to waive it.
- Text discovery confirms source consumption through the test aggregate and found explicit current references to deleted test names in bootstrap/docs and plugin README/distribution docs/release parity comments. Parent owns those support-path reconciliations; this worker did not edit them.

##### WRITER A: Parent-owned gates

- Combined fresh c8 coverage/timing and post-wave review: NOT RUN by this worker; parent owns the combined gate after all writers finish. Resume command: `node /home/paul/.npm/_npx/1d50dde519b2be3f/node_modules/c8/bin/c8.js --reports-dir /tmp/dhpk-consolidation/790/after-coverage --reporter json --reporter json-summary node tests/run-all.js --jobs 4 tests/codex-native-package-validate.test.js tests/check-codex-discovery.test.js tests/plugin-user-config-metadata.test.js tests/profile-scoped-claude-capability-bundle.test.js tests/capability-bundle-selection.test.js tests/codex-skill-metadata.test.js`.
- Catalog validation: NOT RUN by this worker; parent owns the catalog mapping. Resume command: `node scripts/ci/catalog.js --check all`.
- Pre-commit graph change analysis: NOT RUN by this worker; no commit was made. Resume command: `node .gitnexus/run.cjs detect-changes --scope all --repo .`.

##### WRITER B: Issue 790 writer B evidence

- Task/attempt: issue 790, packet B (F21 + F22), worker `/root/issue790_writer_b`, branch `feature/issue-790-test-consolidation`.
- Base from packet: `ad08d4cde6babde55a23d6a4bef8eb3f78f729b8`.
- Scope: two owner suites modified; four source suites deleted. This worker wrote only the six assigned test paths. Concurrent changes outside this assignment were preserved.
- Behavior: no production code, coverage catalog, docs, generated output, runner, timeout hint, or coverage flag changed. F22 owner is 909 lines; the packet explicitly approves this size exception.

##### WRITER B: Consolidation

All 20 source cases remain in labeled braced lexical blocks in their destination owner suites. The source case titles and assertions were copied from the baseline; source names/counts are below. Original source imports and helper closures remain inside their block. The source `run` invocations and their now-unused `run` imports were removed; each owner retains one final `run(...)` call.

Helper/import adjustments:

- F21 `claude-user-config-probe` block retains `fs`, `os`, `path`, tinytest `test`/`assert`, and the direct `runClaudeUserConfigProbe` import. Its inline crypto requires and test-local setup remain unchanged.
- F21 `gen-claude-user-config` block retains `spawnSync`, `fs`, `os`, `path`, tinytest `test`/`assert`, and its local `ROOT` constant.
- F22 `claude-profile-probe` block retains `fs`, `os`, `path`, tinytest `test`/`assert`, and its local `probe` import.
- F22 `gen-claude-profile-bundles` block retains `spawnSync`, `fs`, `os`, `path`, tinytest `test`/`assert`, `compileClaudeCapabilityBundle`, local `ROOT`, `snapshotFiles`, `GENERATOR`, `runGenerator`, and `withCommittedMinimalCopy`.
- Block-local bindings keep the source helper/import closures isolated from each other and the existing owner suite.

##### WRITER B: Exact source case names and counts

`tests/claude-user-config-probe.test.js` — 6 KEEP:

- configured consumer probe stays non-pass without an exact details binding
- probe rejects a stale local manifest even when the consumer reports a forged expected fingerprint
- probe rejects a prefix-only Claude version and unrelated plugin details
- probe requires dhpk identity before accepting fingerprint details
- probe treats a prerelease suffix as a version mismatch
- probe rejects conflicting consumer fingerprints

`tests/gen-claude-user-config.test.js` — 1 KEEP:

- candidate generator validates the authoritative source without activating it

`tests/claude-profile-probe.test.js` — 3 KEEP:

- Claude profile probe keeps its closed status vocabulary and rejects unsafe aliases without leaking paths
- profile tree digest rejects a symlinked entry
- artifact digest rejects a receipt output that resolves outside the package root

`tests/gen-claude-profile-bundles.test.js` — 10 KEEP:

- profile bundle generator previews a declared finite alias plan
- minimal generator reports the curated default selection
- compat-v1 generator preserves the predecessor-compatible allowlist
- minimal generator materializes only curated skills and command roots
- minimal profile keeps command owners in support closure without publishing them publicly
- --check passes when the committed minimal profile matches its sources
- --check fails and names a stale skill copy
- --check fails on extra and missing files
- --check fails when the baseline package is absent
- --plan and --check are mutually exclusive

Total moved source cases: 20 KEEP (F21 7, F22 13). Current owner totals: F21 21 cases and one final `run`; F22 36 cases and one final `run`.

##### WRITER B: Graph and reference evidence

- Exact-UID serial CLI impact for all six assigned files returned 0 resolved upstream callers and `risk=UNKNOWN`, with the tool's unresolved-caller warning. This is retained as unresolved graph risk, not reported as low.
- The initial name-based F22 query was ambiguous and exposed a 613/CRITICAL line-level candidate. Parent's bounded reasoner re-audit identified the `line 679` candidate beyond the 663-line baseline file as a file-integrity anomaly. Exact-UID CLI and MCP both returned UNKNOWN/0; the ambiguous CRITICAL warning is preserved here and was reported to the parent before edits. No risk-axis waiver was used.
- Text references confirm discovery: `tests/run-all.js` recursively discovers `*.test.js`; `scripts/ci/catalog.js` maps both F21 production scripts to `plugin-user-config-metadata.test.js` and both F22 production scripts to `profile-scoped-claude-capability-bundle.test.js` (lines 164-167 in the pre-edit checkout). These checks establish the source-consumption path; they do not turn the graph UNKNOWN into low risk.

##### WRITER B: Verification

- `node --check tests/plugin-user-config-metadata.test.js` — PASS.
- `node --check tests/profile-scoped-claude-capability-bundle.test.js` — PASS.
- `node tests/plugin-user-config-metadata.test.js` — PASS, 21/21.
- `node tests/profile-scoped-claude-capability-bundle.test.js` — PASS, 36/36.
- `git diff --check -- <six assigned paths>` — PASS.
- Full-suite / c8 wrapper — NOT RUN here; parent owns the post-writer workflow wrapper after all assigned batches complete.

##### WRITER C: Issue 790 worker C evidence — F23 + F28

##### WRITER C: Identity and scope

- Task: `#790 C:F23+F28`
- Worker: `/root/issue790_writer_c`
- Attempt ID: not supplied in the parent handoff
- Base: commit `ad08d4cde6babde55a23d6a4bef8eb3f78f729b8`, tree `53e7a4000fe6ff7f765b5fb5cc003293cdf02eb7`
- Parent graph refresh: `READY` for the base commit, from `/tmp/dhpk-consolidation/790/graph-ready.json`
- Owned files: `tests/capability-bundle-selection.test.js`, `tests/capability-bundle-activation.test.js`, `tests/codex-skill-metadata.test.js`, `tests/codex-skill-layout.test.js`, `tests/codex-supporting-parity.test.js`

##### WRITER C: Changes

- Moved the two activation cases and their `os`, `ProjectionArtifactStore`, `activateStagedCandidate`, `tempRoot`, and `plan` imports/helpers into `capability-bundle-selection.test.js`.
- Moved the three layout cases and three supporting-parity cases into `codex-skill-metadata.test.js`. Reused that owner's existing `fs`, `path`, `ROOT`, and `INVENTORY`; added `crypto`, the layout constants and `directoryEntries`, plus `projectionPath`, `sha256`, and `projectedFiles` helpers.
- Added source labels around consolidated import/helper/case blocks. Kept one existing outer `run()` call in each owner suite.
- Deleted the three source files. No case registration names or `TIMEOUT_HINTS` entries were added or changed.

All 8 moved case registrations match their pre-change names and order, and the 8 test bodies compare byte-for-byte against their `HEAD` source cases:

- F23 (2): `staging is observable separately and a required non-pass leaves the active root unchanged`; `a required PASS is the only path that activates a staged candidate`.
- F28 layout (3): `every Codex skill uses the root canonical skill`; `Codex has no physical source mirrors`; `Codex plugin README reports the actual mirror entry count`.
- F28 supporting parity (3): `every inventory supporting asset has a unique id/destination and a materialized projection`; `direct supporting assets stay byte-identical to canonical sources`; `transformed supporting assets declare canonical sources and remove Claude lifecycle mechanics`.

Owner totals after consolidation: capability selection `20` cases (18 pre-existing + 2 moved); Codex skill metadata `7` cases (1 pre-existing + 6 moved).

##### WRITER C: Graph and text evidence

- GitNexus `impact --direction upstream` was run for both owner files and all three deleted source files against the refreshed base index. Each file result had `impactedCount: 0`, `risk: UNKNOWN`, and no resolved callers/processes. Per AGENTS.md, this remains unresolved, not a low-risk result.
- The reasoner packet's text evidence and local source scan confirm the test runner discovers `*.test.js` dynamically (`tests/run-all.js`) and there are no code references to the deleted file paths. Out-of-scope documentation and generated copies still mention historical source paths in `docs/test-suite-quality-review.md`, `docs/test-consolidation-baseline.csv`, `docs/test-suite-review-inventory.csv`, and generated mirrors; they were left untouched under the assigned scope.
- `tests/run-all.js` currently has timeout hints only for `install-codex-skills-reconciliation.test.js` and `harness-facade-cli.test.js`; none of the deleted source suites had a hint, and this worker made no `TIMEOUT_HINTS` edit.

##### WRITER C: Verification

- `node tests/capability-bundle-selection.test.js` → PASS, `20/20`.
- `node tests/codex-skill-metadata.test.js` → PASS, `7/7`.
- `node --check tests/capability-bundle-selection.test.js && node --check tests/codex-skill-metadata.test.js` → PASS, exit 0.
- Baseline-vs-current registration-name/order comparison → PASS, 2 moved F23 cases and 6 moved F28 cases preserved.
- Baseline source-vs-owner test-body comparison → PASS, all 8 moved bodies byte-for-byte equal.
- `git diff --check -- <five owned paths>` → PASS, exit 0.
- Scoped status contains exactly the two modified owners and three deleted sources.
- Combined post-wave `c8` run: NOT RUN by this worker; parent owns the fresh combined run after all writers finish. Resume command (using the current F18/F19/F21/F22/F23/F28 after-file list): `node /home/paul/.npm/_npx/1d50dde519b2be3f/node_modules/c8/bin/c8.js --reports-dir /tmp/dhpk-consolidation/790/after-coverage --reporter json --reporter json-summary node tests/run-all.js --jobs 4 tests/codex-native-package-validate.test.js tests/check-codex-discovery.test.js tests/plugin-user-config-metadata.test.js tests/profile-scoped-claude-capability-bundle.test.js tests/capability-bundle-selection.test.js tests/codex-skill-metadata.test.js`.
- Whole-wave `gitnexus detect-changes --scope all`: NOT RUN by this worker; parent owns post-wave reconciliation before any commit. Resume command: `node .gitnexus/run.cjs detect-changes --scope all --repo .`.

#### Registration reconciliation

Removed registration names:

- `root .codex-plugin/plugin.json skills is a string, not an array`
- `thin wrapper vendors the tracked physical native package, not a symlink mirror`

Added registration names:

- None.

#### Per-file focused timing

| File | Before ms | After ms |
| --- | --- | --- |
| `tests/codex-native-package-validate.test.js` | 115 | 1731 |
| `tests/codex-native-activation.test.js` | 47 | merged |
| `tests/codex-native-experimental-gate.test.js` | 203 | merged |
| `tests/codex-plugin-manifest.test.js` | 47 | merged |
| `tests/gen-codex-native-package.test.js` | 966 | merged |
| `tests/verify-codex-native-package.test.js` | 1005 | merged |
| `tests/check-codex-discovery.test.js` | 1329 | 1365 |
| `tests/codex-discovery-registry.test.js` | 64 | merged |
| `tests/plugin-user-config-metadata.test.js` | 141 | 241 |
| `tests/claude-user-config-probe.test.js` | 59 | merged |
| `tests/gen-claude-user-config.test.js` | 185 | merged |
| `tests/profile-scoped-claude-capability-bundle.test.js` | 463 | 2044 |
| `tests/claude-profile-probe.test.js` | 57 | merged |
| `tests/gen-claude-profile-bundles.test.js` | 1630 | merged |
| `tests/capability-bundle-selection.test.js` | 98 | 99 |
| `tests/capability-bundle-activation.test.js` | 69 | merged |
| `tests/codex-skill-metadata.test.js` | 60 | 72 |
| `tests/codex-skill-layout.test.js` | 53 | merged |
| `tests/codex-supporting-parity.test.js` | 65 | merged |
| `tests/bootstrap-dhpk-plugin-validation.test.js` | 52 | 42 |
| `tests/release-parity.test.js` | 82 | 83 |
| `tests/catalog-claims.test.js` | 6530 | 6296 |

All collected owners remain below the default 180 s budget. No `TIMEOUT_HINTS` entry is added.

#### Canonical production coverage

Covered/total counts below are raw fresh-report values. Branch range coordinates are independently compared; a raw drop is never described as raw non-decrease PASS.

| Production file | Before lines | After lines | Before branches | After branches |
| --- | --- | --- | --- | --- |
| `scripts/ci/_lib/codex-runtime.js` | 46/756 | 46/756 | 1/1 | 1/1 |
| `scripts/ci/_lib/frontmatter.js` | 37/129 | 37/129 | 1/1 | 1/1 |
| `scripts/ci/catalog.js` | 329/463 | 338/472 | 24/51 | 24/51 |
| `scripts/ci/check-codex-discovery.js` | 150/150 | 150/150 | 55/63 | 55/63 |
| `scripts/ci/context-budget.js` | 212/365 | 212/365 | 35/84 | 35/84 |
| `scripts/ci/gen-claude-manifest.js` | 53/65 | 53/65 | 4/8 | 4/8 |
| `scripts/ci/gen-claude-profile-bundles.js` | 170/204 | 170/204 | 54/77 | 54/77 |
| `scripts/ci/gen-claude-user-config.js` | 47/116 | 47/116 | 3/9 | 3/9 |
| `scripts/ci/gen-codex-native-package.js` | 63/70 | 63/70 | 4/8 | 4/8 |
| `scripts/ci/verify-codex-native-package.js` | 139/147 | 139/147 | 17/23 | 17/23 |
| `scripts/lib/agy-path-contract.js` | 29/97 | 29/97 | 1/1 | 1/1 |
| `scripts/lib/asset-inventory.js` | 189/201 | 189/201 | 39/52 | 39/52 |
| `scripts/lib/bounded-child-process.js` | 44/50 | 44/50 | 3/11 | 3/11 |
| `scripts/lib/bounded-filesystem.js` | 146/169 | 146/169 | 52/70 | 52/70 |
| `scripts/lib/capability-bundle-activation.js` | 29/38 | 29/38 | 3/6 | 3/6 |
| `scripts/lib/capability-bundle-selection.js` | 751/849 | 751/849 | 364/486 | 364/486 |
| `scripts/lib/claude-capability-bundle.js` | 712/797 | 712/797 | 242/333 | 242/333 |
| `scripts/lib/codex-discovery-registry.js` | 283/297 | 283/297 | 89/99 | 89/99 |
| `scripts/lib/codex-native-activation.js` | 103/106 | 103/106 | 40/44 | 42/45 |
| `scripts/lib/codex-native-package.js` | 837/921 | 837/921 | 239/336 | 241/338 |
| `scripts/lib/codex-role-neighbors.js` | 46/247 | 46/247 | 1/1 | 1/1 |
| `scripts/lib/discovery-budget.js` | 167/245 | 167/245 | 46/73 | 46/73 |
| `scripts/lib/distribution-compiler.js` | 310/494 | 310/494 | 104/170 | 104/170 |
| `scripts/lib/distribution-inventory-regeneration.js` | 13/40 | 13/40 | 1/1 | 1/1 |
| `scripts/lib/distribution-inventory.js` | 948/2518 | 948/2518 | 110/237 | 110/237 |
| `scripts/lib/distribution-projection-contract.js` | 519/585 | 519/585 | 192/280 | 191/279 |
| `scripts/lib/distribution-projection-parity.js` | 120/461 | 120/461 | 14/31 | 14/31 |
| `scripts/lib/harness-surfaces.js` | 25/25 | 25/25 | 1/1 | 1/1 |
| `scripts/lib/internal-runtime-skills.js` | 48/77 | 48/77 | 17/29 | 17/29 |
| `scripts/lib/platform-provenance.js` | 179/393 | 179/393 | 17/68 | 17/68 |
| `scripts/lib/plugin-user-config-metadata.js` | 260/270 | 260/270 | 76/117 | 76/117 |
| `scripts/lib/profile-projection-sets.js` | 75/118 | 75/118 | 11/14 | 11/14 |
| `scripts/lib/project-agent-host-binding-policy.js` | 35/240 | 35/240 | 1/1 | 1/1 |
| `scripts/lib/project-agent-projection-plan.js` | 63/647 | 63/647 | 1/1 | 1/1 |
| `scripts/lib/project-agent-provider-adapters.js` | 102/483 | 102/483 | 1/1 | 1/1 |
| `scripts/lib/projection-artifact-store.js` | 219/309 | 219/309 | 46/77 | 46/77 |
| `scripts/lib/redaction.js` | 23/23 | 23/23 | 2/3 | 2/3 |
| `scripts/lib/release-evidence.js` | 71/269 | 71/269 | 1/1 | 1/1 |
| `scripts/lib/release-parity.js` | 148/180 | 148/180 | 22/28 | 22/28 |
| `scripts/lib/skill-routing-projection.js` | 92/201 | 92/201 | 14/21 | 14/21 |
| `scripts/lib/skill-topology.js` | 26/281 | 26/281 | 1/1 | 1/1 |
| `scripts/lib/skill-usage.js` | 563/940 | 563/940 | 89/167 | 89/167 |
| `scripts/lib/standalone-package-assets.js` | 20/77 | 20/77 | 2/11 | 2/11 |
| `scripts/lib/workflow-package-closure.js` | 113/130 | 113/130 | 24/58 | 24/58 |
| `scripts/release/claude-profile-probe.js` | 206/217 | 206/217 | 91/137 | 89/135 |
| `scripts/release/claude-user-config-probe.js` | 106/155 | 106/155 | 40/74 | 36/70 |
| `scripts/release/consumer-gate.js` | 444/1958 | 444/1958 | 90/137 | 90/137 |

Common branch arms: 3434; covered 2236 → 2237. Unresolved comparisons: `[]`. The comparison includes every canonical `scripts/`, `skills/`, and `modules/` dependency loaded by this focused run. Shell paths are outside c8 instrumentation and rely on their behavioral negative tests.

Full raw reports, registration multisets, command metadata, mutation logs, and coordinate comparison are retained under `/tmp/dhpk-consolidation/790/`. The raw coverage reports preserve instrumentation differences; identical production blobs and zero lost common covered coordinates explain range drift only when all removed and added ranges are covered.

#### Parent reconciliation and gates

The actual 98 source cases comprise 94 KEEP, 2 REWRITE, and 2 DELETE; 96 are retained. The three supporting guards (Catalog claims, bootstrap validation, and release parity) are included in both clean focused runs. The authoritative comparison is 22 files / 229 cases before and 9 files / 227 cases after, with exactly the two documented names removed and none added. The original family-only baseline remains separately archived.

F18 has 1,084 lines and F22 has 909 lines, using the explicitly approved exceptions. F19 has 681 lines. No timeout allowance was introduced.

All 47 canonical loaded production files have non-decreasing covered line counts; 3,434 common branch arms retain 2,236 covered and increase to 2,237, with zero covered arms lost. The Catalog blob changes only coverage ownership mappings; release parity changes only a test-path comment. Other measured production blobs are identical. Three raw covered branch counts decrease: distribution-projection-contract (192 → 191), claude-profile-probe (91 → 89), and claude-user-config-probe (40 → 36). All removed and added ranges in these files are covered. Literal raw branch non-decrease is NOT PASS; the unchanged blobs and range-coordinate evidence support a documented V8 instrumentation exception for cold review.

Nine live supporting paths now name the surviving native validation owner, including bootstrap checks, design acceptance commands, distribution documentation, native package README, and release-parity comments. The README is a canonical package fallback input but does not alter skill fingerprints or provenance contract behavior. Historical evidence keeps its original source names. Marketplace copies are regenerated from canonical sources.

Graph refresh matches the issue base. Ambiguous name-based impact returned CRITICAL candidates with corrupted or duplicate identities for discovery/profile tests; that warning remains unresolved as an index result. Read-only re-audit used exact File UIDs, returned UNKNOWN, confirmed folder-only incoming graph edges, and confirmed dynamic test-runner discovery plus live references by text. UNKNOWN is not a claim of unused code or low risk. This bounds the authorized test-only edits and supporting pointer repairs.

Full-suite, platform, hosted CI, and real v2 code/document review evidence are pending at this ledger checkpoint; later delivery evidence must report their actual results separately.
