## 0. Dependency gate

- [ ] 0.1 Verify `harden-agent-architecture-governance` is implemented and passes its strict OpenSpec verification, compiler-contract tests, inventory-schema tests, ArtifactStore containment/rollback tests, and legacy compatibility gates; keep tasks 1-9 `BLOCKED` until this evidence exists.
- [ ] 0.2 Record the accepted `DistributionPlan`, `DistributionArtifact`, `EvidenceResult`, projection-adapter, and `ProjectionArtifactStore` interface versions consumed by this change; reject any duplicate lifecycle-local contract.

## 1. Baseline and contract fixtures

- [ ] 1.1 Record current Claude, `codex-sync`, `codex-native`, `agent-plugin`, and Cursor source/package layouts, receipt locations, support tiers, and verifier commands as characterization fixtures.
- [ ] 1.2 Add inventory fixtures for the 66 portable skills, the five `core` agents, the curated `extended` 12-agent set, and the `full` 31-agent set, including stable IDs, public names, lifecycle, source paths, and surface membership.
- [ ] 1.3 Add regression fixtures proving the 15-entry `codex-native` subset is rejected as an `agent-plugin` or Cursor portable selection with `WRONG_SURFACE`.
- [ ] 1.4 Add receipt fixtures for current, stale, malformed, cross-surface, user-edited, and foreign-owned artifacts, preserving existing surface-specific behavior.

## 2. Unified CLI and lifecycle result model

- [ ] 2.1 Implement strict parsing and normalization for `dhpk-install <surface> <action>` with the five approved surfaces, seven actions, exact scope/mode/source/offline/dry-run/yes/json options, Cursor `--agent-profile`/repeatable `--agent`, and pre-write rejection of unknown values.
- [ ] 2.2 Define the stable human/JSON result model containing normalized request, plan ID, receipt identity, stage statuses, ownership/collision diagnostics, consumer observations, and remediation.
- [ ] 2.3 Implement explicit semantics for `plan`, `install`, `verify`, `update`, `uninstall`, `rollback`, and `status`, including `dry-run`, `offline`, `yes`, and confirmation behavior.
- [ ] 2.4 Add the explicit-only `dhpk-install` skill with `disable-model-invocation: true`; route direct human invocations through the same CLI gates and add a regression check that advisory/model routing cannot execute them implicitly.

## 3. Compiler and ArtifactStore integration

- [ ] 3.1 Integrate `DistributionCompiler` as the sole plan builder for surface, scope, mode, source, profile, and explicit agent selections.
- [ ] 3.2 Define deterministic plan serialization and identity from normalized options, source revision, inventory digest, compiler/tool version, selected stable IDs, target roots, transforms, and expected fingerprints.
- [ ] 3.3 Integrate `ProjectionArtifactStore`/ArtifactStore staging with path containment, symlink policy, same-filesystem atomic commit checks, staged fingerprint verification, and failure diagnostics.
- [ ] 3.4 Implement fail-closed collision handling that preserves unowned, edited, foreign-receipt, and cross-surface paths without adoption or overwrite.
- [ ] 3.5 Implement transaction rollback for stage, validation, commit, and receipt-write failures, retaining the predecessor projection and proving no partial result was published.

## 4. Versioned receipts and ownership

- [ ] 4.1 Define and validate the versioned lifecycle receipt schema with owner/surface, plan, source, inventory, IDs/names, transforms, roots, fingerprints, mode, rollback predecessor fields, project `.dhpk/receipts/<surface>.json`, and user XDG-state locations.
- [ ] 4.2 Implement receipt read/migration behavior for existing surface-specific schemas without silently adopting an unproven owner or changing legacy behavior.
- [ ] 4.3 Restrict update, uninstall, prune, and rollback to receipt-owned entries whose recorded destination fingerprints still match; report edited entries as collisions.
- [ ] 4.4 Keep client-managed observation receipts separate from lifecycle receipts and bind observations to current plan/receipt IDs, client/version, command/UI evidence, and status.

## 5. Surface adapters and retained routes

