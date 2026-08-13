## Context

Distribution behavior currently lives across `scripts/lib/distribution-inventory.js`, three surface package modules, and their `scripts/ci/` entry points. Those modules each combine some selection, transformation, filesystem safety, materialization, validation, and reporting. The repeated `findSymlinks`, containment, staging, replacement, and fingerprint logic is a **Tight Coupling** smell: adding a surface or changing ownership policy requires coordinated edits across otherwise independent generators. Generator-local inference is also **Magic** when observable output is not traceable to an inventory rule.

Agent review control has a different but related ownership problem. Sentinel hooks are already the fail-closed enforcement mechanism, while the execution policy and goal flows coordinate agent selection and handoff. This design makes that boundary explicit; it does not replace the proven Sentinel core.

This is a cross-module dependency-direction change and introduces a filesystem artifact-store port. It therefore triggers an ADR. The ADR is recorded in this design's Decisions section so the OpenSpec change remains the decision SSOT.

Constraints:

- Preserve existing Agent Plugin, Codex native, Cursor, and Claude observable outputs, diagnostics, exit codes, public CLI names, and support-tier semantics.
- Keep `manifests/distribution-inventory.json` authoritative; generated artifacts remain derived.
- Support Node/CommonJS conventions already used by `scripts/lib/` and `scripts/ci/`; add no external dependency.
- Validate external JSON, filesystem, process, and consumer responses at their boundaries; avoid repeated validation between frozen internal DTOs.
- Deliver independently reversible slices and preserve unrelated dirty worktree state.

## Goals / Non-Goals

**Goals:**

- Provide one deep `DistributionCompiler` interface with three operations:
  - `compileDistribution(inputs) -> DistributionPlan`
  - `materializeDistribution(plan, adapter, artifactStore) -> DistributionArtifact`
  - `verifyDistribution(stage, artifact, consumerAdapter) -> EvidenceResult`
- Hide surface selection, ordering, provenance, write safety, and evidence binding behind small stable contracts.
- Centralize filesystem mutation in `ProjectionArtifactStore` and make symlink behavior explicit and fail-closed.
- Keep consumer-native rendering and probing in adapters without allowing adapters to select inventory entries or declare ownership.
- Make orchestration the owner of dispatch/handoff/retry while Sentinel remains the owner of review-debt enforcement and evidence-qualified clearance.
- Characterize existing behavior before each surface cutover and keep rollback possible without a public v2 interface.

**Non-Goals:**

- Redesigning package content, renaming public CLIs, changing support tiers, or promoting additional inventory entries.
- Replacing Sentinel scripts, sentinel filenames, reviewer slots, artifact verdict vocabulary, or hook-owned clearance.
- Creating a generic workflow engine, universal repository abstraction, or plugin SDK.
- Optimizing projection throughput before a measured bottleneck exists.
- Migrating all surfaces in one release or maintaining concurrent legacy/v2 public APIs.

## Decisions

### ADR: Establish a compiler-centered projection boundary

**Status:** Proposed

**Context:** Surface package modules currently expose broad, surface-specific operations that mix policy and mechanism. Cross-surface changes repeat filesystem and validation logic and make the inventory's authority hard to prove.

**Decision:** Introduce `scripts/lib/distribution-compiler.js` as the only public application/domain facade for projection planning, materialization coordination, and stage verification. Its public surface is limited to the three approved operations. Add `scripts/lib/distribution-projection-contract.js` for frozen DTO construction, normalization, fingerprints, stable error codes, and boundary validation. Existing `scripts/ci/` commands remain the Interface layer and translate structured results to their characterized stdout/stderr and exit behavior.

Runtime flow and ownership are forward-only:

```text
Interface: existing scripts/ci CLIs
  -> Application/Domain: DistributionCompiler + immutable plan/artifact/evidence contracts
      -> Ports: ProjectionAdapter, ProjectionArtifactStore, ConsumerAdapter
          -> Infrastructure: filesystem store + Agent Plugin/Codex/Cursor/Claude adapters
              -> External: filesystem and installed consumer/runtime probes
```

The compiler does not import a concrete filesystem store or shell/process runner. The Interface composes concrete adapters and passes them through the ports. Adapters may depend on stable contract helpers, but may not call Interface entry points or each other. This prevents reverse and cyclic dependencies.

**Consequences — Positive:**

- A small deep interface replaces repeated selection/materialization orchestration.
- Plans and evidence become inspectable, deterministic, and testable without disk or installed consumers.
- New surfaces implement bounded adapters instead of cloning policy.

**Consequences — Negative:**

- Existing package modules temporarily carry compatibility wrappers during migration.
- DTO and adapter contracts add concepts that must be documented and tested.

**Consequences — Neutral:**

- The public CLI remains the interface contract; internal module names are not a new end-user API.

**Alternatives:**

- Keep surface-specific generators and share only utility functions: rejected because selection and ownership would remain distributed and drift-prone.
- Build one all-purpose `DistributionService`: rejected as a likely **God Object** combining compilation, filesystem access, consumer probes, and reporting.
- Add public v2 generators beside legacy commands: rejected by the One-Version Rule and zero-breaking requirement.

