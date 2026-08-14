## Context

dhpk has separate generators and installers for the Claude plugin, the
project-local Codex sync, the experimental Codex-native package, the standard
Agent Plugin package, and the Cursor projection. They already have useful
surface-specific receipts and validators, but lifecycle actions, ownership,
staging, and consumer evidence are not one contract. A command that can
install one projection cannot safely be assumed to know how to update or roll
back another projection.

This change is a contract and orchestration layer over those existing
surfaces. It depends on the contract-first architecture in
`harden-agent-architecture-governance`: `DistributionCompiler` produces a
deterministic, inventory-selected plan; `ProjectionArtifactStore` (the
ArtifactStore boundary) stages and materializes contained artifacts; and a
surface adapter performs client-specific verification. The lifecycle MUST
use those contracts rather than introduce a second generator or a second
selection source of truth.

Implementation is dependency-gated: no lifecycle source task may begin until
`harden-agent-architecture-governance` has implemented and verified the
compiler contracts, inventory projection schema, artifact-store containment,
and compatibility wrappers required by this change. Planning artifacts may be
reviewed earlier, but apply cannot substitute lifecycle-local look-alike
interfaces.

The distribution inventory is the authoritative source for stable IDs, public
names, lifecycle, source paths, surface membership, projection transforms, and
Cursor agent profiles. Existing receipts and client behavior remain part of
the compatibility surface. Consumer observation is separate from local
materialization because a package can be structurally correct while its
client is absent, blocked, or unable to discover an artifact.

## Goals / Non-Goals

**Goals:**

- Provide one strict `dhpk-install <surface> <action>` grammar for the five
  approved surfaces and seven lifecycle actions.
- Compile every plan from the inventory through `DistributionCompiler`, stage
  it through `ProjectionArtifactStore`, and make materialization atomic and
  receipt-backed.
- Make ownership, collision, stale-entry, fingerprint, and rollback behavior
  deterministic and fail closed across surfaces.
- Preserve independent ownership of Claude, Codex sync/native, Agent Plugin,
  and Cursor artifacts; no receipt for one surface authorizes another.
- Define Cursor as a single atomic bundle containing the 66 inventory-selected
  portable skills at `.agents/skills` and selected native agents at
  `.cursor/agents`, with inventory-defined `core`, `extended`, and `full`
  profiles and repeatable `--agent` additions.
- Keep marketplace and `--plugin-dir` routes available, while requiring both
  `dhpk-agent` and `dhpk-cursor` artifacts for the Cursor route.
- Separate `INSTALL_PASS` (local materialization) from client-managed
  observation and expose `CONSUMER_BLOCKED` without converting it to overall
  `PASS`.
- Keep explicit-only AI skill lifecycle actions human-invoked through this CLI,
  with the same confirmation, dry-run, ownership, and verification gates.

**Non-Goals:**

- No replacement of the `DistributionCompiler`, ArtifactStore, or client
  adapter contracts defined by `harden-agent-architecture-governance`.
- No direct rewrite of existing surface generators into a new implementation
  in this planning change; adapters may wrap them until each surface migrates.
- No automatic promotion of Codex-native, Agent Plugin, or Cursor support
  tiers from structural generation or a marketplace listing.
- No interpretation of the 15-entry `codex-native` subset as the portable
  66-skill or Cursor surface; selecting it for the wrong surface is an error.
- No mutation of user-owned files, foreign receipts, or client-managed
  observation receipts without explicit ownership evidence.
- No committed credentials, live marketplace account automation, or claim
  that a missing client probe is a runtime PASS.

## Decisions

### 1. Use one command grammar with surface adapters

The CLI accepts exactly:

```text
dhpk-install <surface> <action> [options]
```

`surface` is one of `claude`, `codex-sync`, `codex-native`, `agent-plugin`,
or `cursor`; `action` is one of `plan`, `install`, `verify`, `update`,
`uninstall`, `rollback`, or `status`. Common options are
`--scope project|user|local`, `--mode auto|copy|symlink|client-managed`,
`--source <path|git-url|marketplace>`, `--offline`, `--dry-run`, `--yes`, and
`--json`. Cursor additionally accepts `--agent-profile core|extended|full`
and repeatable `--agent <id>`. Unknown surfaces, actions, options, profile
names, or agent IDs fail before any write. `--json` emits a
stable machine-readable result containing the normalized request, plan ID,
receipt identity, per-stage statuses, and remediation; human output uses the
same result model.

Cursor and `codex-sync` default to project scope. Other surfaces require an
explicit scope until their adapter's characterized client-managed route fixes
one without changing existing behavior. Direct filesystem projections default
to `--mode auto`; marketplace-owned routes default to `client-managed`.

