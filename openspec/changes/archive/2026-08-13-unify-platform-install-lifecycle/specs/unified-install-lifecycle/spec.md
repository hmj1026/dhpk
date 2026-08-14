## ADDED Requirements

### Requirement: The unified installer accepts one strict surface-action contract

The project SHALL expose `dhpk-install <surface> <action>` where `surface` is
exactly one of `claude`, `codex-sync`, `codex-native`, `agent-plugin`, or
`cursor`, and `action` is exactly one of `plan`, `install`, `verify`,
`update`, `uninstall`, `rollback`, or `status`. Every action SHALL accept
`--scope project|user|local`, `--mode auto|copy|symlink|client-managed`,
`--source <path|git-url|marketplace>`, `--offline`, `--dry-run`, `--yes`, and
`--json`, with surface-specific values validated before any write. Cursor
SHALL additionally accept `--agent-profile core|extended|full` and repeatable
`--agent <id>`. Unknown surfaces, actions, options, or values SHALL fail
closed.

#### Scenario: A valid JSON plan is requested

- **WHEN** a caller runs `dhpk-install cursor plan --scope project --json`
- **THEN** the command returns a stable JSON result containing the normalized
  request, selected profile/defaults, plan identity, per-stage status, and no
  filesystem mutation

#### Scenario: An unknown surface or action is requested

- **WHEN** a caller supplies an unsupported surface, action, option, or option
  value
- **THEN** the command exits non-zero with an actionable diagnostic before
  compiling or writing a projection

#### Scenario: Dry-run is requested for a write action

- **WHEN** `install`, `update`, `uninstall`, or `rollback` is invoked with
  `--dry-run`
- **THEN** the command reports the planned ownership and file transitions but
  does not mutate artifacts or receipts

### Requirement: Plans are deterministic and inventory-owned

`plan`, `install`, and `update` SHALL compile through the
`DistributionCompiler` contract using the distribution inventory as the sole
source for stable IDs, public names, lifecycle, surface membership, source
paths, profiles, and declared transforms. A plan SHALL include the source
version/commit, inventory digest, selected IDs and names, target paths,
expected source/destination fingerprints, ownership markers, and plan ID.
The same inventory, source revision, tool version, and normalized options SHALL
produce the same plan. An ID selected for a surface it does not explicitly
own SHALL be rejected.

#### Scenario: Repeating a plan has identical evidence

- **WHEN** the same surface, source revision, inventory, and options are
  planned twice
- **THEN** both results have the same plan ID, selected stable IDs, target
  paths, and fingerprints

#### Scenario: The Codex-native subset is used for the wrong surface

- **WHEN** a caller attempts to use the 15-entry `codex-native` selection as
  the `agent-plugin` or Cursor portable selection
- **THEN** compilation fails with `WRONG_SURFACE` and does not silently treat
  the subset as the 66-skill portable inventory

#### Scenario: A deprecated or undeclared item is selected

- **WHEN** a requested item is deprecated, absent from the inventory, or lacks
  membership on the target surface
- **THEN** the plan fails with the stable ID/name and the owning inventory
  reason

### Requirement: Materialization is staged, contained, and fail-closed

Write actions SHALL pass the compiled plan to the
`ProjectionArtifactStore`/ArtifactStore contract. The store SHALL stage the
complete projection, reject path escapes, unsafe symlinks, malformed content,
and unowned collisions, verify staged fingerprints, and atomically commit the
planned set. A failed stage, verification, commit, or receipt write SHALL
restore the predecessor artifact and receipt; no partial projection SHALL be
reported as installed.

#### Scenario: A clean projection commits atomically

- **WHEN** every staged artifact is contained, owned, and fingerprint-valid
- **THEN** the store commits the complete plan and publishes its receipt only
  after the commit succeeds

#### Scenario: A user-owned target collides with the plan

- **WHEN** a target path exists without a matching lifecycle owner marker or
  receipt fingerprint
- **THEN** the operation reports a collision, preserves the target, and
  refuses to adopt or overwrite it

#### Scenario: A staged artifact fails validation

- **WHEN** any staged file has a wrong fingerprint, invalid frontmatter, or an
  escaping path
- **THEN** the entire transaction rolls back to its predecessor and reports
  the failed path and reason