### ADR: Make ProjectionArtifactStore the sole mutation port

**Status:** Proposed

**Context:** Agent Plugin, Codex, and Cursor modules repeat path containment, physical-ancestor checks, staging, replacement, symlink discovery, and fingerprints. This is both security-sensitive and hard to keep consistent.

**Decision:** Add `scripts/lib/projection-artifact-store.js` as the sole implementation of projection filesystem mutation. The port supports bounded operations required by a compiled plan: begin a staged artifact, create planned directories, write planned bytes, create a permitted relative link, observe/digest planned outputs, atomically publish, and abort. It rejects unplanned paths and never accepts raw caller-selected destinations outside the compiled ownership root.

`materializeDistribution` asks a surface adapter to render bytes/metadata for plan entries, then sends only planned operations to the store. The adapter cannot write directly. A failed staged write does not replace the previously accepted generated root.

**Consequences — Positive:** one tested containment and atomicity boundary; surface adapters become smaller; output provenance is uniform.

**Consequences — Negative:** existing materializers require incremental extraction, and temporary wrappers must ensure there is still only one writer per migrated call path.

**Alternatives:**

- Let every adapter own filesystem safety: rejected because current duplication is the primary drift source.
- Use an off-the-shelf virtual filesystem: rejected as **Not-Invented-Here** in reverse—the repository needs a narrow store port and existing Node filesystem primitives, not a new dependency and abstraction surface.

### DistributionPlan, DistributionArtifact, and EvidenceResult contracts

`compileDistribution(inputs)` accepts explicit repository root, normalized inventory, canonical-source fingerprints/content handles, target surface, and compiler version. It validates only this external boundary and returns either `{ ok: true, value: DistributionPlan }` or `{ ok: false, error: ProjectionError }`. Callers may supply non-policy execution inputs such as a requested staging root through the materialization boundary, but no caller option may override inventory-owned membership, lifecycle, physical ownership, transform, verification-stage, or symlink policy.

`DistributionPlan` is deeply frozen and canonically serialized. It contains:

- schema/compiler version and plan fingerprint;
- inventory/input fingerprints and target surface;
- ordered entries keyed by inventory stable ID;
- canonical source path/fingerprint, transform ID/version, physical owner, normalized destination, expected content fingerprint, and symlink intent;
- no clock-derived ID, process-global configuration, directory-discovered membership, or writable handle.

`materializeDistribution(plan, adapter, artifactStore)` returns a frozen `DistributionArtifact` with the plan fingerprint, adapter identity/version, staged/published artifact identity, ordered physical output manifest, observed fingerprints, and explicit link records. The materializer never changes the plan or re-selects entries.

`verifyDistribution(stage, artifact, consumerAdapter)` accepts the closed stage vocabulary `structural`, `package`, or `consumer-runtime`. It returns a frozen `EvidenceResult` containing stage, adapter identity/version, plan/artifact fingerprints, checked claims/scope, observations, diagnostics, timestamp supplied by the Interface, and one existing result state: `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE`. Structural success cannot imply runtime support.

All three operations use the same result envelope and stable error shape: `code`, `operation`, `stage`, `stableIds`, `paths`, `message`, and optional causal details. Exceptions are caught and converted at the infrastructure boundary; only the Interface maps errors to existing CLI text and process exits.

### Distribution inventory owns all projection policy

Extend `manifests/distribution-inventory.json` additively with a versioned projection-contract section rather than creating a second inventory. The section declares compiler schema, per-surface adapter identity, physical ownership, transform identity, verification stages, and symlink policy. `scripts/lib/distribution-inventory.js` validates and normalizes it; downstream modules consume the normalized result.

The default symlink policy is `forbid`. A future or existing characterized exception must be declared by stable ID and output intent as a relative link that resolves within the physical ownership root. Absolute links, escaping relative targets, and ambient symlinks encountered during traversal fail closed. The artifact store never silently dereferences or converts a link into a copy.

This remains additive to the existing inventory schema during migration. The bootstrap/reconciliation command preserves explicit projection policy rather than regenerating it from directories.

### Surface adapters render; consumer adapters observe

Each surface has two narrow responsibilities:

- A projection adapter turns plan entries into consumer-native bytes and metadata. It cannot select components, choose owners, write files, or upgrade support tiers.
- A consumer adapter performs a declared verification stage against an immutable artifact and returns observations. It cannot mutate the artifact or clear orchestration/review gates.

Existing modules are migrated behind compatibility wrappers rather than copied into a parallel tree:

- `scripts/lib/agent-plugin-package.js`
- `scripts/lib/codex-native-package.js`
- `scripts/lib/cursor-plugin-package.js`
- Claude/inventory projection behavior in `scripts/lib/distribution-inventory.js` and `scripts/ci/validate-distribution.js`

Private helper extraction is allowed only when it makes these ports explicit; surface-specific content transforms stay with their surface.

### Orchestration coordinates; Sentinel enforces

