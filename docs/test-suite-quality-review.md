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
ledger records its seven consumers and shared fixture role. No production
source changed across Cohort A.

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

Production Bash line/branch comparison is **BLOCKED** on this macOS runner.
The available kcov 43 attempt failed with `task_for_pid failed with 5`, even
after its documented ad-hoc debugger entitlement. Node c8 does not instrument
the Bash file and is not used as a substitute. Direct guard behavior was
verified by the 38-case focused suite and the aggregate suite.

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
The 31 B support assets (16 helpers and 15 fixtures) are assigned to the batch
and issue of their lowest-original-ordinal B primary consumer. The
unreferenced `tests/fixtures/subagent-stop/lin-blog-2026-07-17.json` stays
unreferenced and has explicit audit ownership in batch 15 / issue #676.