### Requirement: Receipts are versioned and owner-scoped

Every materialized surface SHALL publish a versioned receipt containing the
receipt schema version, surface, owner, plan ID, source version/commit,
inventory digest, selected stable IDs and public names, transforms, target
roots, source/destination fingerprints, materialization mode, and predecessor
needed for rollback. `update`, `uninstall`, and `rollback` SHALL mutate or
remove only artifacts proven owned by that receipt. A missing, malformed,
stale, or cross-surface receipt SHALL fail closed and SHALL not authorize
adoption.

Project-scope lifecycle receipts SHALL be stored at
`.dhpk/receipts/<surface>.json`; user-scope lifecycle receipts SHALL be stored
at `${XDG_STATE_HOME:-$HOME/.local/state}/dhpk/receipts/<surface>.json`.
The `codex-sync` adapter SHALL retain `.codex/.dhpk-installed.json` as its
schema-v3 ownership receipt and bridge it into the unified lifecycle result
without relocating it.

#### Scenario: A current receipt authorizes an update

- **WHEN** the receipt owner, schema, target paths, and destination
  fingerprints match the current managed projection
- **THEN** `update` may replace or prune only the receipt-owned entries and
  records the new predecessor in the versioned receipt

#### Scenario: A receipt from another surface is presented

- **WHEN** a Cursor receipt is supplied to update `codex-sync` or
  `codex-native`
- **THEN** the command reports an ownership mismatch and leaves both surfaces
  unchanged

#### Scenario: An owned file was edited outside the receipt

- **WHEN** a destination fingerprint differs from the recorded fingerprint
- **THEN** uninstall, update, and rollback preserve the edited file and report
  a collision requiring an explicit owner decision

### Requirement: Surface adapters preserve independent client contracts

The lifecycle core SHALL dispatch each approved surface to an adapter that
retains that surface's existing source layout, transforms, verifier, receipt
location, and support tier. A successful adapter result SHALL not authorize
mutation, parity, or runtime claims for another surface. The existing
marketplace and `--plugin-dir` route SHALL remain available and SHALL require
both the `dhpk-agent` portable artifact and the `dhpk-cursor` native artifact
when the Cursor route is selected.

#### Scenario: Codex sync retains its project-local contract

- **WHEN** `dhpk-install codex-sync install` is run for a project
- **THEN** it uses the project-local sync ownership/receipt contract and does
  not replace it with the 15-entry Codex-native package

#### Scenario: Cursor package route lacks one required artifact

- **WHEN** marketplace or `--plugin-dir` installation supplies `dhpk-agent`
  but not `dhpk-cursor`
- **THEN** the route is `BLOCKED`, the portable result remains separately
  visible, and the combined Cursor route is not reported as installed

#### Scenario: Codex-native structural validation passes

- **WHEN** the retained Codex-native package passes its static validator but
  no real Codex consumer evidence exists
- **THEN** the lifecycle preserves its existing experimental tier and reports
  the consumer result as `NOT_RUN`, `BLOCKED`, or `UNAVAILABLE`

### Requirement: Cursor materializes an inventory-owned two-root bundle

The Cursor adapter SHALL materialize a project-scope bundle containing the 66
inventory-selected portable skills under `.agents/skills` and selected native
agents under `.cursor/agents` as one atomic transaction. Native profile
membership SHALL be inventory SSOT with
`core` containing `architect`, `deep-reasoner`, `tdd-guide`,
`code-reviewer`, and `security-reviewer`; `extended` containing the existing
curated Codex 12-agent set; and `full` containing all current 31 native
agents. Repeatable `--agent <id>` options SHALL add only inventory-approved
IDs and SHALL be applied deterministically without arbitrary paths.

#### Scenario: Core Cursor installation selects both roots

- **WHEN** `dhpk-install cursor install --scope project --agent-profile core --mode auto` is run with the current inventory
- **THEN** all 66 portable skills are staged at `.agents/skills`, the five
  core agents are staged at `.cursor/agents`, and one receipt records both
  roots and their fingerprints

#### Scenario: Repeated agent additions are deterministic

- **WHEN** `--agent security-reviewer --agent architect` is repeated or appears
  in a different order
- **THEN** the resulting selected stable IDs are deduplicated and normalized
  deterministically, without duplicate files or arbitrary path access

