## 1. Freeze the selection and evidence contract

- [ ] 1.1 Add the `project-agent-projection-lifecycle` contract to the
  inventory/compiler selection path, including explicit project scope,
  `portable-core` versus Host-specific profile selection, Host capability filtering, dependency closure,
  projection owner, and stable selection fingerprints; add focused compiler
  tests for undeclared selection and `SKIP_INCOMPATIBLE` entries.
- [x] 1.2 Add characterization fixtures for the current `.agents/skills`
  projection, Codex project sync, Cursor project sync, AGY package/install,
  and Claude skill discovery adapter; record selected IDs, output paths,
  fingerprints, receipts, diagnostics, and exit codes before migration.
- [x] 1.3 Add a compatibility matrix fixture covering Codex, Cursor, AGY, and
  Claude portable skill discovery versus native agents/rules/hooks, including
  the current 37-entry shared selection and the Codex-sync subset; fail closed
  when a common projection would expose an unsupported entry.

## 2. Deepen the project projection module

- [ ] 2.1 Refactor `scripts/lib/agents-skills-package.js` to consume the
  compiler-owned plan and accept a caller-declared external project root while
  preserving physical-source containment and safe destination checks.
- [ ] 2.2 Route project projection staging, fingerprinting, publication, and
  recovery through `ProjectionArtifactStore` or a managed-entry adapter with
  equivalent guarantees; remove the private writer only after its
  characterization fixture passes byte, ordering, collision, and rollback
  equivalence.
- [ ] 2.3 Materialize selected skill dependency closure into the external
  `.agents/skills` artifact so references, scripts, and assets remain usable
  after the canonical checkout is moved or removed; add relocation tests.
- [ ] 2.4 Implement the generated AGY direct-file adapter and its transform
  contract. Generate a self-contained body by default; permit sibling-package
  resolution only after a bounded consumer probe, and keep the unverified state
  non-pass.
- [ ] 2.5 Make `.agents/.dhpk-installed.json` the sole lifecycle receipt and
  retain `.agents/skills/.dhpk-projection.json` only as a generated manifest or
  compatibility input. Extend the receipt with profile/standalone identity,
  dependency closure, projection owner, Host bindings, and shared
  source/generated fingerprints; support binding removal without deleting
  content still referenced by another Host.
- [ ] 2.6 Preserve unmanaged entries and changed receipt-owned files during
  update, uninstall, rollback, and interrupted publication; add tests for
  foreign skills, modified managed files, shared bindings, and recovery.
- [ ] 2.7 Update `validate-agents-skills` and related parity checks to validate
  the plan, receipt, both discovery shapes, relocation, path safety, secrets,
  and separate structural versus consumer-runtime evidence.

## 3. Consolidate installation ownership and surface diagnostics

- [ ] 3.1 Add one lifecycle observation in `scripts/lib/agy-plugin-install.js`
  for valid receipt-owned, empty/incidental, invalid-receipt, foreign, and
  absent targets; route `existingTargets`, ambiguity detection, resolution,
  and migration through it.
- [ ] 3.2 Add regression coverage for legacy install → migrate → status, empty
  legacy directories, `.DS_Store`-only directories, invalid receipts, and
  foreign Git checkouts. Preserve `FOREIGN_CHECKOUT`/`BLOCKED` semantics.
- [ ] 3.3 Add a reusable active-surface display label to the shared
  Codex/Cursor project-sync configuration and replace all human-readable
  hard-coded platform names in stale, lock, rollback, metadata, and migration
  diagnostics. Preserve state, ordering, exit codes, and Codex wording.
- [ ] 3.4 Add paired Codex and Cursor regression tests for every audited
  surface-named diagnostic, including the stale source-fingerprint reason from
  issue #497; add a guard preventing new hard-coded Codex wording in the
  shared engine.
- [ ] 3.5 Keep `dhpk-install` write actions and legacy shell routes behaviorally
  compatible during migration; expose the shared ownership/evidence decision
  in plan/status results without claiming that the lifecycle write path is
  complete. Treat receipt-less or binding-less installs as `legacy-unbound`
  until an explicit `adopt` or `repair` action succeeds.

## 4. Add Host adapters and documentation

- [ ] 4.1 Implement the Claude project discovery adapter and verify that it
  points to the generated project artifact without creating a second authored
  skill tree; preserve Claude plugin and marketplace ownership rules.
- [ ] 4.2 Keep Codex and Cursor native agents/rules/commands/hooks in their
  existing projections while binding portable skills to the shared artifact;
  add duplicate-discovery checks for old and new paths and native package
  overlap.
- [ ] 4.3 Update `docs/platform-installation.md` and
  `docs/platform-installation.zh-TW.md` with the external project route,
  receipt/binding ownership, Host adapter limits, migration/rollback commands,
  and structural/discovery/runtime evidence vocabulary.
- [ ] 4.4 Update package and platform references so support tiers remain
  accurate: common skills compatibility does not graduate Codex-native,
  Cursor-native, or AGY-native support and does not imply universal native
  configuration directories.

## 5. Migrate and verify incrementally

- [ ] 5.1 Run structural and package tests against an external consumer project
  with the source checkout removed; verify all selected resources resolve and
  the receipt remains valid.
- [ ] 5.2 Run configured Codex, Cursor, AGY, and Claude consumer probes against
  the exact generated artifact. Record `PASS`, `NOT_RUN`, `NOT_CONFIGURED`,
  `BLOCKED`, `UNAVAILABLE`, or `SKIP_INCOMPATIBLE` separately per Host and
  never promote static validation to runtime support; an unavailable probe
  must not invalidate unrelated Host projections.
- [ ] 5.3 Run distribution parity, installer, lifecycle, documentation, and
  full repository tests; verify that changed-file detection reports only the
  intended projection, lifecycle, receipt, test, and documentation symbols.
- [ ] 5.4 After managed-entry equivalence and rollback gates pass, retire the
  private `.agents` publication writer and mark the prior generator as a
  compatibility path or remove it in a separate reviewed migration. Keep
  canonical source files and existing surface fallback routes unchanged.