- [ ] 5.1 Implement the Claude adapter using the existing package source, strict validator, target scope, receipt ownership, and support-tier evidence.
- [ ] 5.2 Implement the `codex-sync` adapter over the existing project-local installer and schema-v3 receipt, preserving copy/symlink, collision, update, uninstall, migration, and rollback semantics.
- [ ] 5.3 Implement the `codex-native` adapter over the retained physical package and marketplace route, preserving the experimental tier and separating structural results from real Codex consumer evidence.
- [ ] 5.4 Implement the `agent-plugin` adapter for root `plugin.json`, portable skill projection, package containment, provenance, and `--plugin-dir`/marketplace evidence.
- [ ] 5.5 Preserve marketplace and `--plugin-dir` routes while requiring both `dhpk-agent` and `dhpk-cursor` artifacts for a combined Cursor install and reporting missing artifacts as `BLOCKED`.

## 6. Cursor atomic bundle and profiles

- [ ] 6.1 Extend the inventory with the Cursor portable/native membership and profile SSOT, including exact `core`, `extended`, and `full` stable ID sets and expected counts.
- [ ] 6.2 Implement `--agent-profile core|extended|full` with Cursor's project/core/auto defaults and deterministic repeatable `--agent <id>` additions that accept only inventory-approved native IDs, deduplicate by stable ID, and reject arbitrary paths or wrong-surface IDs.
- [ ] 6.3 Implement the Cursor project-scope adapter that stages all 66 portable skills under `.agents/skills` and selected native agents under `.cursor/agents` in one ArtifactStore transaction.
- [ ] 6.4 Add two-root rollback tests proving a skill failure, agent failure, frontmatter failure, fingerprint mismatch, or receipt failure restores both roots and publishes no partial receipt.
- [ ] 6.5 Generate/validate `dhpk-agent` and `dhpk-cursor` package artifacts and verify that the 15-entry Codex-native package cannot satisfy a Cursor profile.

## 7. Verification, discovery, and manifest integrity

- [ ] 7.1 Extend lifecycle verification to compare exact inventory IDs, public names, required frontmatter, source/destination fingerprints, target roots, receipt owner/schema, stale entries, duplicates, and declared transforms.
- [ ] 7.2 Update agent discovery to exclude navigation/evidence files and count only valid inventory-owned definitions on each declared surface, including materialized `.cursor/agents`.
- [ ] 7.3 Add Cursor profile checks for exact core/extended/full sets and a real client discovery/dispatch nonce tied to the current plan/receipt and selected IDs.
- [ ] 7.4 Extend manifest-integrity check mode to regenerate deterministic plans/receipts and fail on profile, fingerprint, owner, wrong-surface, stale, or undeclared-entry drift.
- [ ] 7.5 Add consumer-gate aggregation for `INSTALL_PASS`, `CONSUMER_BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, `UNAVAILABLE`, and overall non-PASS behavior when applicable consumer evidence is absent.

## 8. Documentation and consumer evidence

- [ ] 8.1 Update the English and Traditional Chinese canonical installation guides with the unified command grammar, common options, receipt ownership, staging, rollback, and status taxonomy.
- [ ] 8.2 Document Codex project-local, Codex-native marketplace, Agent Plugin, Cursor standard, and Cursor-native routes with exact commands, retained fallback behavior, support tiers, and the 15-entry wrong-surface boundary.
- [ ] 8.3 Document Cursor’s 66-skill `.agents/skills` root, `.cursor/agents` profiles, repeatable agent additions, paired package requirement, atomic rollback, and discovery/dispatch nonce evidence.
- [ ] 8.4 Update the documentation drift gate and linked surface-specific READMEs to reject stale commands, contradictory support claims, missing links, and static-only runtime assertions.
- [ ] 8.5 Add evidence templates and rerun commands for unavailable Claude/Codex/Cursor clients; ensure client-managed observation receipts are never synthesized by static validation.

## 9. Verification and rollout gates

- [ ] 9.1 Run focused CLI, compiler, ArtifactStore, receipt, ownership, Cursor profile, rollback, discovery, consumer-gate, and documentation tests with captured results.
- [ ] 9.2 Run `npx openspec validate --strict --no-interactive --json` for this change and resolve every schema/spec diagnostic.
- [ ] 9.3 Run the repository’s applicable manifest, package, discovery, and consumer checks; record unavailable live-client probes as `NOT_RUN`/`BLOCKED`/`UNAVAILABLE` with resume commands.
- [ ] 9.4 Execute staged rollout in read-only `plan`/`status`/`verify` mode before enabling writes per adapter, preserving legacy surface commands and rollback paths.
- [ ] 9.5 Confirm no support tier is promoted without current consumer evidence and document any unresolved failure or no-ship boundary for the parent release flow.