#### Scenario: Full profile follows inventory lifecycle

- **WHEN** the `full` profile is requested
- **THEN** it contains exactly the current inventory-approved 31 native agents,
  excluding deprecated or undeclared entries, and fails integrity validation
  if the inventory and profile disagree

#### Scenario: One Cursor root fails materialization

- **WHEN** a portable skill cannot be written or a selected native agent fails
  validation during the same Cursor operation
- **THEN** both `.agents/skills` and `.cursor/agents` revert to their
  predecessors and no partial Cursor receipt is published

### Requirement: Lifecycle actions have explicit transition semantics

`plan` SHALL compile without writing; `install` SHALL create a new owned
projection; `verify` SHALL validate the current projection and applicable
evidence without changing it; `update` SHALL reconcile only current owned
entries; `uninstall` SHALL remove only current owned entries; `rollback` SHALL
restore the recorded predecessor; and `status` SHALL report receipt,
ownership, drift, and consumer evidence without mutation. `offline` SHALL
prevent network/client calls and report unavailable evidence explicitly.

#### Scenario: Status observes a stale projection

- **WHEN** `status` finds a receipt whose destination fingerprint or source
  version is stale
- **THEN** it reports the stale entries and the required update/rollback action
  without rewriting them

#### Scenario: Rollback restores the predecessor

- **WHEN** a current owned receipt has a valid predecessor and
  `dhpk-install <surface> rollback` is confirmed
- **THEN** the predecessor files and receipt are restored atomically and the
  result records the rollback plan and fingerprints

#### Scenario: Offline verification cannot run a consumer probe

- **WHEN** `verify --offline` would require a live Claude, Codex, or Cursor
  client
- **THEN** structural checks run, client evidence is `NOT_RUN` or
  `UNAVAILABLE`, and the command does not claim runtime PASS

### Requirement: Consumer observations remain separate from installation

The lifecycle result SHALL expose local materialization as `INSTALL_PASS` only
after an atomic commit and receipt write. Client-managed observations SHALL
carry the referenced surface, lifecycle receipt/plan identity, client/version,
command or UI evidence, nonce where applicable, and status. `CONSUMER_BLOCKED`,
`NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, and `UNAVAILABLE` SHALL
remain visible; any applicable consumer block or failure SHALL prevent the
aggregate result from becoming `PASS`.

#### Scenario: Local install passes but consumer is blocked

- **WHEN** materialization and receipt creation succeed but the required client
  is unavailable or blocked
- **THEN** the result is `INSTALL_PASS + CONSUMER_BLOCKED` (or the precise
  unavailable status) and never overall `PASS`

#### Scenario: Cursor dispatch evidence is current

- **WHEN** a real Cursor client discovers the selected agents and returns a
  dispatch nonce tied to the current receipt and stable IDs
- **THEN** the Cursor observation records that nonce, client version, paths,
  fingerprints, and a consumer PASS for the applicable component set

#### Scenario: A stale observation receipt is reused

- **WHEN** a client observation references an older plan, receipt, fingerprint,
  or selected profile
- **THEN** verification marks it stale and does not use it to promote the
  current installation to PASS

### Requirement: Explicit-only lifecycle invocation uses the CLI contract

Lifecycle actions SHALL be classified explicit-only, including installation,
update, uninstall, rollback, publication, and other high-authority actions.
Any explicit-only AI skill that handles a lifecycle request SHALL delegate to
the same `dhpk-install` CLI rather than implement a separate write path.
The shipped `dhpk-install` skill SHALL declare
`disable-model-invocation: true`, show the resolved plan, and obtain explicit
confirmation before invoking a write action.
Model routing and
advisory hooks SHALL not invoke those actions implicitly; they MAY present the
exact human `dhpk-install` command. A direct human invocation SHALL still use
the common confirmation, `yes`, dry-run, ownership, staging, and verification
gates.

#### Scenario: Advisory routing recognizes an install request

- **WHEN** a user discusses installing a surface without supplying the exact
  supported invocation
- **THEN** the model may explain the command but does not execute
  `dhpk-install`

#### Scenario: A human explicitly invokes update

- **WHEN** a user provides the exact `dhpk-install <surface> update` command
- **THEN** execution enters the same lifecycle gates and does not use a
  privileged skill-only path
