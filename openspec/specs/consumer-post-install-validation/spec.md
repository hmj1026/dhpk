# consumer-post-install-validation Specification

## Purpose

Define the evidence needed to validate installed dhpk artifacts in real
consumer environments, including artifact and session identity, surface
conflicts, and optional role-specific probes.

## Requirements

### Requirement: Official Claude strict validation is consumer evidence

The consumer validation stage SHALL run `claude plugin validate <manifest> --strict` against the staged or installed Claude plugin when the official CLI is available. The result, version, command, exit code, bounded diagnostics, and normalized surface evidence SHALL be retained, and an official validation failure SHALL block consumer completion.

#### Scenario: Strict validator accepts the staged plugin

- **WHEN** the official validator exits zero for the staged plugin manifest
- **THEN** the consumer evidence records an official PASS with its normalized command, version, exit code, and continues to installed-cache checks

#### Scenario: Strict validator rejects a skill description

- **WHEN** the official validator reports a YAML/frontmatter error for any shipped skill
- **THEN** the normalized consumer verdict is BLOCKED with the affected relative paths and does not report the release complete

#### Scenario: Official CLI is unavailable

- **WHEN** the consumer environment cannot run the official Claude validator
- **THEN** normalized evidence records `NOT RUN` or the applicable unavailable state with the reason and the release cannot claim an official-validation PASS

### Requirement: Consumer checks detect stale or duplicate Codex surfaces

Supported Codex consumer validation, as implemented by `scripts/release/consumer-gate.js` under the `consumer-post-install-validation` contract, SHALL compare the canonical source fingerprint, installed receipt/version, discovered project-local fallback entries, and native package entries. A stale receipt, duplicate dhpk surface with differing content, or legacy fallback set that shadows canonical names SHALL produce an actionable BLOCKED or legacy surface-matrix WARN according to that surface matrix and SHALL never be presented as a clean supported install. The result SHALL retain a normalized per-surface evidence record with the checked fingerprints, paths, commands, diagnostics, remediation reasons, and any compatibility `WARN` status separately from its canonical evidence verdict.

When a named-role native check is explicitly required, `codex-sync` runtime
validation SHALL verify that every receipt-managed agent role is a physical
file and SHALL run a bounded named-role probe through a fresh Codex CLI
session. The probe SHALL run under a
gate-owned disposable `CODEX_HOME` that references existing credentials by
symlink without copying them, SHALL pre-seed only
`[projects."<disposable project path>"] trust_level = "trusted"` into that
disposable home, SHALL NOT pass `--ignore-user-config`, and SHALL NOT pass
`--ephemeral` (which would suppress the rollout JSONL persistence that is the
only named-role evidence surface in this CLI version). The probe SHALL
assert that `spawn_agent` accepted the exact role ID through its `agent_type`
parameter, sourced from rollout-JSONL ground truth. A receipt/discovery-only result, an unexecuted probe, an untyped
fallback spawn, `ELOOP`, or `agent type is currently not available` SHALL not
produce consumer-runtime PASS. Evidence SHALL retain the Codex version, role
IDs, the supplied trust precondition, exit status, and bounded redacted
diagnostics.

#### Scenario: Physical project-local roles dispatch successfully

- **WHEN** the current receipt owns only physical agent TOMLs and the fresh
  Codex probe runs under the disposable trusted-project preconditions and
  dispatches the required named roles through `agent_type`
- **THEN** `codex-sync` records consumer-runtime PASS with the observed role IDs
  and the supplied trust precondition

#### Scenario: Static install passes but named role loading fails

- **WHEN** receipt and source checks pass, the registry preconditions were
  supplied, but Codex reports a symbolic-link loop or unavailable named role
- **THEN** `codex-sync` reports FAIL with bounded remediation evidence and does
  not promote static discovery to runtime proof

#### Scenario: Built-in role cannot prove custom registry discovery

