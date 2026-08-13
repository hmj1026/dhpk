## Context

The repository has a Claude-first canonical tree, a distribution inventory, a
project-local Codex installer, and a tracked experimental Codex-native package.
The current native package uses `.codex-plugin/plugin.json` with Codex-specific
`skills` and `interface` fields. That is a valid legacy client surface for the
repository's existing gates, but it is not the Agent Plugins 1.0.0 portable
manifest, which requires a root `plugin.json` with a closed schema. Canonical
skills are close to Agent Skills, but their frontmatter and `agents/openai.yaml`
also carry Claude/Codex policy.

Agent Plugins 1.0.0 standardizes only package identity, skill discovery, MCP
configuration, path safety, and failure isolation. Cursor documents two
formats: a root `plugin.json` Agent Plugin for skills/MCP and a
`.cursor-plugin/plugin.json` Cursor Plugin for rules, agents, commands, hooks,
variables, skills, and MCP. Codex and Cursor installation, trust, marketplace,
permissions, and runtime UX remain client-owned.

Relevant sources are linked in `proposal.md`; the repository's existing
contracts are `docs/distribution-surfaces.md`,
`docs/skill-platform-migration.md`, `openspec/specs/codex-native-publication`,
and `openspec/specs/codex-skill-metadata-parity`.

## Goals / Non-Goals

**Goals:**

- Establish one inventory-driven, schema-valid Agent Plugins package for the
  portable skill/MCP subset.
- Preserve current Codex project-sync behavior and legacy native package while
  making their support tiers and evidence boundaries explicit.
- Provide a generated Cursor Plugin projection for Cursor-native components
  without putting non-portable fields in the standard manifest.
- Keep canonical identity, lifecycle, fingerprints, provenance, and ownership
  consistent across every projection.
- Make missing clients, unsupported component types, and absent consumer probes
  fail closed with explicit statuses rather than false parity.
- Give maintainers one repeatable source/package/consumer verification matrix
  and update English/Traditional Chinese operating documentation.
- Give users one bilingual installation SSOT for Codex and Cursor, with exact
  commands/UI steps, prerequisites, update/uninstall/rollback, verification,
  and evidence-state interpretation.

**Non-Goals:**

- No application runtime, database, production data, or business behavior
  change.
- No automatic graduation of the experimental Codex-native package or an
  unverified claim that Cursor marketplace publication has passed.
- No replacement of the existing Codex receipt/installer in this change.
- No promise that Claude hooks, Codex TOML agents, or Cursor hooks are portable
  Agent Plugins components.
- No secrets, OAuth implementation, client registry, or marketplace account
  automation.
- No deletion of the current `.codex-plugin` package before a separately
  approved compatibility and consumer migration.

## Decisions

### 1. Publish three explicit generated surfaces

Add a standard package at `plugins/dhpk-agent/` with root `plugin.json`, fixed
`skills/`, optional standard `mcp.json`, and physical contained files. Keep
`plugins/dhpk/` and the root `.codex-plugin` manifests as the existing legacy
Codex-native surface until a future migration proves that Codex can consume the
standard package through the intended marketplace route. Add
`plugins/dhpk-cursor/` with `.cursor-plugin/plugin.json` and generated Cursor
rules/agents/commands/hooks/variables as a native-only overlay. The portable
skill store is `plugins/dhpk-agent/skills/` and is shared by Cursor; the Cursor
package emits a physical `skills/` directory only when an explicit inventory
row declares an environment-specific overlay transform.

This avoids a dual-manifest directory whose client detection and extension
semantics are ambiguous. A single standard package is still directly usable by
Cursor for portable skills/MCP; the Cursor package is needed only for
Cursor-native extras. Keeping the native package skill-free by default avoids
two physical copies of every portable skill and makes update, fingerprint, and
rollback ownership unambiguous. An environment-specific skill adaptation is an
explicit opt-in overlay, not an implicit duplicate. A rejected alternative is
to put `interface`, `skills`,
or `.codex-plugin` data in the standard root manifest; the Agent Plugins schema
is closed and clients must ignore unsupported extension namespaces, so that
would either fail validation or create undefined behavior.

### 2. Extend the existing inventory instead of adding a second source of truth

Extend `manifests/distribution-inventory.json` with explicit `agent-plugin` and
`cursor-plugin` surface membership and a projection/capability record for
client-only adaptations. Keep stable inventory IDs separate from public names.
Use a small machine-readable capability matrix for source capability,
destination surface, transform, support status, fallback, and evidence class;
do not infer support from directory placement, README prose, or a manifest's
existence.

### 3. Normalize portable skills at generation time

