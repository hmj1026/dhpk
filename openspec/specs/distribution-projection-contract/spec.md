# distribution-projection-contract Specification

## Applicability policy (#848/#854)

The applicable installation, structural, and package contract is the default
acceptance boundary. Native workflow, rendered discovery, context measurement,
and full Host observation are required only for an affected integration,
activation defect, or explicit native request. Required failures remain
blocking; excluded or historical `NOT_RUN`, `UNAVAILABLE`, and `BLOCKED` results
remain visible and are never synthesized as `PASS`. Ownership, compatibility,
coexistence, rollback, publication, and manual authorization requirements remain
in force.

## Purpose

Define the deterministic, inventory-bound projection compiler, artifact-store,
and stage-bound verification contracts used by generated distribution surfaces.

## Requirements

### Requirement: Distribution compilation is pure and deterministic

The distribution layer SHALL expose a single `compileDistribution(inputs) -> DistributionPlan` contract. Compilation MUST validate boundary inputs, accept all selection context explicitly (including profile ID, stable-ID allowlist, compatibility mode, and selection-policy version), select entries only from the distribution inventory, resolve declared transforms and ownership, and return an immutable plan without reading undeclared ambient state or writing to the filesystem. Equivalent normalized inputs MUST produce the same plan and selection fingerprints and ordered output intents.

#### Scenario: Equivalent inputs compile identically

- **WHEN** canonical source fingerprints, inventory data, projection rules, profile selection, compatibility mode, and compiler version are unchanged
- **THEN** repeated compilation returns byte-equivalent normalized plans with the same plan and selection fingerprints

#### Scenario: Profile selection is undeclared

- **WHEN** a profile-aware adapter chooses membership without passing the normalized profile selector, stable-ID allowlist, and its closure to compilation
- **THEN** compilation rejects the boundary input and produces no materialization plan

#### Scenario: Compilation attempts an undeclared selection

- **WHEN** an adapter, directory layout, generated manifest, or profile alias implies a component that is absent from the selected inventory surface
- **THEN** compilation returns a structured validation error naming the undeclared component and produces no materialization plan

#### Scenario: Compiler observes ambient filesystem state

- **WHEN** a projection would require an undeclared directory scan, host configuration, clock value, or environment value to determine its outputs
- **THEN** compilation fails until that value is supplied explicitly through `inputs`

### Requirement: Distribution plans carry complete projection intent

A `DistributionPlan` SHALL carry its schema/compiler version, input and inventory fingerprints, target surface, normalized profile/compatibility identity, ordered canonical selected stable IDs, any declared emitted stable-ID set, selection-policy and selection fingerprints, canonical source identities, transforms, physical ownership, normalized destination paths, content fingerprints, symlink policy, and the inventory-owned usage/provenance identity for every emitted skill. The usage identity SHALL include the normalized usage schema version and usage fingerprint; the normalized usage contract SHALL include display name, summary, syntax, input kind, invocation class, maximum effect authority, actions, options, and examples. The provenance identity SHALL include inventory revision, canonical source identity and digest, source owner, transform identity, lifecycle/retirement state, public name, invocation class, and the external-package-ledger fingerprint. The canonical selection fingerprint SHALL subsume the normalized profile definition, inventory/source inputs, policy version, and canonical ordered IDs; a surface selection fingerprint MAY additionally bind emitted IDs, usage fingerprints, provenance, and the surface transform. The plan MUST contain enough information for materialization and atomic activation to execute without re-selecting packages, regenerating usage metadata, or inventing projection policy.

#### Scenario: Materializer receives a complete plan

- **WHEN** a valid profile or compatibility plan is passed to materialization
- **THEN** every output path, owner, transform, canonical/emitted stable ID, public name, invocation class, lifecycle state, usage contract/fingerprint, provenance identity, expected content fingerprint, profile/selection identity, external-ledger fingerprint, and link policy is already declared in the plan

#### Scenario: Plan omits projection provenance

- **WHEN** an output intent lacks a stable source ID, canonical source identity, profile/selection identity, transform identity, usage contract or fingerprint, external-ledger fingerprint, or expected content fingerprint
- **THEN** compilation returns a structured incomplete-plan error before any output can be written