- **WHEN** built-in `explorer` can run but an exact-ID non-built-in role backed
  by a physical TOML reports `unknown agent_type`
- **THEN** `codex-sync` records `CUSTOM_AGENT_REGISTRY_UNAVAILABLE`, the CLI
  version, and bounded redacted diagnostics
- **AND** the reason is reported as an unloaded project role source, naming the
  missing trust entry or suppressed configuration loading, not as an upstream
  CLI defect
- **AND** it does not prescribe a role rename, model replacement, or user or
  project configuration rewrite as remediation

#### Scenario: Untyped fallback spawn is not a pass

- **WHEN** the custom-role registry is empty, `spawn_agent` exposes no
  `agent_type` parameter, and the session falls back to an untyped spawn that
  still returns the requested marker text
- **THEN** `codex-sync` reports FAIL with
  `CUSTOM_AGENT_REGISTRY_UNAVAILABLE` and does not accept the marker text or
  the child reply as named-role evidence

#### Scenario: Other platforms retain independent evidence

- **WHEN** Cursor, AGY, or Claude agents are evaluated in the same release
- **THEN** each platform uses its own applicable runtime adapter and reports
  PASS, BLOCKED, UNAVAILABLE, or a documented N/A independently

#### Scenario: Clean project has one current projection

- **WHEN** a clean project contains the expected canonical fallback entries, matching receipt fingerprint, and no conflicting native surface
- **THEN** the supported Codex consumer result is PASS and records the discovered names, fingerprint, and normalized evidence fields

#### Scenario: Existing project has a stale receipt and legacy mirrors

- **WHEN** the project receipt predates the current native naming scheme and legacy physical entries coexist with canonical entries
- **THEN** validation reports the exact stale receipt, duplicate paths, and required migration/update command in normalized evidence, and does not report PASS

#### Scenario: Native and fallback content differs

- **WHEN** a native package and project-local fallback expose the same skill name with different fingerprints
- **THEN** validation reports a deterministic conflict verdict and retains both paths and fingerprints for remediation

#### Scenario: Non-blocking surface warning is normalized

- **WHEN** the duplicate-surface matrix returns `WARN` because a receipt-owned project-local fallback takes precedence over experimental native content
- **THEN** the normalized result preserves `WARN` as compatibility surface status and warnings metadata, keeps the canonical evidence verdict vocabulary unchanged, and does not report a clean supported install

### Requirement: Portable candidate consumer evidence binds exact artifact and session

Every Codex consumer session used to accept an OpenAI portable candidate SHALL
be bound to the exact delivered ZIP digest, extracted package and selection
identities, Codex version, and an observed fresh-session identifier. Evidence
SHALL record the actual probe command, discovered active sources, selected
workflow outcome, and bounded redacted diagnostics. The source checkout SHALL
be unavailable to the consumer session. A separately generated candidate,
cache presence, package-manager success, or an untyped marker SHALL NOT prove
that the delivered artifact loaded and executed.

#### Scenario: Delivered candidate runs in a fresh consumer session

- **WHEN** Codex installs the delivered portable artifact and a fresh session
  performs a declared native workflow probe
- **THEN** the receipt binds that observed session and outcome to the exact ZIP,
  package selection, and Codex version

#### Scenario: Consumer evidence omits artifact or session identity

- **WHEN** a consumer result lacks the delivered ZIP digest, package identity,
  Codex version, or observed session identifier
- **THEN** the result remains non-pass and does not establish portable-candidate
  runtime acceptance

### Requirement: Optional role configuration is separate from plugin acceptance

Acceptance of the skills-only portable plugin SHALL NOT require installed dhpk
agent TOMLs, extra rules, a role-parity manifest, or project configuration
rewrites. If an optional custom-role integration is exercised, its evidence
MUST identify the configured role and observed native dispatch result
separately from plugin acceptance; static role files or an untyped marker
cannot establish named-role loading. Explicit consumer-project policy remains
authoritative, including a requirement for independent review.

