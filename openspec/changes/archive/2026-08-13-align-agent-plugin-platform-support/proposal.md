## Why

dhpk already ships a Claude Code plugin, a project-local Codex skill
projection, and an experimental Codex marketplace package, but those surfaces
use different manifests and metadata contracts. The current Codex package uses
`.codex-plugin/plugin.json` with client-specific fields and therefore is not a
portable Agent Plugins 1.0.0 package with a root `plugin.json`; meanwhile
Cursor can load the portable standard but has no dhpk projection for its
Cursor-only rules, agents, commands, hooks, and variables.

The Agent Plugins specification is a working-draft, vendor-neutral portability
floor, not a replacement for each client's installation, trust, or UI policy.
This change makes that boundary explicit, gives the repository one inventory-
driven projection model, and prevents Codex/Cursor support claims from being
inferred from a static file or a marketplace entry.

## What Changes

- Add an inventory-declared `agent-plugin` publication surface for a generated,
  schema-valid Agent Plugins 1.0.0 package rooted at `plugin.json`.
- Keep the current `codex-native` package and project-local `codex-sync` path
  as explicit Codex client surfaces during migration; do not silently replace
  their existing install or experimental support contracts.
- Add an optional generated `cursor-plugin` projection using
  `.cursor-plugin/plugin.json` for Cursor-native rules, agents, commands, hooks,
  and variables while reusing the same canonical skill sources.
- Keep one physical portable skill publication per project: Cursor-native
  output reuses the generated `plugins/dhpk-agent/skills/` store by default and
  emits a Cursor `skills/` overlay only when the inventory explicitly records
  an environment-specific transform.
- Normalize the portable skill projection to the Agent Skills frontmatter
  contract and keep Claude/Codex/Cursor client policy in client-owned metadata
  or projection files.
- Add deterministic generators, package-boundary checks, schema validators,
  per-surface provenance/fingerprint receipts, and consumer smoke gates for
  the standard package and the Cursor projection.
- Add a bilingual canonical installation guide covering Supported Codex
  project-local sync, legacy/native Codex marketplace installation, the
  standard Agent Plugin package, Cursor's standard Agent Plugin path, and the
  Cursor-native Plugin path. Each path SHALL document prerequisites, exact
  commands/UI steps, update/uninstall/rollback, verification evidence, and
  `NOT_CONFIGURED`/`BLOCKED`/`UNAVAILABLE` limitations.
- Extend platform discovery, parity, and invocation documentation so every
  claim names the exact surface and reports the canonical status vocabulary:
  `PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`,
  or `UNAVAILABLE` where appropriate.
- Update every explanatory document that mentions Codex, Cursor, plugin
  installation, publication, or distribution, with one canonical source and
  explicit cross-links rather than parallel unowned instructions.
- Preserve current Claude behavior, project-local Codex installation semantics,
  native-package experimental labeling, and unrelated dirty work.

## Capabilities

### New Capabilities

- `agent-plugin-portable-package`: Inventory-driven Agent Plugins 1.0.0 package
  layout, Agent Skills projection, optional MCP configuration, package-boundary
  safety, and deterministic evidence.
- `cursor-plugin-projection`: Cursor's standard-package consumption plus an
  explicitly separate Cursor Plugin projection for native components.
- `platform-installation-documentation`: Complete bilingual installation,
  update, verification, rollback, and support-status guidance for Codex and
  Cursor surfaces, with cross-document link and command consistency.

### Modified Capabilities

- `codex-native-publication`: Keep legacy Codex publication explicit while
  adding a distinct standard Agent Plugin artifact and shared provenance.
- `codex-skill-metadata-parity`: Separate portable skill metadata from
  client-specific invocation and callable-surface claims.
- `distribution-surface-governance`: Govern `agent-plugin` and `cursor-plugin`
  as explicit generated surfaces instead of deriving support from placement or
  README prose.
- `multi-ai-configured-platform-validation`: Discover Cursor as a configured
  target and report portable versus Cursor-native capability outcomes.
- `multi-ai-agent-discovery`: Add Cursor-native agent discovery without
  treating portable Agent Plugin skills or navigation files as agents.
- `multi-ai-sync-manifest-provenance`: Require owner-scoped receipts for each
  generated platform surface and prevent cross-surface ownership confusion.

## Impact

- Distribution SSOT and generated artifacts: `manifests/distribution-inventory.json`,
  `plugins/dhpk-agent/`, `plugins/dhpk-cursor/`, and the retained
  `plugins/dhpk/` Codex package.
- Projection/generation and validation code under `scripts/ci/`, `scripts/lib/`,
  and `scripts/hooks/`.
- Canonical skill normalization, Codex `agents/openai.yaml`, Cursor frontmatter,
  and platform-specific agent/command/hook projections.
- Documentation: new canonical `docs/platform-installation.md` and
  `docs/platform-installation.zh-TW.md`; `README.md`/`README.zh-TW.md`;
  `docs/basic-operations*`, `docs/configuration*`,
  `docs/distribution-surfaces*`, `docs/skill-platform-migration*`;
  `codex/README*`, `codex/AGENTS.md`, `.codex-plugin/README.md`,
  `plugins/dhpk/README*`, and the new standard/Cursor package READMEs.
  All files that mention Codex, Cursor, plugin install, marketplace, or
  distribution SHALL either be updated or link to the canonical guide.
- Tests and gates for schema validity, path containment, deterministic output,
  parity, provenance, local installation, and unavailable-client handling.
- No application runtime, production data, or database changes. No support-tier
  graduation is implied by this planning change or by a future static PASS.

## Research Basis

- [Agent Plugins home](https://agent-plugins.org/)
- [Agent Plugins specification](https://agent-plugins.org/specification)
- [Plugin manifest](https://agent-plugins.org/plugin-authors/manifest)
- [Skills](https://agent-plugins.org/plugin-authors/skills)
- [MCP servers](https://agent-plugins.org/plugin-authors/mcp-servers)
- [Client extensions](https://agent-plugins.org/plugin-authors/client-extensions)
- [Loading and discovery](https://agent-plugins.org/client-implementers/loading-and-discovery)
- [Client conformance checklist](https://agent-plugins.org/client-implementers/conformance)
- [Agent Skills specification](https://agentskills.io/specification)
- [Cursor plugin documentation](https://cursor.com/docs/plugins)
- [Cursor plugin reference](https://cursor.com/docs/reference/plugins)
- Existing dhpk contracts in `docs/distribution-surfaces.md`,
  `docs/skill-platform-migration.md`, and the current OpenSpec specs listed
  above.