#### Scenario: Adapter emits metadata not in the plan

- **WHEN** a materializer or adapter emits metadata, usage fields, provenance, or a public identity that is not declared by the accepted distribution plan
- **THEN** the projection gate rejects the output and reports the undeclared field without publishing it

### Requirement: Materialization is isolated behind ProjectionArtifactStore

The distribution layer SHALL expose `materializeDistribution(plan, adapter, artifactStore) -> DistributionArtifact`. `ProjectionArtifactStore` SHALL be the only projection-pipeline port permitted to create directories, write files, create permitted links, stage outputs, replace generated roots, or calculate post-write filesystem observations for managed projection trees that dhpk generates into its own checkout. Install-time writes into a consumer project remain owned by the Projection Receipt lifecycle owner and are outside this port. The materializer MUST follow the plan exactly, MUST NOT perform inventory selection, consumer verification, or active-root replacement, and MUST return a complete staged candidate for a separate activation gate to evaluate. The Agent Plugin, Codex native, Cursor plugin, Cursor sync, AGY, and Claude marketplace package build-time surfaces SHALL publish only through this port.

#### Scenario: Plan materializes successfully

- **WHEN** the adapter renders every planned output and the artifact store confirms the staged writes match the plan
- **THEN** materialization returns a staged `DistributionArtifact` bound to the plan and selection fingerprints and containing the physical output manifest and observed fingerprints without changing the active root

#### Scenario: Adapter emits an unplanned output

- **WHEN** the adapter attempts to write a destination or stable ID absent from the plan
- **THEN** the artifact store rejects the operation, leaves the accepted artifact unpublished, and returns a structured scope error

#### Scenario: Materialization fails before publication

- **WHEN** a write, link, digest, receipt, or atomic replacement fails in the staging area
- **THEN** the previously accepted generated surface and active receipt remain intact and the result identifies the failed planned output

#### Scenario: Activation waits for required evidence

- **WHEN** a staged artifact has not yet received `PASS` evidence for every inventory-declared required runtime surface
- **THEN** the separate activation gate leaves the prior active root and receipt unchanged and reports the missing or non-pass surface rows

#### Scenario: Build-time generator has no private writer

- **WHEN** the AGY, cursor-sync, or Claude marketplace package generator produces its tree
- **THEN** every directory, file, and link in that tree is created by the artifact store session and the generator holds no private stage, backup, or rename code

### Requirement: Symlink behavior is explicit and fail-closed

Every projection SHALL declare a symlink policy in inventory-owned projection rules. The default policy SHALL be `forbid`. The closed policy vocabulary SHALL be `forbid`, `contained-relative`, and `declared-source-relative`. A `contained-relative` link MUST resolve within the declared artifact ownership root. A `declared-source-relative` link MUST be owned by the destination root, MUST resolve its target relative to the link's own directory at its final published location, and MUST land within the canonical source root bound to the plan; this mode is used by the `codex-sync` and `cursor-sync` checkout-to-project routes. Every permitted link MUST be relative, MUST have a stable source/output identity, and MUST be represented in both `DistributionPlan` and `DistributionArtifact`; absolute links, escaping targets, ambient links discovered during traversal, and undeclared dereferencing MUST be rejected after the current absolute-link behavior is characterized.

#### Scenario: Projection contains an undeclared symlink

- **WHEN** a canonical source or staged output contains a symlink but the selected projection policy is `forbid`
- **THEN** compilation or materialization fails with the link path and no accepted artifact is published

#### Scenario: Declared relative link remains within its owner

- **WHEN** the inventory explicitly permits a relative link whose normalized target remains inside the declared artifact ownership root
- **THEN** the plan records the link intent and materialization verifies the created link without silently copying or dereferencing it

#### Scenario: Link target escapes its owner

- **WHEN** a declared or encountered link resolves outside its artifact ownership root
- **THEN** the projection fails closed regardless of whether the target exists

#### Scenario: Source-relative link resolves from its own directory

