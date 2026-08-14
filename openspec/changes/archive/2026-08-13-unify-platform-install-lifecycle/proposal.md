## Why

dhpk currently exposes several surface-specific installers, projections, and
verification commands whose receipts, ownership rules, and consumer evidence
are not one lifecycle. That makes update, rollback, collision handling, and
support claims difficult to reason about, especially for Cursor and for the
portable Agent Plugin package. A single contract is needed now so every
surface can plan and materialize deterministically while retaining its
client-specific evidence boundary.

## What Changes

- Add the unified `dhpk-install <surface> <action>` lifecycle for
  `claude`, `codex-sync`, `codex-native`, `agent-plugin`, and `cursor`, with
  `plan`, `install`, `verify`, `update`, `uninstall`, `rollback`, and `status`
  actions.
- Define common `--scope`, `--mode`, `--source`, `--offline`, `--dry-run`,
  `--yes`, and `--json` options plus Cursor-specific `--agent-profile` and
  repeatable `--agent` options, versioned receipts, deterministic staged
  projections, and atomic materialization with rollback on failure.
- Make ownership and collision checks fail closed. Preserve user-owned or
  independently managed files, and allow mutation only when the target
  surface owns the recorded artifact.
- Keep consumer observation receipts client-managed and evidence-scoped. A
  structural or staged result SHALL NOT become runtime support without the
  applicable consumer probe.
- Add Cursor as a first-class atomic project-scope bundle: 66 portable skills
  materialize under `.agents/skills`, selected native agents under
  `.cursor/agents`, and
  inventory-owned profiles select `core`, `extended`, or `full` agents with
  repeatable `--agent` additions. A materialization failure rolls back both
  roots.
- Keep the existing marketplace/`--plugin-dir` installation route, requiring
  both `dhpk-agent` and `dhpk-cursor` artifacts. Do not treat the 15-entry
  Codex subset as the Cursor or portable surface, and do not promote support
  tiers without consumer evidence.
- Require explicit-only AI skill invocation to use the same CLI contract;
  advisory or model routing SHALL NOT invoke those lifecycle actions
  implicitly.
- Update validation and discovery requirements so exact stable IDs,
  fingerprints, frontmatter, stale entries, and a real Cursor
  discovery/dispatch nonce are checked, while blocked consumers remain
  visible as `INSTALL_PASS + CONSUMER_BLOCKED` rather than overall `PASS`.
- Update the bilingual installation documentation and related integrity gates
  to describe the shared lifecycle, receipt ownership, status taxonomy,
  rollback, and evidence limitations.

## Capabilities

### New Capabilities

- `unified-install-lifecycle`: Defines the common install/verify/update/
  uninstall/rollback/status contract, surface adapters, staged atomic writes,
  versioned receipts, ownership/collision policy, Cursor bundle profiles, and
  consumer-evidence boundaries.

### Modified Capabilities

- `consumer-post-install-validation`: Validate lifecycle receipts and
  surface-specific consumer observations, including Cursor discovery and
  dispatch evidence and `CONSUMER_BLOCKED` aggregation.
- `install-manifest-integrity`: Treat lifecycle inventories, exact IDs,
  fingerprints, profiles, and receipt/materialization metadata as one
  integrity contract, including the full Cursor profile.
- `multi-ai-agent-discovery`: Discover only exact, inventory-owned invocable
  definitions on each declared surface and validate Cursor profile output and
  dispatch nonce evidence.
- `platform-installation-documentation`: Make `dhpk-install` the documented
  lifecycle SSOT while retaining supported marketplace and `--plugin-dir`
  routes, bilingual rollback guidance, and evidence-scoped support claims.

## Impact

- New lifecycle CLI and shared projection/receipt adapters under the existing
  distribution tooling, using the contract-first
  `DistributionCompiler`/`ProjectionArtifactStore` architecture from
  `harden-agent-architecture-governance`.
- Existing Claude, project-local Codex sync, Codex-native, Agent Plugin, and
  Cursor package generators, inventories, validators, and consumer gates.
- Cursor materialization roots `.agents/skills` and `.cursor/agents`, with
  inventory profiles for the 66 portable skills and native-agent selection.
- Versioned per-surface receipts, fingerprints, ownership markers, staged
  temporary outputs, and rollback records; no mutation of foreign files.
- `docs/platform-installation.md` and its Traditional Chinese counterpart,
  plus the named discovery, manifest-integrity, and consumer-validation
  contracts.
- Existing client behavior remains supported where already evidenced; no
  support-tier graduation, Codex 15-only surface substitution, or claim of
  runtime support follows from static generation alone.
