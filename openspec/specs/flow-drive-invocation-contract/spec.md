# flow-drive-invocation-contract Specification

## Purpose

Define Flow Drive's bounded invocation grammar and its separation between task selection, exact execution targets, Host authorization, optional planning scope, and architect consultation, without expanding supported Hosts or roles.

## Requirements

### Requirement: REQ-FDI-001 - One bounded task and a closed invocation grammar

Flow Drive SHALL accept exactly one task text, task file, or confirmed-change positional input and only the documented options `--worker=auto|provider[/model[:effort]]`, `--reasoner=provider[/model[:effort]]`, boolean `--cross`, `--plan[=auto|bounded|discovery]`, and `--architect` or `--no-architect`. Omitted options SHALL mean worker auto, reasoner absent, cross false, plan disabled, and architect unspecified. Unknown or repeated options and simultaneous architect flags SHALL reject before dispatch. `--worker-target`, `--cross-provider`, `--plan-mode`, and `--plan=model:effort` SHALL NOT remain aliases. Provider, model, and effort segments SHALL be nonempty, whitespace-free, and validated using canonical target grammar and the current capability contract; effort SHALL require a model and extra separators SHALL reject. This change SHALL NOT add a profile or provider alias registry.

#### Scenario: Minimal invocation keeps optional roles disabled

- **WHEN** one settled task is supplied with no flags
- **THEN** Host-native auto policy applies, no reasoner or planner is requested, and architect remains unspecified

#### Scenario: Malformed or ambiguous invocation launches nothing

- **WHEN** the task is blank, missing, or multiple; an option is repeated or unknown; architect flags conflict; or a target is `provider/`, `provider/:high`, `provider:model`, `auto/model`, `provider/model:`, or `provider/model:effort:extra`
- **THEN** parsing rejects before any executor launch or external probe

#### Scenario: Removed grammar does not silently change behavior

- **WHEN** any removed option or `--plan=model:effort` is supplied
- **THEN** an explicit invalid-option or invalid-value result points to the current grammar and no dispatch occurs

### Requirement: REQ-FDI-002 - Selectors and exact targets retain distinct semantics

Flow Drive SHALL normalize unified worker input `auto` and provider shorthand as selectors, and `provider/model[:effort]` as explicit target data, while preserving role and read/write authority. Reasoner SHALL use the same provider and target notation and SHALL support only capabilities already supported by the current Host. Explicit model or effort SHALL NOT be silently substituted; absent effort SHALL resolve only from current Host-supported configuration or defaults satisfying bound capability requirements. Unknown or unsupported model or effort SHALL return an explicit unavailable or blocked result. The existing reasoner terminal `READY_FOR_DISPATCH` receipt gate SHALL remain a prerequisite for its dependent writer.

#### Scenario: Provider shorthand resolves without broadening role

- **WHEN** `--worker=codex` or `--reasoner=codex` is requested
- **THEN** the common engine resolves only the selected role and provider using current Host settings and capability, with unchanged role authority

#### Scenario: Exact tuple preserves precision

- **WHEN** `--worker=codex/gpt-6.1-sol:high` is requested
- **THEN** a successful launch matches the selected model and effort, and missing support blocks without silently switching the tuple

#### Scenario: Syntax acceptance does not expand Host support

- **WHEN** a syntactically valid AGY tuple is unsupported for the current Host and role
- **THEN** an explicit unsupported result is reported with zero launches, while existing supported Hosts remain unaffected

### Requirement: REQ-FDI-003 - Cross-provider intent remains separate from Host grants

An explicit worker or reasoner provider SHALL express intent only for that role and provider and SHALL NOT require redundant `--cross`. `--cross` SHALL only enable non-native candidates for auto selection. Without an explicit external target or `--cross`, Flow Drive SHALL NOT probe or launch external providers. Flow Drive SHALL ignore legacy `DHPK_PROJECT_OPTION_CROSS_PROVIDER` and `CLAUDE_PLUGIN_OPTION_CROSS_PROVIDER` as sources of cross intent. Candidate selection SHALL always pass the common Dispatch Engine and Host scope gate; CLI options, task text, and environment SHALL NOT manufacture a grant. No selected or unselected external provider SHALL be probed or invoked before its required grant; partial grants SHALL cover only their current selected tuples. Existing side-effect, fallback, and recovery requirements in `provider-neutral-dispatch` SHALL remain in force.

#### Scenario: Explicit external provider needs no duplicate intent flag

- **WHEN** `--worker=codex` is requested on a non-Codex Host without `--cross`
- **THEN** the Codex worker request reaches the Host scope gate, an existing current grant permits only its tuple, and pending or denied grant results in zero Codex probes or launches

#### Scenario: Reasoner intent does not authorize worker provider

- **WHEN** only reasoner selects an external provider
- **THEN** the request does not change native auto worker candidates or grant writer authority

#### Scenario: Auto expansion is invocation-local

- **WHEN** auto is used without `--cross` and either legacy cross-provider environment setting is true
- **THEN** only native candidates are considered, while a subsequent invocation with `--cross` may propose non-native candidates that remain blocked until the relevant Host grant

#### Scenario: Partial stale or refused authorization cannot launch

- **WHEN** only another tuple is granted, authorization evidence is stale or mismatched, or the Host refuses the requested tuple
- **THEN** the requested external tuple remains blocked, no flag overrides refusal, and no unselected provider is probed

### Requirement: REQ-FDI-004 - Planner scope and Host planner target configuration are separate

`--plan` SHALL enable the planner with auto scope; `--plan=bounded`, `--plan=discovery`, and `--plan=auto` SHALL select their stated scope. Planner model and effort SHALL NOT be encoded in `--plan`. Resolution SHALL consume current Host-supported `planner_target`, `planner_model`, and `planner_effort` normalization or a declared Host-native planner default; it SHALL NOT assume every Host exposes Claude plugin configuration or access another checkout or Host's configuration. Explicit invalid configuration or a requested planner without supported or default capability SHALL return a clear unavailable or blocked result, and SHALL NOT ignore the request or silently replace the configured tuple. When plan is omitted, these dependencies SHALL NOT be required.

#### Scenario: Configured planner follows requested scope

- **WHEN** `--plan=bounded` is requested and the current Host has supported planner target configuration
- **THEN** bounded scope uses that target while preserving the configured model and effort

#### Scenario: Host-native declared default works without Claude configuration

- **WHEN** plan is requested on a Host without Claude plugin settings but with a declared supported native planner default
- **THEN** auto scope uses that default under the same role and permission contract

#### Scenario: Missing planner capability is observable

- **WHEN** plan is requested but the current Host has neither valid configuration nor a declared supported default
- **THEN** a clear blocker is reported with no dependent writer launch and no ambient configuration fallback

### Requirement: REQ-FDI-005 - Architect selection preserves a validated three-state request

`--architect` SHALL request consultation, `--no-architect` SHALL suppress optional consultation, and omission SHALL preserve the existing decision policy. Both flags together SHALL reject. No state SHALL bypass required architecture or read-only evidence gates or authorize writes.

#### Scenario: Explicit request uses supported architecture route

- **WHEN** architect consultation is requested
- **THEN** current supported architecture consultation is required before dependent work or is reported explicitly unavailable, without silently ignoring the request

#### Scenario: Opting out does not waive a required gate

- **WHEN** `--no-architect` is supplied but an unresolved prerequisite requires architectural evidence
- **THEN** the dependent writer remains blocked because optional consultation suppression is not approval

#### Scenario: Omission retains policy

- **WHEN** neither architect option is supplied
- **THEN** existing task-fit decision policy applies without implying an explicit request or bypass
