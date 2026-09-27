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

Three suites were rewritten; the batch's assigned helper,
`tests/_lib/install-codex-skills-fixtures.js`, remains unchanged and has seven
consumers. No primary fixture was assigned. No production source, helper, or
fixture changed. Five disposable mutation controls all made their matching
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
