## 1. Contract and inventory

- [x] 1.1 Add `agent-plugin` and `cursor-plugin` surfaces to the distribution inventory schema and update its structural validator.
- [x] 1.2 Add a machine-readable platform capability/projection matrix with stable IDs, public names, source paths, transforms, fallbacks, and evidence states.
- [x] 1.3 Define the portable-frontmatter allowlist and the client-owned metadata boundary for Claude, Codex, and Cursor.
- [x] 1.4 Record the current legacy Codex, project-local Codex, standard Agent Plugin, and Cursor support tiers in the English and Traditional Chinese docs.

## 2. Agent Plugins package

- [x] 2.1 Implement `scripts/lib/agent-plugin-package.js` and `scripts/ci/gen-agent-plugin-package.js` for deterministic `plugins/dhpk-agent/` materialization.
- [x] 2.2 Generate a closed-schema root `plugin.json` with release metadata and no Codex/Cursor-only top-level fields.
- [x] 2.3 Project only inventory-selected skills into fixed immediate-child `skills/` directories and normalize Agent Skills frontmatter.
- [x] 2.4 Add optional standard `mcp.json` generation with schema/version matching, transport validation, and independent-entry failure isolation.
- [x] 2.5 Add package-boundary, symlink, path, unknown-field, and deterministic fingerprint/provenance validation for the standard package.
- [x] 2.6 Add fixtures covering invalid manifests, invalid sibling skills, escaping paths, missing MCP, invalid MCP entries, and repeated generation.

## 3. Codex compatibility and migration

- [x] 3.1 Preserve the existing `codex-sync` installer, schema-v3 receipt, collision handling, and project-local documentation unchanged in behavior.
- [x] 3.2 Keep `plugins/dhpk/` and both `.codex-plugin/plugin.json` manifests as an explicitly legacy/experimental Codex surface; add a gate proving it is not counted as Agent Plugins conformance.
- [x] 3.3 Extend release parity/provenance to compare standard Agent Plugin, legacy Codex, and project-local Codex artifacts without sharing ownership.
- [x] 3.4 Add a real Codex standard-package consumer probe with `PASS`, `UNAVAILABLE`, `BLOCKED`, and `NOT_RUN` outcomes; do not graduate native support from static evidence.
- [x] 3.5 Update Codex README, distribution docs, and rollback guidance with the separate standard-versus-legacy matrix.

## 4. Cursor projection

- [x] 4.1 Implement `scripts/lib/cursor-plugin-package.js` and `scripts/ci/gen-cursor-plugin-package.js` for deterministic `plugins/dhpk-cursor/` materialization.
- [x] 4.2 Generate `.cursor-plugin/plugin.json` with valid relative component paths and no embedded secrets.
- [x] 4.3 Adapt and validate selected `rules/`, `agents/`, `commands/`, `hooks/hooks.json`, `skills/`, and `variables` against the current Cursor reference contracts.
- [x] 4.4 Add Cursor marketplace/local fixture metadata and a package-boundary/variable/hook validator.
- [x] 4.5 Add a Cursor local consumer smoke gate and report unavailable client tooling without converting it to PASS.
- [x] 4.6 Document the portable Agent Plugin path versus the Cursor-native package and publish a rollback that touches only Cursor-owned artifacts.

## 5. Cross-platform discovery and parity

- [x] 5.1 Extend configured-platform resolution with Cursor markers and explicit target semantics while preserving `NOT_CONFIGURED`, `BLOCKED`, `FAIL`, and `SKIP_INCOMPATIBLE` behavior.
- [x] 5.2 Add Cursor capability rows for portable skills/MCP and native rules/agents/commands/hooks/variables with named fallbacks.
- [x] 5.3 Extend agent discovery to the Cursor `agents/` surface and exclude navigation, receipts, provenance, fingerprints, and resource Markdown.
- [x] 5.4 Extend invocation and metadata parity tests so Codex `openai.yaml`, portable Agent Skills metadata, Claude flags, and Cursor policy remain separate but identity-consistent.
- [x] 5.5 Add owner-scoped receipts for every generated surface and prove migration/collision/rollback cannot cross surface ownership.

## 6. Canonical installation documentation