Orchestration policy in `rules/execution-policy.md` and `skills/dhpk-execution-policy/references/` continues to decide which worker/reviewer runs, whether an existing agent is reused, how one corrected retry is linked, and when evidence is presented for acceptance. Sentinel scripts under `scripts/hooks/` continue to arm review debt, map slots, enforce freshness/verdict eligibility, and clear only through existing sanctioned reconciliation.

No new coordinator may delete a sentinel, synthesize a passing review artifact, or define an alternate verdict. No Sentinel hook may select or launch a worker. An orchestration lifecycle can be terminal while a Sentinel gate remains open; completion requires both terminal coordination and enforcement closure.

Projection `EvidenceResult` and reviewer evidence share identity principles but not clearance authority. When orchestration persists or consumes evidence, it binds task/attempt, dispatch/session, review wave or verification obligation, producer, stage, adapter version, plan/artifact fingerprints, scope, timestamp, and verdict. Missing or foreign identity is non-pass evidence.

### Characterization precedes migration

Before changing a surface call path, tests capture its selected IDs, destination tree, exact bytes, ordering, digests, symlink rejection/handling, diagnostics, stdout/stderr placement, and exit status. New contract tests run the legacy and compiler paths against the same fixtures and prove equivalence. Existing generated-package validators remain acceptance gates rather than being replaced by unit tests for the new compiler.

Migration uses one implementation behind each existing CLI. A temporary internal feature toggle is permitted only in tests or as a rollback composition choice; it is not documented as a second public version. Any unexplained behavior delta stops that surface's cutover.

## Risks / Trade-offs

- [Risk] Canonical serialization differs from current incidental ordering and changes generated bytes → Characterize ordering first, encode it explicitly in plans, and compare full trees byte-for-byte before cutover.
- [Risk] Centralizing filesystem code creates a high-impact failure point → Keep the store narrow, stage before publish, reject unplanned paths, add traversal/symlink/rollback tests, and migrate one surface at a time.
- [Risk] Inventory schema evolution accidentally overwrites hand-authored projection policy → Make reconciliation preservation explicit and test round-trip stability before enabling compiler reads.
- [Risk] Compatibility wrappers produce two writers for one surface → Require one composition point per CLI and a test that direct legacy materialization is unreachable after each cutover.
- [Risk] Structural PASS is reported as runtime support → Use closed verification stages and preserve current non-pass support states; runtime claims require consumer-runtime evidence.
- [Risk] Orchestration assumes a passing message clears review debt → Keep Sentinel clearance hook-owned and test terminal-lifecycle-plus-armed-sentinel as incomplete.
- [Trade-off] Frozen DTOs and fingerprints add ceremony → Accept the small cost because deterministic provenance is the mechanism that makes zero-breaking migration and fresh evidence auditable.

## Migration Plan

### Phase 1: Characterize and introduce contracts (independently shippable)

Add characterization fixtures/tests around existing generator and verifier behavior. Add inventory projection schema validation, frozen DTO/result helpers, the pure compiler, and an in-memory artifact store used only by tests. No production CLI changes. Rollback is removal of unused new modules and inventory fields while all legacy paths remain authoritative.

### Phase 2: Centralize safe materialization (independently shippable)

Add the filesystem `ProjectionArtifactStore` and prove staging, atomic publish, containment, explicit symlink policy, and rollback. Route one lowest-risk surface through it behind the existing CLI and compatibility wrapper only after full equivalence. Rollback composes the same CLI with its prior internal materializer; no user-facing contract changes.

### Phase 3: Migrate projection surfaces one by one (each independently shippable)

Migrate Agent Plugin, then Codex native, Cursor, and Claude/inventory projection based on characterization risk. For each surface: compile from inventory, render through its adapter, materialize through the store, verify through its consumer adapter, run existing validators, and remove only the now-dead duplicated helpers. Do not couple one surface's cutover to another.

### Phase 4: Bind orchestration evidence without replacing Sentinel (independently shippable)

Add evidence identity and handoff characterization to orchestration policy/tests. Route evidence presentation through existing sentinel reconciliation. Preserve all sentinel names, slots, hooks, and verdict behavior. Roll back by removing the additive evidence binding while leaving Sentinel enforcement unchanged.

### Phase 5: Remove compatibility residue (independently shippable)

After every surface passes equivalence and release gates, remove unreachable legacy selection/materialization helpers, keep existing public entry points, refresh architecture documentation, and run full distribution, harness, reference, and package validation. Residue removal is separate from functional cutovers so it can be reverted independently.

## Resolved Defaults

- Agent Plugin is the first production cutover. If Phase 1 equivalence fails, that cutover is `BLOCKED`; later surfaces do not move ahead to bypass the failed baseline.
- Projection symlinks default to `forbid`. Characterization may preserve an existing link only after adding an inventory-owned, in-root relative-link declaration and a focused containment test.
- Plan/artifact fingerprints extend the existing canonical reviewer artifact/evidence envelope and location governed by `docs/contracts/reviewer-contract.md`; implementation MUST NOT create a second evidence directory or verdict format.