The lifecycle core owns argument normalization, confirmation, plan identity,
receipt loading, ownership checks, staging, commit/rollback sequencing, and
status aggregation. A surface adapter owns only source selection, target
layout, client-specific transformation, and client evidence collection. This
keeps a common lifecycle without pretending that Claude validation, Codex
discovery, Agent Plugin validation, and Cursor dispatch are interchangeable.

An alternative was one independent `install` command per client. That keeps
local code simple but makes ownership and rollback semantics diverge; it is
rejected because the requested contract specifically needs cross-surface
receipts and failure boundaries.

### 2. Compile before materializing

`plan` calls `DistributionCompiler` with the normalized surface, scope, mode,
source, and profile options. The compiler resolves inventory entries, rejects
deprecated or wrong-surface IDs, applies only declared transforms, and returns
an immutable plan containing target paths, expected fingerprints, ownership
markers, and the selected source version. The plan is deterministic for the
same inventory, source revision, options, and tool version; it is serialized
for `plan`, `dry-run`, and receipt evidence.

`install` and `update` compile first and pass the plan to the
`ProjectionArtifactStore`. The store stages every file in a contained,
temporary transaction area, rejects escaping paths/symlinks and unresolved
collisions, verifies staged fingerprints, and atomically commits the complete
set. The core writes the versioned receipt only after the artifact-store
commit succeeds. A failed stage, verification, or receipt write invokes the
store rollback and leaves the previous owned projection intact.

An alternative was to write files one at a time and repair on an error. That
can leave the Cursor skill and agent roots at different versions and cannot
prove recovery after process interruption, so it is rejected.

### 3. Version receipts by owner and keep observations client-managed

Each materialized surface has a versioned receipt containing at least the
schema version, surface and owner, plan ID, source version/commit, inventory
digest, selected stable IDs and public names, transforms, target roots,
source/destination fingerprints, materialization mode, and rollback predecessor.
The receipt is the only authority for replacing, pruning, uninstalling, or
rolling back generated files. A missing, malformed, stale, or owner-mismatched
receipt causes a fail-closed collision/blocked result; it does not authorize
adoption.

Project-scope lifecycle receipts live at
`.dhpk/receipts/<surface>.json`. User-scope lifecycle receipts live at
`${XDG_STATE_HOME:-$HOME/.local/state}/dhpk/receipts/<surface>.json`.
The existing Codex project-sync adapter continues to own
`.codex/.dhpk-installed.json` and bridges its schema-v3 data into the unified
result; the lifecycle MUST NOT relocate or silently adopt that receipt.

Consumer observation receipts are distinct records owned by the client gate.
They may refer to a lifecycle receipt and plan ID, but `dhpk-install` does not
forge a Cursor, Codex, Claude, or marketplace observation. A local result can
therefore be `INSTALL_PASS` with `CONSUMER_BLOCKED`, `NOT_RUN`, or
`UNAVAILABLE`; the aggregate result is not `PASS` until the applicable client
observation succeeds.

An alternative was to let the installer overwrite a path when bytes match a
current source. Matching bytes do not prove ownership, and an edited or
independently managed receipt could be lost; ownership remains explicit.

### 4. Model Cursor as one atomic two-root bundle

The Cursor adapter resolves a profile from inventory metadata for the project
scope; a Cursor bundle cannot be split into separate global and project
transactions. The default
portable selection is the 66 current portable skills and materializes them
under `.agents/skills`. Native agents materialize under `.cursor/agents` from
one of these inventory-owned profiles:

- `core`: `architect`, `deep-reasoner`, `tdd-guide`, `code-reviewer`, and
  `security-reviewer`;
- `extended`: the existing curated Codex 12-agent set;
- `full`: all current 31 native agents.

Each `--agent <id>` occurrence adds one inventory-approved native agent to the
selected profile; repeated additions are deduplicated by stable ID and do not
permit arbitrary paths. The profile record, expected counts, and stable IDs
are the SSOT; the numbers are validation expectations, not a hardcoded second
inventory. The Cursor install route stages and commits both roots as one
transaction. If either the portable skills or native agents fail, both roots
roll back and no partial receipt is published.

The default Cursor invocation is
`dhpk-install cursor install --scope project --agent-profile core --mode auto`.

Cursor installation retains the marketplace and `--plugin-dir` route, but the
route is valid only when both `dhpk-agent` (portable package) and
`dhpk-cursor` (native package) artifacts are present and owned. The 15-entry
Codex-native set is never used as a Cursor profile or as evidence for the
66-skill portable store.

### 5. Reuse exact discovery and evidence gates