#### Scenario: Consumer has no optional dhpk role files

- **WHEN** a clean consumer has the portable plugin and native Codex
  capabilities but no dhpk role projection
- **THEN** plugin acceptance can be based on the selected native skill
  workflows without installing optional role files

#### Scenario: An exercised optional role cannot load

- **WHEN** an explicitly selected custom-role probe cannot dispatch the
  configured role
- **THEN** its separate result is non-pass and does not invalidate or replace
  the artifact-bound plugin workflow evidence

### Requirement: REQ-849-01 Default selected-surface acceptance uses installation evidence

The existing `scripts/release/consumer-gate.js` public entrypoint SHALL accept
an explicit selected installation surface and SHALL derive its default
acceptance from that surface's installation contract. Ordinary installation
acceptance MUST NOT require a model invocation or native runtime probe. The
CONSUMER report SHALL preserve installation and runtime observations
separately; an installation PASS MUST NOT rewrite runtime evidence or establish
`runtimeVerified`.

#### Scenario: Codex sync installation passes without native execution

- **WHEN** `consumer-gate.js` evaluates only `codex-sync` and its installer,
  ownership, physical materialization, resource closure, and discovery checks
  pass
- **THEN** the required installation check and `acceptance.verdict` are PASS
- **AND** `runtimeEvidence.status` remains `NOT_RUN`
- **AND** no Codex prompt or named-role native probe is invoked

#### Scenario: Projected consumer package passes installation only

- **WHEN** a selected `agent-plugin` or `cursor-plugin` package passes its
  package, manifest, and structural installation checks without an authorized
  isolated native probe
- **THEN** its installation evidence MAY satisfy the installation acceptance
  check
- **AND** its raw runtime observation remains `NOT_RUN` or `UNAVAILABLE`
- **AND** CI presence or inherited `DHPK_CONSUMER_PROBE_EXECUTE` MUST NOT
  activate plugin-directory runtime execution

#### Scenario: Installation acceptance does not graduate support

- **WHEN** an installation contract passes while native runtime evidence is
  absent or non-passing
- **THEN** the report does not claim native runtime verification, supported
  status, or a higher support tier

### Requirement: REQ-849-02 Declared consumer requirements remain required

The consumer gate SHALL accept a bounded `dhpk.consumer-requirements.v1`
requirements document through `--requirements <JSON file>`. Every entry in
`checks` declares a required obligation. An entry MUST remain required and
BLOCKED if its surface is outside the selected adapter scope or its
capability/evidence pair is unsupported. The gate MUST NOT invoke an adapter
for an out-of-scope surface or an input-selected adapter for an unsupported
pair; a selected surface's gate-owned installation check remains independent.
Only a non-native installation-contract check with
`capability: "installation-contract"` and `evidenceKind: "contract"` MAY be
satisfied by installation evidence. Native, `activation-defect`, and
`explicit-native` requirements cannot be satisfied by installation evidence.
An out-of-scope requirement SHALL remain BLOCKED regardless of authorization.
A selected requirement without a fixed adapter or with missing prerequisites
SHALL remain BLOCKED; authorization alone SHALL NOT imply a PASS. Conditional
native execution and its supported capability map are defined by
REQ-850-01.

For each declared check, the CONSUMER report SHALL retain a requirement
evidence object at `surfaceResults.<surface>.requirementEvidence.checkN`, where
`N` is the check's one-based position in the input `checks` array. That object
SHALL store the validated requirement ID in its `id` field. The acceptance
check's `evidenceRef` SHALL use the stable slot path and MUST NOT embed the
requirement ID in the path.

The fixed Host mapping SHALL be checked as part of input validation:

| Consumer surface | Host |
| --- | --- |
| `claude-core` | `claude` |
| `codex-sync` | `codex` |
| `codex-native` | `codex` |
| `cursor-sync` | `cursor` |
| `agent-plugin` | `cursor` |
| `cursor-plugin` | `cursor` |

