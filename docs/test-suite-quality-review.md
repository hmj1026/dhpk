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
ordinal 247, `tests/retirement-closure.test.js`, is attached to B batch 05 / issue
number #666, pending implementation there. Neither file is counted as an
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
