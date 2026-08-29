# dhpk-do-portable-entry Specification

## Purpose
Define one portable explicit workflow entry that routes work across supported
hosts while keeping adapters thin and capability claims evidence-based.

## Requirements

### Requirement: One canonical workflow owns dhpk-do orchestration

The Distributed Skill `dhpk-do` SHALL own request normalization, route
selection, host target resolution, child coordination, and final reporting. It
SHALL consume execution-policy as the decision SSOT and SHALL NOT duplicate its
dispatch table. `/dhpk:do` and the generated Cursor command SHALL be thin host
adapters; `$dhpk-do` SHALL be the Codex entry.

#### Scenario: Claude command enters the canonical skill
- **WHEN** a user invokes `/dhpk:do <task>`
- **THEN** the adapter passes the same arguments and Claude host identity to `dhpk-do`
- **AND** the command contains no independent workflow or policy table

#### Scenario: Codex user invokes the portable entry
- **WHEN** Codex has discovered the distributed skill
- **THEN** `$dhpk-do <task>` runs the canonical workflow without a custom `/dhpk:*` command

### Requirement: Route targets and results are typed

Every route rule SHALL retain its ordered pattern and label and declare target
kind `skill`, `command`, or `agent` plus stable ID. A command MAY name a
`portable_skill_id` only for a validated pair. The immutable
`dhpk.route-result.v2` SHALL contain host, cleaned query, normalized options,
typed target, conditionally valid availability state/reason/evidence, backend
selection, ordered diagnostics, and disposition exactly as defined by the
design schema and parser matrix.

#### Scenario: Route-only resolves every existing rule
- **WHEN** either host entry runs `--route-only` against every current fixture
- **THEN** pattern order, label, and intent are preserved as typed targets
- **AND** no downstream entry is invoked

#### Scenario: Route-result violates its schema
- **WHEN** a result omits a required field, uses an unknown enum, is mutable, or declares an invalid portable mapping
- **THEN** contract validation fails before dispatch

#### Scenario: Repeated flags are normalized deterministically
- **WHEN** flags repeat, aliases mix, or architect toggles conflict
- **THEN** normalization follows the design parser matrix and retains unknown tokens in original order

### Requirement: Dispatch depends on observed host capability

The router SHALL dispatch only an exact target observed as callable on the
active surface. Inventory, generated files, or receipts alone SHALL NOT prove
callability. Missing capability SHALL produce terminal `UNAVAILABLE` with typed
target, host, reason code, and evidence and SHALL NOT select another route.

#### Scenario: Codex target is discovered
- **WHEN** a resolved skill or agent is published and discovered on active Codex
- **THEN** `dhpk-do` dispatches that exact target and reports its result

#### Scenario: Codex target is unavailable
- **WHEN** the target is Claude-only or undiscovered
- **THEN** `dhpk-do` returns `UNAVAILABLE` without a fabricated handoff or alternate route

#### Scenario: External launch status remains runner-owned

- **WHEN** an available routed target begins external CLI execution
- **THEN** `dhpk-do` preserves the exact `dhpk.cli.receipt.v1` nested status and
  receipt reference
- **AND** only `SUCCEEDED` plus all completed obligations may yield final `PASS`
- **AND** `FAILED`, `BLOCKED`, `TIMEOUT`, or `PARTIAL` yield final `BLOCKED`,
  never route `UNAVAILABLE`

#### Scenario: Selector uses its approved missing-executable fallback
- **WHEN** the selected worker/reasoner target permits missing-executable fallback under existing policy
- **THEN** the target remains unchanged while `backendSelection` reports requested/selected backend, fallback use, and `MISSING_EXECUTABLE`
- **AND** auth, model, task, or execution failures remain `BLOCKED`

### Requirement: Explicit authorization is bounded to one target

Without `--execute-explicit`, an explicit-only target SHALL be reported with its
exact invocation and not dispatched. The flag SHALL authorize one invocation of
the resolved target and SHALL NOT authorize retry, alternate route, or nested
explicit entry. `--route-only` SHALL always remain terminal.

#### Scenario: Default preserves the explicit boundary
- **WHEN** an explicit-only target resolves without `--execute-explicit`
- **THEN** the router returns `explicit-required` and stops

#### Scenario: User authorizes one target
- **WHEN** the user supplies `--execute-explicit` and the selected target is callable
- **THEN** the router may invoke that target once while all target-owned gates remain active

#### Scenario: Route-only wins
- **WHEN** `--route-only` and `--execute-explicit` occur together
- **THEN** the router reports route/availability and invokes nothing

#### Scenario: OpenSpec sequence contains an explicit entry
- **WHEN** the authoring sequence contains any explicit-only entry
- **THEN** the router preflights and stops before the sequence with the exact first human invocation
- **AND** `--execute-explicit` does not authorize the compound sequence

### Requirement: The parent owns terminal completion

After child dispatch, `dhpk-do` SHALL retain control, collect its terminal
result, satisfy router-created follow-up obligations, and emit one final
`PASS`, `BLOCKED`, or `UNAVAILABLE`. A host unable to guarantee continuation
SHALL return `BLOCKED` before write-capable dispatch.

#### Scenario: Downstream target completes
- **WHEN** the child and router-owned obligations complete
- **THEN** the same invocation returns the final result without another human skill trigger

#### Scenario: Parent cannot resume
- **WHEN** the host cannot preserve the parent across a write-capable child
- **THEN** `dhpk-do` returns `BLOCKED` before mutation

### Requirement: The portable entry is distributed as required core

Stable ID `do` SHALL be promoted/core, selected by minimal Claude, and published
to `claude-core`, `cursor-sync`, `codex-sync`, and `codex-native` with matching
identity, explicit-only metadata, and surface provenance.

#### Scenario: Declared projections are generated
- **WHEN** publication runs from inventory
- **THEN** all four surfaces contain their expected generated `dhpk-do` representation