- [x] 6.1 Create `docs/platform-installation.md` and `docs/platform-installation.zh-TW.md` as the bilingual installation SSOT, with a surface matrix, prerequisites, exact commands/UI steps, version assumptions, the canonical taxonomy (`PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, `UNAVAILABLE`), and links to normative specifications.
- [x] 6.2 Document the Supported Codex project-local flow: standalone checkout invocation (`bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh`) versus Claude plugin runtime invocation (`${CLAUDE_PLUGIN_ROOT}`), project-root heuristic, default symlink versus `--copy`, `--update`, `--migrate`, `--uninstall`, guarded `--force`, schema-v3 receipt, collision handling, verification, and rollback.
- [x] 6.3 Document the retained Codex legacy/native flow: `codex plugin marketplace add <repo-or-path>`, `codex plugin add dhpk@dhpk`, local marketplace prerequisites, generated artifact/provenance checks, experimental labeling, and `UNAVAILABLE`/`BLOCKED` behavior when the CLI or route is absent.
- [x] 6.4 Document the standard Agent Plugin route separately from the legacy Codex route, including root `plugin.json`, fixed `skills/`, optional `mcp.json`, client-specific installation caveats, and the rule that structural conformance is not runtime proof.
- [x] 6.5 Document Cursor standard installation: Cursor Customize/Plugins flow, local `~/.cursor/plugins/local/dhpk-agent` flow, reload/update/remove, skills/MCP verification, and the explicit absence of Cursor-native parity.
- [x] 6.6 Document Cursor Plugin installation: local `~/.cursor/plugins/local/dhpk-cursor`, `.cursor-plugin/marketplace.json`/reviewed marketplace source, reload/configure, variables and secret handling, rules/agents/commands/hooks verification, refresh/update/remove, and Cursor-only rollback.
- [x] 6.7 Update or cross-link every explanatory file that mentions Codex, Cursor, plugin installation, marketplace, or distribution: root README pair, `docs/basic-operations*`, `docs/configuration*`, `docs/distribution-surfaces*`, `docs/skill-platform-migration*`, `codex/README*`, `codex/AGENTS.md`, `.codex-plugin/README.md`, `plugins/dhpk/README*`, and new package READMEs.
- [x] 6.8 Add a documentation inventory and reference-integrity test that detects stale commands, missing surface/status labels, broken bilingual links, and install instructions that do not point to the canonical guide.

## 7. Documentation and release gates

- [x] 7.1 Add source/package/consumer release-gate output for standard Agent Plugin and Cursor projections, retaining legacy Codex gates.
- [x] 7.2 Add docs/reference-integrity and exact-count coverage for new manifests, package paths, marketplace entries, installation commands, and status labels.
- [x] 7.3 Add changelog/release evidence guidance that records client versions, source commit, inventory digest, package fingerprints, install route, and unexecuted gates.
- [x] 7.4 Ensure generated package READMEs are derived or checked against the canonical installation guide and do not become an independent command SSOT.

## 8. Verification and rollout

- [x] 8.1 Run focused generator, validator, metadata, discovery, provenance, and documentation tests for the new surfaces.
- [x] 8.2 Run the standard package consumer probe and record `NOT_RUN`/`UNAVAILABLE` when the Codex CLI is absent.
- [x] 8.3 Run the Cursor local consumer probe when the supported Cursor environment is available; otherwise retain a blocked evidence record.
- [x] 8.4 Run strict OpenSpec validation and reconcile every requirement with a task before implementation handoff.
- [x] 8.5 Obtain code, security, and documentation review of generated paths, secret handling, install commands, and support-tier wording before any release artifact is published.

## 9. Flatten shared portable skill ownership

- [x] 9.1 Add an inventory projection mode that makes `agent-plugin` the shared physical owner for identical portable skills and permits Cursor copies only as explicit overlays.
- [x] 9.2 Make the Cursor generator/validator/provenance native-only by default, with shared skill IDs recorded but no duplicate `skills/` tree.
- [x] 9.3 Update package/release/discovery gates and fixtures to prove one physical shared skill store and explicit overlay behavior.
- [x] 9.4 Update bilingual installation/docs and evidence wording so Cursor native installation reuses the standard skill package by default.