- **WHEN** a `declared-source-relative` link at `cursor/skills/<name>` has target `../../skills/<name>` and the plan-bound source root is the repository root
- **THEN** the store accepts the link because the target resolved from the link's directory lands inside the source root

#### Scenario: Stage root and publish root differ in depth

- **WHEN** a `declared-source-relative` link is staged at a different directory depth than its final publish location
- **THEN** the store judges the link by its final location, so a target valid there is accepted and one that escapes the source root from there is rejected

#### Scenario: Source-relative link leaves the source root

- **WHEN** a `declared-source-relative` link's target resolved from the link's own directory lands outside the plan-bound source root
- **THEN** the store rejects the link with a link-escape failure and publishes nothing

### Requirement: Verification returns stage-bound evidence

The distribution layer SHALL expose `verifyDistribution(stage, artifact, consumerAdapter) -> EvidenceResult`. Verification MUST use a declared verification stage and consumer adapter, MUST NOT mutate the accepted artifact, and MUST return structured evidence binding the stage, adapter identity/version, target surface, profile/compatibility identity, selected stable IDs, plan, artifact, selection fingerprints, usage/provenance fingerprints, checked claims, observed outputs, verdict, and diagnostics. `EvidenceResult.verdict` MUST remain exactly `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE`; lifecycle summary codes are not valid projection verdicts. A passing structural, package, budget, or rollback stage MUST NOT be promoted to consumer-runtime support without an independent configured runtime stage.

#### Scenario: Structural verification passes

- **WHEN** the requested structural stage confirms a profile materialized output manifest, usage/provenance metadata, and fingerprints against the plan
- **THEN** the evidence result records a passing structural verdict without upgrading any runtime support tier

#### Scenario: Consumer verification uses stale artifact identity

- **WHEN** the requested profile, selection, usage, provenance, or artifact fingerprint differs from the artifact identity observed by the consumer adapter
- **THEN** verification returns a stale-evidence failure and does not reuse an earlier passing verdict

#### Scenario: Adapter does not support a requested stage