The accepted trigger values are `new-host`, `loader-change`,
`role-registration-change`, `tool-mapping-change`, `activation-defect`, and
`explicit-native`. A known activation defect or explicit native request remains
required until resolved or the support scope changes explicitly. An
unrequested optional Host may be excluded with a reason; a declared check is
never silently excluded. The complete field, bound, and output contract is in
the [consumer acceptance contract](../../../docs/contracts/consumer-acceptance.md).

#### Scenario: Requirements identify one installation contract

- **WHEN** a bounded requirements file selects `cursor-sync` and declares a
  `contract` check for `installation-contract` with the matching Host
- **THEN** the selected adapter runs once and the requirement uses the actual
  `cursor-sync` installation status
- **AND** its acceptance `evidenceRef` uses
  `surfaceResults.cursor-sync.requirementEvidence.check1`, whose evidence
  value retains the validated input ID
- **AND** `--surface cursor-sync` is accepted only when it exactly matches the
  one-surface requirements scope

#### Scenario: Unsupported native check remains blocked without an adapter

- **WHEN** a selected `codex-sync` check requests an unsupported native
  capability and declares authorization
- **THEN** the requirement remains BLOCKED and acceptance is BLOCKED
- **AND** the gate invokes no native adapter, even when CI or
  `DHPK_CONSUMER_PROBE_EXECUTE` is set

#### Scenario: Declared check is outside the requested adapter scope

- **WHEN** a requirements file declares a check for a surface not included in
  its selected adapter scope
- **THEN** the check remains in `requiredChecks` as BLOCKED with a scope reason
- **AND** no adapter for that surface is invoked

#### Scenario: Unsupported capability cannot pass by installation coincidence

- **WHEN** a declared check uses an unsupported capability or a mismatched
  capability/evidence kind
- **THEN** it remains required and non-passing even if an unrelated installation
  observation passed
- **AND** no arbitrary command, adapter path, executable, or model selection is
  accepted from the requirements file

### Requirement: REQ-850-01 Conditional consumer checks use fixed capability adapters

The consumer gate SHALL evaluate each declared requirement against a finite
surface, capability, and effective evidence-kind map. Every declared check
remains required. Only the existing `installation-contract`/`contract` pair
may use the selected installation record across all six supported surfaces.
The conditional map adds `codex-sync` `named-role-<role>` contract evidence
from the exact role/resource receipt binding, with native evidence from one
exact role dispatch; `agent-plugin` and `cursor-plugin` `package-loader`
contract evidence from their fixed package validators, with native evidence
from their existing challenged loader routes. The Codex role MUST be listed by
the canonical projection manifest and have a concrete TOML and current receipt
entry. No requirements field may select a command, executable, adapter path,
model, or additional role.

Applicability SHALL remain distinct from authorization. The `explicit-native`
trigger SHALL force effective evidence kind `native` even when the requested
kind is `contract`. A supported native adapter SHALL run only when the check is
in scope, its exact contract prerequisites pass, and
`authorization.authorized` is true. Unsupported, unauthorized, out-of-scope,
or prerequisite-missing requirements SHALL remain BLOCKED without a native
call; an observed execution failure SHALL remain FAIL. A contract PASS MUST
resolve to the matching capability observation, and a native PASS MUST resolve
to typed adapter proof for that same capability. Fixtures, generic PASS
objects, and installation evidence cannot satisfy a native check. Only the
individual requirement evidence covered by valid native proof MAY carry
`runtimeVerified: true`; a partial check MUST NOT mark the full surface or
envelope runtime-verified.

#### Scenario: One authorized Codex role check runs as a singleton

- **WHEN** a selected `codex-sync` requirement names one supported role, its
  exact role TOML and referenced resources match the current receipt, the
  contract prerequisites pass, and authorization is true
- **THEN** the gate invokes the fixed Codex adapter for that role only and
  records the role/resource binding and singleton native proof on the matching
  requirement evidence