Canonical `skills/dhpk-*/SKILL.md` remains the authoring source. The standard
generator parses frontmatter, emits only Agent Skills fields (`name`,
`description`, supported optional fields, and nested metadata), preserves body
and portable resources, and excludes or records Claude/Codex-only files such as
`agents/openai.yaml`, `disable-model-invocation`, `context`, and
`argument-hint`. `metadata.dhpk-invocation-class` may remain descriptive but
cannot impose a portable runtime policy.

Codex `agents/openai.yaml`, Claude invocation flags, and Cursor rule/variable
schemas remain in their owning surfaces. The parity validator compares stable
identity and explicit transforms rather than demanding byte identity where a
client format differs.

### 4. Use narrow validators and independent failure boundaries

Add standard-package and Cursor-package validators that perform JSON/schema
checks, frontmatter checks, path containment, symlink checks, unknown-field
checks, and deterministic regeneration. Validate top-level documents first,
then individual skills/MCP entries/components. One bad skill or server skips
only that unit; a top-level manifest failure disables that surface. Reuse the
existing source/package/consumer gate vocabulary and never turn an unavailable
CLI into PASS.

### 5. Keep support claims surface- and evidence-scoped

The report matrix has separate rows for Claude, project-local Codex sync,
Codex-native legacy, standard Agent Plugin, and Cursor-native. Structural
validation, static package generation, local consumer discovery, and live
marketplace evidence are different evidence classes. `NOT_CONFIGURED`,
`SKIP_INCOMPATIBLE`, `BLOCKED`, `UNAVAILABLE`, and `NOT_RUN` remain visible;
only the applicable, verified runtime row can be PASS.

### 6. Generate physical publication artifacts with provenance

Use deterministic libraries/generators (for example
`scripts/lib/agent-plugin-package.js` and
`scripts/lib/cursor-plugin-package.js`) and CI entrypoints under
`scripts/ci/`. Generated packages contain no symlinks and include provenance
and per-surface fingerprints. A shared Cursor skill is referenced by stable ID
from the Agent Plugin store and is not copied into the native package. A
duplicate physical skill is permitted only for an inventory row whose
projection mode is `overlay`, and that row must record the environment-specific
transform and fallback.

### 7. Treat Cursor variables and hooks as security-sensitive extensions

Cursor variables declare schemas and placeholders only; no credential is
committed. Cursor hooks must use documented events, package-contained commands,
and explicit error handling. Since Cursor marketplace review and local loading
are client-owned, the repository records the exact tested path and version but
does not promise publication until a real consumer gate passes.

### 8. Make installation documentation an explicit SSOT

Create `docs/platform-installation.md` and
`docs/platform-installation.zh-TW.md` as the canonical operational guides.
Every existing README or guide that mentions Codex, Cursor, plugin install,
marketplace, or distribution SHALL link to the relevant section instead of
maintaining a second command list. A documentation inventory/test SHALL scan
the root README files, `docs/`, `codex/`, `.codex-plugin/`, and generated
package READMEs for stale commands, missing surface labels, and broken links.

The canonical guide SHALL contain this matrix:

| Surface | Installation | Update/uninstall | Verification | Status boundary |
|---|---|---|---|---|
| Codex project-local sync | From the project root, run `bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh` from a checkout, or `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"` inside the Claude plugin runtime; document `--copy`, `--update`, `--migrate`, `--uninstall`, and guarded `--force` | Receipt-owned reconciliation only; preserve user-owned collisions; use `--update`/`--uninstall` | `.codex/.dhpk-installed.json`, managed entries, `$dhpk-<name>` discovery, installer evidence | Supported path; installation alone does not prove callable runtime content |
| Codex legacy/native package | `codex plugin marketplace add <repo-or-path>` then `codex plugin add dhpk@dhpk`, only where the real CLI supports it | Marketplace/plugin commands plus package provenance; no manual edits to generated files | Exact tracked `plugins/dhpk/` artifact, native package gate, real CLI consumer gate | Experimental; missing CLI is `UNAVAILABLE`, not PASS |
| Agent Plugins standard | Publish/install `plugins/dhpk-agent/` through a client-specific route only after that route is verified; never invent an unsupported Codex command | Client-owned update/uninstall; package provenance and rollback | Root `plugin.json`, schema, fixed `skills/`, optional `mcp.json`, local consumer result | Structural conformance is separate from Codex runtime support |
| Cursor standard Agent Plugin | Cursor Customize/Plugins install or local `~/.cursor/plugins/local/dhpk-agent`; reload the window | Cursor Customize update/remove or replace the local package; preserve package receipt | Cursor discovers root `plugin.json`, skills, and MCP; record client version | Skills/MCP only; no Cursor-native parity claim |
| Cursor Plugin | Local `~/.cursor/plugins/local/dhpk-cursor`, or a reviewed `.cursor-plugin/marketplace.json` source; reload/configure in Cursor | Cursor Customize update/remove; marketplace refresh; rollback only Cursor-owned files | `.cursor-plugin/plugin.json`, rules, agents, commands, hooks, variables, local consumer evidence | Native components require Cursor evidence; unsupported features are `SKIP_INCOMPATIBLE` |