`verify` checks inventory membership, exact stable IDs/public names, source
and destination fingerprints, required frontmatter, stale/duplicate entries,
receipt ownership, and target containment. Cursor verification additionally
requires a real client discovery/dispatch nonce tied to the selected agent
IDs; a static manifest, generated file, or receipt alone is structural
evidence only. Native or marketplace validation remains surface-specific.

Support status is aggregated without conflating rows. Applicable failures are
`FAIL`; absent or unavailable clients are `NOT_RUN`, `BLOCKED`, or
`UNAVAILABLE` according to the evidence matrix; policy-backed gaps are
`SKIP_INCOMPATIBLE`; local writes can be `INSTALL_PASS` but consumer blocking
remains visible and prevents overall `PASS`.

### 6. Route explicit-only invocation through the same lifecycle

The invocation policy marks lifecycle/install/update/uninstall/rollback and
other high-authority entries as explicit-only. The `dhpk-install` AI skill
declares `disable-model-invocation: true` and invokes only the common CLI after
presenting its plan and receiving confirmation. A model or advisory hook may
explain the exact `dhpk-install` syntax but cannot invoke it implicitly. A
human exact invocation enters the same CLI confirmation, `--yes`, dry-run,
ownership, staging, and verification path; there is no privileged skill-only
shortcut.

## Risks / Trade-offs

- **[Risk] Existing generators have incompatible receipt formats.** → Keep
  surface adapters and versioned migration readers; emit a plan/report before
  adopting an old receipt and preserve legacy files when ownership is not
  proven.
- **[Risk] Atomic staging cannot span filesystems or a client-owned root.** →
  require one ArtifactStore transaction per bundle, validate same-filesystem
  staging, and report `BLOCKED` before writes when atomic commit is impossible.
- **[Risk] Cursor profile counts drift as agents are added or deprecated.** →
  make profile membership inventory-owned, validate exact IDs/counts and
  lifecycle, and fail the manifest gate instead of silently selecting a new
  agent.
- **[Risk] A client dispatch nonce is unavailable in CI.** → record
  `NOT_RUN`/`UNAVAILABLE` with the exact rerun command; do not turn static
  discovery into runtime PASS.
- **[Risk] Users interpret `INSTALL_PASS` as client support.** → keep local
  materialization and consumer observation as separate receipt/result fields,
  and require documentation to show the aggregate boundary.
- **[Risk] Marketplace or `--plugin-dir` packages become duplicate owners.** →
  require both package identities and owner-scoped receipts, preserve foreign
  files, and report collisions rather than adopting them.
- **[Risk] An explicit-only lifecycle entry is invoked by a model through an
  advisory path.** → validate invocation metadata and route all lifecycle
  execution through the CLI entrypoint with an exact human invocation gate.

## Migration Plan

1. Add characterization fixtures for current Claude, Codex sync, Codex-native,
   Agent Plugin, and Cursor package outputs, including receipts, exit codes,
   ownership collisions, and existing marketplace/`--plugin-dir` behavior.
2. Implement the lifecycle core against the existing
   `DistributionCompiler`/`ProjectionArtifactStore` contracts and add adapters
   one surface at a time, beginning with read-only `plan`/`status` and then
   `verify`.
3. Enable staged `install`/`update` for Cursor as a two-root transaction, then
   migrate the remaining surfaces while preserving legacy receipt readers and
   explicit support tiers.
4. Add `uninstall`/`rollback` only for receipt-owned artifacts, with dry-run
   and collision fixtures required before enabling writes by default.
5. Update the bilingual documentation and consumer gates, then run the strict
   manifest, discovery, and real-client evidence checks. A missing client
   keeps the result `NOT_RUN`/`BLOCKED`/`UNAVAILABLE`; it is not a release
   graduation signal.

Rollback of the migration disables lifecycle writes and leaves existing
surface-specific commands available. A failed transaction restores the
predecessor receipt and files through the ArtifactStore. No migration step
deletes a foreign or unowned artifact.

## Resolved Defaults

- The Codex project-sync schema-v3 receipt is the only existing receipt read directly. Unknown or older schemas require an explicit migration plan and confirmation; other surfaces start with the unified v1 receipt and never infer ownership from matching bytes.
- Atomic commit requires staging and target roots on the same filesystem. Preflight failure returns `ATOMIC_COMMIT_UNAVAILABLE` before writes; it does not fall back to file-by-file replacement.
- Cursor consumer proof uses a read-only temporary-project dispatch probe bound to a nonce and the installed client version. If the running client cannot expose or complete that probe, consumer evidence is `UNAVAILABLE`/`BLOCKED`, and the support tier is unchanged.
- Cursor and `codex-sync` default to project scope. Claude, `codex-native`, and standalone `agent-plugin` require explicit scope until their client-managed adapters establish a characterized default.