- **WHEN** a consumer adapter cannot execute the declared verification stage
- **THEN** the result uses the configured non-pass support state such as `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, or `UNAVAILABLE` rather than reporting success

#### Scenario: Installation acceptance does not promote runtime support

- **WHEN** the current consumer gate accepts a selected installation while its raw runtime observation is `NOT_RUN`
- **THEN** the projection evidence remains bound to its requested structural or package stage and does not claim consumer-runtime support
- **AND** the separate [consumer acceptance contract](../../../docs/contracts/consumer-acceptance.md) remains the authority for that installation result

### Requirement: Projection contracts use one structured result strategy

Compilation, materialization, and verification SHALL return explicit success or structured failure results with stable codes, stage, affected stable IDs/paths, and causal diagnostics. Core projection contracts MUST NOT mix exceptions, `null`, process exits, and ad hoc `{error}` payloads as caller-visible failure strategies. Existing CLIs SHALL translate the structured result at their interface boundary while preserving characterized messages, ordering, and exit codes.

#### Scenario: Core operation rejects invalid input

- **WHEN** any projection stage rejects input or execution
- **THEN** its caller receives a structured failure result and no partially successful value

#### Scenario: Existing CLI exposes the failure

- **WHEN** a migrated CLI receives a structured projection failure corresponding to a characterized legacy failure
- **THEN** the CLI emits the same observable diagnostic and exit code as the legacy implementation

### Requirement: Projection migration is characterization-gated

Each existing distribution surface SHALL be characterized before it is routed through the shared projection contracts. A migrated surface MUST preserve selected stable IDs, output paths, bytes, ordering, transforms, ownership, link behavior, diagnostics, and exit codes for the same inputs. A profile-scoped Claude surface MUST additionally characterize profile closure, scoped roots, compatibility output, and rollback behavior. A behavior difference SHALL block that surface's migration unless an additive or breaking contract change is separately approved.

#### Scenario: Characterized profile surface is unchanged

- **WHEN** the legacy unscoped Claude path and the contract-based profile pipeline run against the same compatibility fixture
- **THEN** their normalized plans, materialized artifacts, diagnostics, and process outcomes match the characterized compatibility contract

#### Scenario: One migrated surface drifts

- **WHEN** a staged migration changes any characterized observable for one consumer surface or profile
- **THEN** that surface/profile remains on the prior implementation while independently migrated surfaces remain shippable

#### Scenario: Characterized surface is unchanged

- **WHEN** a migrated surface produces the same selected IDs, output paths, bytes, ordering, transforms, ownership, diagnostics, and exit status as its characterization fixture
- **THEN** the surface passes the equivalence gate and may proceed to the shared projection pipeline

#### Scenario: Rollback is required

- **WHEN** a migrated surface fails equivalence, verification, or publication checks
- **THEN** the prior characterized implementation remains authoritative and the migration can be rolled back without mutating canonical sources

### Requirement: Surface selection policy is compiler-owned

The distribution compiler SHALL resolve surface membership from the inventory-owned `projection_contract` policy before any surface adapter expands output. Each migrated surface MUST declare its selection source and precedence. Adapters MUST receive selected canonical IDs and MUST NOT reselect membership from directories, generated manifests, or consumer-native output.

#### Scenario: Declared policy selects a surface

- **WHEN** a migrated surface has a valid inventory policy and its referenced membership data resolves
- **THEN** the compiler returns the deterministic selected canonical IDs and the adapter receives only those IDs for expansion

#### Scenario: Adapter attempts independent selection

- **WHEN** a migrated surface adapter discovers an inventory entry not present in the compiler-selected IDs
- **THEN** the compiler or validation gate rejects the extra entry and no accepted artifact includes it

#### Scenario: Policy is missing or unsupported

- **WHEN** a migrated surface lacks a declared selection policy or names an unsupported policy source or precedence
- **THEN** compilation returns a structured policy validation failure before materialization

### Requirement: Projection intent binds external ownership provenance

Every compiler-owned distribution plan SHALL include the normalized `external_skill_packages` fingerprint alongside its inventory fingerprint before profile or surface selection is materialized. A plan SHALL preserve selected protected skills as existing canonical inputs and SHALL NOT interpret the ledger as a request to discover, download, adapt, or publish new upstream content.

#### Scenario: Projection compiles protected existing skills

- **WHEN** a selected surface includes one or more stable IDs protected by the external ledger
- **THEN** its plan binds the ledger fingerprint and emits the inventory-selected canonical packages without content transformation beyond the surface's already declared transform

#### Scenario: Projection omits ownership provenance

- **WHEN** a compiler or adapter emits a plan or evidence record without the current external ledger fingerprint
- **THEN** validation fails before materialization and leaves the prior publication artifact unchanged

### Requirement: Projection metadata is usage- and provenance-bound

Every generated projection SHALL derive each skill's usage contract and provenance from the same inventory revision used for selection. A projection MAY transform presentation for its declared surface, but it MUST preserve the normalized usage meaning, canonical source identity, ownership, retirement state, and external-package-ledger identity. Usage or provenance changes MUST alter the relevant fingerprint and require an explicit inventory or source change; output-byte or entry-count equality alone is insufficient evidence of parity.

#### Scenario: Usage and provenance are projected consistently

- **WHEN** two surfaces compile the same selected canonical IDs from the same inventory revision
- **THEN** their normalized usage contracts and provenance identities match for equivalent entries, and each plan records the same inventory and external-ledger fingerprints

#### Scenario: Usage metadata drifts silently

- **WHEN** a surface changes syntax, actions, options, examples, invocation class, or effect authority without a declared source or inventory change
- **THEN** projection validation fails with the affected stable ID and usage-fingerprint mismatch before publication

#### Scenario: Ownership provenance drifts silently

- **WHEN** a surface changes canonical source identity, owner, transform, lifecycle/retirement state, public name, invocation class, or external-package-ledger fingerprint without a declared policy change
- **THEN** projection validation fails with the affected stable ID and provenance-field mismatch before publication

### Requirement: Retired identities are excluded from projection plans

The compiler SHALL reject retired stable IDs, retired version-specific aliases, and historical public names as selected projection inputs. They MUST NOT appear in generated discovery, profile, package, or consumer-runtime artifacts. A dhpk-owned diagnostic MAY identify the canonical successor and selector, but that diagnostic MUST NOT create an emitted entry or executable compatibility alias.

#### Scenario: Version alias reaches the compiler

- **WHEN** a selection or surface membership input contains one of the retired Laravel/PHPUnit version-specific IDs or its historical public name
- **THEN** compilation fails closed with a retirement diagnostic naming the canonical family and selector, and produces no materialization intent

#### Scenario: Retired alias appears in an artifact

- **WHEN** a generated manifest, package, or staged artifact contains a retired stable ID, old path, symlink, or discovery entry
- **THEN** projection validation fails before publication and reports the surface, path, and retired identity

### Requirement: Replacing an existing generated root requires proven ownership

`ProjectionArtifactStore` SHALL refuse to replace an existing publish root that this surface did not produce. Before activation the store MUST require that an existing root is a physical directory and passes the ownership verification supplied for the surface; a missing root passes. A refused replacement MUST leave the existing tree byte-unchanged and report a structured ownership failure. A surface MAY supply a stricter verification than the store default, and the store MUST NOT interpret Host receipt schemas itself. The store's guarantees end at activation verification: it does not detect or lock out writes to the existing publish root between verification and removal of the previous-tree backup, and such writes may be lost with the backup. Concurrent-write safety is not provided; do not edit a projection while a sync runs. This limitation applies to every surface that publishes through the store.

#### Scenario: Foreign directory occupies the publish root

- **WHEN** the publish root exists and holds content without a matching owner receipt
- **THEN** activation fails with an ownership failure and the foreign tree is unchanged

#### Scenario: Symlink occupies the publish root

- **WHEN** the publish root is a symlink or a regular file
- **THEN** activation fails with an ownership failure and nothing is replaced

#### Scenario: Owned root is replaced

- **WHEN** the publish root holds a tree whose ownership verification passes
- **THEN** activation replaces it atomically with the staged tree

#### Scenario: Non-generated siblings of an owned subdirectory survive

- **WHEN** a surface publishes owned subdirectories under a directory that also holds tracked non-generated files (such as `cursor/AGENTS.md` and `cursor/guidance.md`)
- **THEN** only the owned subdirectories are replaced and the sibling files are unchanged

#### Scenario: First publish has no existing root

- **WHEN** the publish root does not exist
- **THEN** activation publishes the staged tree without an ownership failure

#### Scenario: Write lands in the old tree after verification

- **WHEN** an external process writes a file into the existing publish root after ownership verification passes and before the previous-tree backup is removed
- **THEN** the store does not detect the write, the file is not carried into the published tree and may be lost with the backup, and no concurrent-write safety is claimed

### Requirement: Activation outcome is not reversed by cleanup

Once the staged tree has been renamed into the publish root, the store SHALL report the publish as successful. Removal of the previous-tree backup MUST be a separate best-effort step; its failure MUST NOT roll back, mask, or undo the published tree and MUST surface as a warning in the activation result. Rollback applies only when the stage rename itself fails.

#### Scenario: Backup cleanup throws after a successful rename

- **WHEN** removing the backup fails after the stage was renamed into the publish root
- **THEN** the publish root holds the new tree, activation returns success with a cleanup warning, and no rollback occurs

#### Scenario: Stage rename fails

- **WHEN** renaming the stage into the publish root fails
- **THEN** the previous tree is restored to the publish root and activation fails

### Requirement: Staging leftovers from killed processes are cleaned

`ProjectionArtifactStore.begin` SHALL remove `.projection-stage-*` and `.projection-backup-*` directories in the store root that were left by processes that no longer exist, and MUST NOT remove the current session's directories or a directory belonging to a live process.

#### Scenario: Killed build left a stage directory

- **WHEN** `begin` runs and the store root contains a stale stage directory from a dead process
- **THEN** that directory is removed before the new stage is created

#### Scenario: Concurrent live stage is preserved

- **WHEN** the store root contains a stage or backup directory owned by a live process
- **THEN** `begin` leaves it untouched

### Requirement: Path-safety predicates have one implementation

The store and the Projection Receipt publisher SHALL use one shared implementation of the relative-path, link-target, and containment predicates. The shared predicates MUST reject at least everything either prior implementation rejected: empty values, NUL bytes, backslashes, absolute paths, any drive prefix, `.`, `..`, and empty segments, and non-normalized link targets. The publisher MUST keep its existing error codes and messages.

#### Scenario: Bare drive prefix is rejected

- **WHEN** a destination or link target begins with a drive prefix such as `C:` with no separator
- **THEN** both the store and the publisher reject it

#### Scenario: Non-normalized link target is rejected

- **WHEN** a link target contains `.` or empty segments or differs from its normalized form
- **THEN** both the store and the publisher reject it

#### Scenario: Existing planned paths remain valid

- **WHEN** the current plans of the Agent Plugin, Codex native, Cursor plugin, and Claude profile surfaces are checked against the shared predicates
- **THEN** none of their destinations or link targets is newly rejected

### Requirement: Store fingerprints are order-independent

The `artifactFingerprint` computed by the store SHALL be independent of emission order, provided no persisted value embeds the prior order-dependent digest; if one does, the store SHALL keep emission order and this requirement does not apply to that digest.

#### Scenario: Same outputs in different order

- **WHEN** two sessions write the same outputs and links in different orders
- **THEN** both report the same `artifactFingerprint`

### Requirement: Migrated build-time outputs are byte-identical

Moving AGY, cursor-sync, or the Claude marketplace package behind the store SHALL NOT change any generated byte, file mode, link target, or fingerprint. Receipt files (`fingerprints.json`, `provenance.json`) SHALL remain rendered by the Host Adapter through the platform-provenance module as planned outputs using fingerprints the store computed at stage time; the store SHALL NOT know Host receipt schemas.

#### Scenario: Generator check is unchanged

- **WHEN** the migrated generator runs with `--check` against the committed output
- **THEN** it reports no difference and the published fingerprints equal the pre-migration values

#### Scenario: Output regenerated outside the checkout

- **WHEN** the surface is regenerated into a directory outside the checkout from the same inputs
- **THEN** the tree is byte-identical to the pre-migration tree

### Requirement: Local skills sync publishes through the store

The in-checkout branch of `materializeAgentsSkillsProjection` SHALL publish `.agents/skills` through `ProjectionArtifactStore`; `writeAtomicJson` and its private journal, stage, and backup SHALL NOT exist. Replacing an existing `.agents/skills` SHALL require its `.dhpk-projection.json` receipt. Without a receipt a non-empty `.agents/skills` SHALL be refused with `NO_OWNER_RECEIPT`, and that message SHALL name `--preserve-unmanaged`. The explicit `--preserve-unmanaged` opt-in (generator CLI `gen-agents-skills.js` and `npm run sync:local-skills`, in-checkout projection only) SHALL let the sync create the first projection over a receipt-less tree only when every top-level entry is non-reserved under the same fold rule and holds only regular files, carrying those files with identical bytes and modes as unmanaged entries: never in the receipt's ownership or fingerprints, reported as preserved, guarded by the same planning-to-activation drift check, with empty directories not carried. With the opt-in and no receipt the sync SHALL still refuse with structured `OWNERSHIP_REFUSED` and leave the tree unchanged for any exact or case-equivalent reserved-name collision (including file/directory prefix conflicts), any symlink or non-regular file, and any change between planning and activation; a missing receipt never authorizes overwriting a possible former dhpk projection. An existing but invalid receipt SHALL NOT be bypassed by the opt-in, and with a valid receipt the opt-in changes nothing. The opt-in SHALL NOT acquire ownership of the preserved entries, and its name and help text SHALL NOT imply that it does. The authorization is verification for this surface only; other `ProjectionArtifactStore` surfaces keep refusing a root without owner proof. A reserved name is `N` or `N.md` for every skill the sync generates, renames from, retires, or keeps from the prior receipt. Reserved-name matching SHALL compare names after one normalization applied to both sides and identical on every Host and filesystem: Unicode NFC, then locale-independent `toLowerCase()`, with the `.md` suffix stripped after folding. An unmanaged top-level entry whose folded name equals the folded form of a reserved name, while not an exact-case match, SHALL be refused with structured `OWNERSHIP_REFUSED` naming both the entry and the reserved name, leaving the tree and receipt unchanged; this includes a file and a directory that differ only by case. Exact-case behavior is unchanged, and two unmanaged entries that are case-equivalent only to each other keep their current behavior. A top-level entry whose name is neither reserved nor the receipt is unmanaged: the sync SHALL carry its regular files into the published tree with identical bytes and modes, SHALL NOT record them in the receipt, and SHALL report the preserved top-level names on standard output. The sync SHALL refuse the replace and leave the tree unchanged when a file at or under a reserved name is not owned by the receipt, when an unmanaged entry holds a symlink or other non-regular file, or when the unmanaged files change between planning and activation. Carried entries (kept from the prior receipt but no longer selected) and legacy-released entries SHALL be captured as one planned snapshot of bytes and modes; a modern carried file whose content does not match its prior receipt fingerprint SHALL be refused, never released or re-fingerprinted, and the sync SHALL refuse the replace and leave the tree as it stands at refusal when a preserved file is added, removed, modified, re-moded, or replaced by a symlink between planning and activation. The receipt SHALL NOT publish a carried fingerprint that disagrees with the carried bytes. These checks cover changes up to activation verification; they do not guard writes between verification and the atomic rename. Empty unmanaged directories are not carried. `npm run sync:local-skills` SHALL keep its command-line contract and SHALL forward its extra arguments, including `--preserve-unmanaged`, to both the generator and the validator, and the receipt SHALL be byte-identical whether or not unmanaged entries are present.

#### Scenario: Local sync runs through the store

- **WHEN** `npm run sync:local-skills` runs in a repository
- **THEN** `.agents/skills` and its receipt are byte-identical to the previous implementation's output and no private journal or backup is created

#### Scenario: Unmanaged skill directories are preserved

- **WHEN** `.agents/skills` holds a third-party skill directory such as `gitnexus-cli/` whose name is not reserved
- **THEN** the sync updates the managed skills, the third-party files keep their bytes and modes, the receipt is byte-identical to the receipt produced without the third-party directory, and the preserved name is reported on standard output

#### Scenario: Empty unmanaged directory is dropped

- **WHEN** `.agents/skills` holds an empty unmanaged directory
- **THEN** the sync succeeds and the directory is absent from the published tree

#### Scenario: Unmanaged content inside a managed skill blocks the replace

- **WHEN** a directory with a reserved name contains a file its receipt does not list
- **THEN** the sync refuses the replace and the tree is unchanged

#### Scenario: Unmanaged entry at a reserved name blocks the replace

- **WHEN** a newly selected skill `N` would be generated and `.agents/skills` already holds an unmanaged `N/` or `N.md`
- **THEN** the sync refuses the replace and the tree is unchanged

#### Scenario: Case-variant of a reserved name blocks the replace

- **WHEN** `.agents/skills` holds an unmanaged top-level entry such as `Code-Trace/` or `Code-Trace.MD` whose name differs only by case or Unicode normalization from a selected, carried, renamed-from, retired, or shim reserved name such as `code-trace`
- **THEN** the sync refuses the replace with `OWNERSHIP_REFUSED` naming both names, on every Host, and the tree and receipt are unchanged

#### Scenario: Case-only file and directory conflict blocks the replace

- **WHEN** an unmanaged file differs only by case from a reserved directory name, or an unmanaged directory differs only by case from a reserved shim file name
- **THEN** the sync refuses the replace with `OWNERSHIP_REFUSED` naming both names and the tree is unchanged

#### Scenario: Unmanaged symlink or non-regular file blocks the replace

- **WHEN** an unmanaged entry is or contains a symlink or another non-regular file
- **THEN** the sync refuses the replace and the entry and any symlink target are unchanged

#### Scenario: Symlink refusal names the path and gives recovery guidance

- **WHEN** the sync refuses because an unmanaged top-level entry is a symlink or contains one
- **THEN** the refusal keeps the stable `UNMANAGED_SYMLINK` code, names the relative path of the link, states whether it is the top-level entry or a nested path, and advises replacing the link with a real directory copy or moving it outside `.agents/skills` while syncing and restoring it afterwards
- **AND** the guidance does not suggest automatic dereferencing or deletion, no symlink is followed, copied, deleted, or relocated, and `node scripts/ci/gen-agents-skills.js --update` and `npm run sync:local-skills` surface the same text

#### Scenario: Unmanaged files change before activation

- **WHEN** an unmanaged file is added, removed, or modified after planning and before activation
- **THEN** the sync refuses the replace and the tree is unchanged

#### Scenario: Carried content changes before activation

- **WHEN** a carried or legacy-released file is modified, re-moded, removed, added to its entry, or replaced by a symlink after planning and before activation
- **THEN** the sync refuses the replace with `OWNERSHIP_REFUSED` and the active tree and receipt are unchanged from their state at refusal

#### Scenario: Modern carried file does not match its receipt

- **WHEN** a carried file of a deselected entry does not match the fingerprint in the prior `tree-merkle-v1` receipt when planning begins
- **THEN** the sync refuses with `OWNERSHIP_REFUSED`, does not release the entry or refresh its fingerprint, and the tree and receipt are unchanged

#### Scenario: Receipt-less tree is refused by default

- **WHEN** `.agents/skills` holds third-party entries and no `.dhpk-projection.json`, and the sync runs without `--preserve-unmanaged`
- **THEN** the sync refuses with `NO_OWNER_RECEIPT`, the message names `--preserve-unmanaged`, and the tree is unchanged

#### Scenario: Opt-in initializes beside non-colliding third-party entries

- **WHEN** `.agents/skills` holds only non-reserved regular-file entries such as `gitnexus-cli/` and no receipt, and `gen-agents-skills.js --update --preserve-unmanaged` or `npm run sync:local-skills -- --preserve-unmanaged` runs
- **THEN** the projection is created, the third-party files keep their bytes and modes, they are absent from the receipt's managed paths and fingerprints, the preserved names are reported on standard output, and a later `--update` without the option succeeds and still preserves them

#### Scenario: Opt-in still refuses collisions, unsafe files, and invalid receipts

- **WHEN** the opt-in runs with no receipt and an entry has an exact or case-equivalent reserved name, a file/directory prefix conflict, a symlink or non-regular file, or when an existing receipt is invalid, or an unmanaged file changes between planning and activation
- **THEN** the sync refuses (structured `OWNERSHIP_REFUSED` for collisions and drift) and the tree is unchanged

#### Scenario: Opt-in with a valid receipt is a no-op

- **WHEN** `--preserve-unmanaged` is passed and a valid receipt exists
- **THEN** the sync behaves as it does without the option

#### Scenario: Legacy writers are gone

- **WHEN** `scripts/lib/agents-skills-package.js` is searched for its own write path
- **THEN** it contains no journal, backup, or atomic-JSON writer of its own

### Requirement: Every Host Adapter exposes compile, materialize, and verify

Each Host Adapter (Agent Plugin, Codex native, Codex sync, Cursor plugin, Cursor sync, AGY, Claude) SHALL expose `compile`, `materialize`, and `verify`, with `render` and `validate` consumed by `materializeDistribution`. The Claude compile, skill-root generation, and verify operations SHALL live in a Claude Host Adapter module outside `scripts/lib/distribution-inventory.js`, with unchanged behavior for existing callers.

#### Scenario: Adapter lacks an operation

- **WHEN** an adapter contract test loads each registered Host Adapter
- **THEN** each exposes all three operations as functions

#### Scenario: Claude operations moved without behavior change

- **WHEN** the Claude generators and validators run after the move
- **THEN** their outputs, diagnostics, and exit codes equal those recorded before the move