- **AND** no unrelated optional role is dispatched or made required

#### Scenario: Applicable native work is not authorized

- **WHEN** a selected requirement resolves to a supported native adapter but
  authorization is false
- **THEN** the requirement remains BLOCKED and no native command is invoked,
  even when CI or an inherited execute variable is present

#### Scenario: Challenged package-loader evidence resolves only its own check

- **WHEN** an authorized `package-loader` requirement uses the fixed Agent or
  Cursor loader route and the response verifies its package challenge,
  loader attestation, successful exit, authenticated session, and bounded
  network policy
- **THEN** only that loader requirement may pass and carry
  `runtimeVerified: true`
- **AND** missing or invalid proof is BLOCKED, an observed loader failure is
  FAIL, and fixture or unrestricted output is not native evidence

### Requirement: REQ-849-05 Unscoped consumer acceptance follows configured local markers

When neither `--surface` nor `--requirements` supplies an explicit scope, the
consumer gate SHALL select only the surfaces configured by the repository's
local target markers. It MUST NOT infer configured scope from `PATH`, installed
CLI presence, CI, or ambient execution variables. These markers establish
configured delivery scope only; they do not establish that the corresponding
host or client is installed. An unrequested, unconfigured surface SHALL appear
in `excludedChecks` with status `NOT_CONFIGURED`, a reason naming its absent
marker, and no adapter call.
The required `scope.configuration` check is only a missing-scope result when
an unscoped run has no configured target; it is not a hidden required Host.
When any configured surface is selected, absent optional surfaces stay
excluded independently of that surface's installation result.

The default-scope marker map is owned by the [consumer acceptance contract](../../../docs/contracts/consumer-acceptance.md)
and applies the repository-local configured-scope principle in
[ADR-0002](../../../docs/adr/0002-scope-validation-to-configured-platforms.md).
An explicit `--surface` or requirements-file scope SHALL override marker
discovery and run the requested adapter. The selected adapter's result, not
marker presence, SHALL determine whether its installation prerequisites are
satisfied.

#### Scenario: Unscoped run selects configured surfaces without probing PATH

- **WHEN** the consumer gate receives neither `--surface` nor
  `--requirements`, a repository has configured-surface markers, and other
  consumer CLIs happen to be available on `PATH`
- **THEN** only surfaces whose local target markers exist are selected
- **AND** an unrequested surface without its marker is excluded as
  `NOT_CONFIGURED` with the absent-marker reason
- **AND** no adapter for that unconfigured surface runs

#### Scenario: Marker presence does not claim a client is installed

- **WHEN** a local target marker configures a consumer surface but its host
  client is unavailable
- **THEN** the configured surface remains selected
- **AND** its adapter reports the actual unavailable or missing-prerequisite
  result without treating the marker as proof of client installation

#### Scenario: Explicit scope overrides absent markers

- **WHEN** `--surface` or a requirements scope explicitly selects a surface
  whose local marker is absent
- **THEN** the requested adapter runs
- **AND** the adapter's observed result determines the required check outcome
  rather than automatic `NOT_CONFIGURED` exclusion

#### Scenario: No configured target leaves an explicit blocker

- **WHEN** an unscoped run finds none of the configured-scope markers
- **THEN** no surface adapter runs and each unconfigured optional surface is
  excluded as `NOT_CONFIGURED` with its absent-marker reason
- **AND** acceptance contains a required `scope.configuration` check with
  `surface: "consumer-scope"`, `status: "BLOCKED"`, and `evidenceRef: null`
- **AND** the gate does not return a vacuous or synthetic PASS

#### Scenario: Absent optional Host does not create a missing-scope check

- **WHEN** an unscoped run selects at least one configured surface whose
  installation check passes while another optional surface has no marker
- **THEN** the absent optional surface remains excluded as
  `NOT_CONFIGURED`
- **AND** no required Host or `scope.configuration` check is added
