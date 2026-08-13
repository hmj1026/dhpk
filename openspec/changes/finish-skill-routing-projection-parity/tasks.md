## 0. SSOT and dependency gate

- [x] 0.1 Add and validate the new proposal, design, delta specs, and ordered tasks; explicitly record the archived PR #177 baseline and stale ignored active artifact as non-authoritative.
- [x] 0.2 Synchronize the discovery capability into `openspec/specs/skill-discovery-context-budget/spec.md` and `openspec/specs/skill-routing-guidance/spec.md`; run strict specs validation.

## 1. Router contract and tests

- [x] 1.1 Add RED tests for normalized family records, exact selector resolution, stable aliases, safe conditional-reference paths, and closed diagnostics.
- [x] 1.2 Implement pure router normalization/resolution helpers behind the existing inventory validator; preserve current exports and public IDs.
- [x] 1.3 Extend inventory tests for duplicate aliases, missing targets, ambiguous selectors, unsupported surfaces, unsafe references, invocation drift, and one-to-one alias resolution.

## 2. Conditional family references

- [x] 2.1 Create the Laravel router/reference map for 5.4, 6, 7, 8, 9, 10, 11, and Mix without moving or deleting legacy reference content.
- [x] 2.2 Create the PHPUnit router/reference map for 9, 10, and 11 while preserving the PHPUnit 9 modern compatibility boundary.
- [x] 2.3 Reduce only any remaining family descriptions that exceed their declared initial budget; preserve positive trigger, boundary, output, authorization, destructive-action, and completion cues.
- [x] 2.4 Add progressive-loading tests proving selected references are isolated and optional descriptions remain discovery-visible.

## 3. Projection parity

- [x] 3.1 Add a pure normalized router/alias projection view consumed by Claude and Codex generators.
- [x] 3.2 Add parity checks for sorted IDs, names, router/selector targets, invocation class, surfaces, budgets, and canonical source fingerprints.
- [x] 3.3 Add invocation tests for every Laravel and PHPUnit legacy alias on each declared supported surface.
- [x] 3.4 Add repeat-generation byte-identity tests and stable ID/surface drift diagnostics.

## 4. Regression and evidence

- [x] 4.1 Add a regression guard for separate React 18/19 and Next.js 15.5/16 IDs and mappings.
- [x] 4.2 Record consumer probes with the closed evidence vocabulary; keep missing/unconfigured clients `NOT_RUN`, `NOT_CONFIGURED`, `BLOCKED`, or `UNAVAILABLE`.
  - Evidence: tracked Codex native artifact install smoke `PASS` (real `codex-cli 0.147.0`, sandboxed marketplace/cache, source checkout removed); Claude Code `2.1.231` has no supported non-interactive module consumer probe here, so runtime remains `NOT_RUN`; Cursor package probe is `UNAVAILABLE` because no GUI/local loader is available.

## 5. Verification and delivery

- [x] 5.1 Run focused budget, inventory, router, progressive-loading, invocation, parity, and frontend regression tests.
- [x] 5.2 Run plugin/catalog/harness/full test gates and `openspec validate --specs --strict` plus strict change validation.
- [x] 5.3 Run GitNexus changed-symbol detection, inspect staged paths, dispatch applicable consolidated reviewers, and reconcile all review obligations.
  - Evidence: GitNexus `detect_changes(scope=all)` reported low risk with no affected execution processes; staged-path allowlist contains only the routing implementation, tests, changelog, provenance, and explicitly force-added OpenSpec artifacts; code and doc reviewers both returned `APPROVE` with no remaining findings.
- [x] 5.4 Commit with a conventional message, push the feature branch, open a PR to `develop`, and monitor exact-head checks until all required checks pass.
  - Evidence: implementation commit `289d578`; PR #179 exact head `6c8458d` has Markdown lint and Validate harness assets both `PASS`.
- [ ] 5.5 Merge only after exact-head CI PASS, then verify post-merge `develop` CI PASS; archive the completed change in a follow-up lifecycle step.