The canonical status taxonomy is: `PASS` (applicable evidence verified),
`FAIL` (applicable check failed), `NOT_RUN` (planned but not executed),
`NOT_CONFIGURED` (not selected/configured), `SKIP_INCOMPATIBLE` (named policy
gap with fallback), `BLOCKED` (explicitly requested but unavailable or
missing prerequisite), and `UNAVAILABLE` (consumer/tooling not present). The
table is a planning contract: an exact command or UI flow SHALL be marked
`BLOCKED`/`UNAVAILABLE` until the named client version and consumer probe prove
it. It is not acceptable to copy a marketplace manifest and call that an
installation proof.

## Risks / Trade-offs

- **[Risk] Agent Plugins 1.0.0 is a working draft and may evolve.** → Pin the
  schema URL, vendor a local validation contract, record the version in
  provenance, and require a reviewed schema migration for future versions.
- **[Risk] Codex may not accept the new standard package through the current
  marketplace command.** → Keep the existing `.codex-plugin` package and
  project-local installer, label standard consumer results independently, and
  block graduation until a real CLI probe succeeds.
- **[Risk] Cursor supports the standard but native components have different
  frontmatter/hook semantics.** → Generate a separate Cursor package, maintain
  a capability matrix, and use `SKIP_INCOMPATIBLE` only with an explicit
  fallback.
- **[Risk] Two or more physical projections drift.** → Derive all packages from
  the inventory, compare fingerprints, record transforms, and fail deterministic
  package gates on unexplained drift.
- **[Risk] Stripping client fields changes skill discoverability.** → Preserve
  public names/descriptions and test standard discovery; move policy into
  client metadata rather than silently deleting behavior.
- **[Risk] Generated hooks or variables expose secrets or escape the package.**
  → Reject literals, absolute/parent-relative paths, escaping symlinks, and
  unresolved variables before publication.
- **[Risk] Documentation overstates partial support.** → Require every claim to
  name its surface and evidence state, and keep unexecuted consumer checks
  `NOT_RUN`/`UNAVAILABLE`.

## Migration Plan

1. Add inventory surface/capability schema and documentation terms while
   keeping all existing surfaces unchanged.
2. Implement and test the Agent Plugins generator/validator in a new physical
   `plugins/dhpk-agent/` artifact. Run source and package gates; do not alter
   the legacy Codex package.
3. Implement the Cursor generator/validator and local fixture. Materialize
   `plugins/dhpk-cursor/` only for native components explicitly selected by the
   capability matrix; reuse `plugins/dhpk-agent/skills/` for portable skills
   unless an explicit overlay row requires a Cursor-specific copy.
4. Add independent Codex standard, Codex legacy, and Cursor consumer probes.
   Record `UNAVAILABLE`/`BLOCKED` when the relevant CLI or UI is absent.
5. Update docs, release parity, receipts, and rollback instructions. A failed
   standard/Cursor gate rolls back only its generated artifact and receipt;
   Codex sync, legacy native, Claude, and user-owned files remain intact.
6. Publish the bilingual installation SSOT and update/link every existing
   explanatory document named in the proposal. Add documentation link,
   command, and status-label checks before release review.
7. Consider a later migration change only after a real Codex standard install
   and Cursor marketplace/local proof; that later change may deprecate the
   legacy `.codex-plugin` surface but is outside this change.

## Open Questions

- Which Codex CLI release and marketplace command are the supported consumer
  probe for a root Agent Plugins `plugin.json` package?
- Should the standard artifact be installed by Codex as a new marketplace
  entry, or remain a repository-published interoperability package until the
  client exposes that route?
- Which exact Cursor version/edition is the minimum for local loading and for
  each native hook event required by dhpk?
- Which Codex and Cursor installation commands are stable enough to publish as
  supported instructions, versus remaining candidate or blocked routes?
- Does the project want one Cursor package containing generated portable skills,
  or two coordinated installs (portable Agent Plugin plus native extras)? The
  default design now chooses two coordinated installs so the project maintains
  one physical portable skill store; an explicit overlay remains available for
  a genuinely Cursor-specific skill variant.
- Which reverse-domain extension namespace, if any, will OpenAI/Codex and
  Cursor officially implement? No extension namespace is required for the
  portable first slice.
