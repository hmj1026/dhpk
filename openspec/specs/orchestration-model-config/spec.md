# orchestration-model-config Specification

## Purpose
TBD - created by archiving change dhpk-orchestration-workers. Update Purpose after archive.
## Requirements
### Requirement: userConfig keys for role models and the dispatch switch

The configuration contract SHALL support Host-aware Provider/Model/Effort
resolution for `planner`, `reasoner`, `worker`, and `reviewer`. Canonical
configuration MAY select a Provider-scoped Model and normalized Effort per Role;
the current Host profile and Capability Matrix SHALL determine whether the
selection is available. Existing Claude role keys and
`orchestration_dispatch` remain compatibility inputs during migration, with
project configuration taking precedence over global configuration and shipped
defaults.

#### Scenario: Project-level Provider-scoped override wins

- **WHEN** global configuration selects `claude-code/opus5` and the project's
  Host policy selects `codex-cli/sol5.6` for `reasoner`
- **THEN** the project value is the effective target, subject to capability and
  authority validation

#### Scenario: Host native default is contextual

- **WHEN** no Provider/Model override is configured
- **THEN** the effective default comes from the current Host profile rather than
  a Claude-specific literal

### Requirement: Session-start surfacing of the effective configuration

Session-start diagnostics SHALL surface only non-default Provider, Model, Effort,
fallback, or dispatch values and SHALL identify the current Host. With all
defaults, no orchestration line is emitted. Diagnostics SHALL not claim a
Provider is available merely because it appears in a static catalog.

#### Scenario: Defaults produce no output

- **WHEN** no orchestration value differs from the current Host defaults
- **THEN** session-start prints no orchestration line

#### Scenario: External target is announced

- **WHEN** Cursor selects Claude Code Opus5 for a reasoner pass
- **THEN** session-start identifies the Host, Provider, Model, and normalized
  Effort when the value is non-default

### Requirement: Per-dispatch application via the Agent model param

The orchestrator SHALL apply a resolved Provider-scoped Model and normalized
Effort through the selected Adapter or native invocation contract. It SHALL not
pass Claude Agent model parameters to an external Provider Adapter. A one-off
escalation MAY request a different target only when the dispatch policy records
the reason and the Capability Matrix validates it.

#### Scenario: Configured external value is applied

- **WHEN** `reasoner` resolves to Codex CLI `sol5.6` at `high`
- **THEN** the Codex Adapter receives that Model and normalized Effort under
  the same Role contract

#### Scenario: One-off escalation is auditable

- **WHEN** a high-risk task requests a stronger Model/Effort than the Host
  default
- **THEN** the receipt records the override and its policy reason

### Requirement: Validation and fallback for invalid values

Invalid Provider, Model, Effort, or Host configuration SHALL warn once per
session or return a bounded `BLOCKED` result according to the affected request
class. Automatic delegation SHALL use the current Host native target as its
fallback when unavailability is confirmed before side effects. An explicitly
requested target SHALL not silently fallback unless its request policy allows
it.

#### Scenario: Invalid Model is blocked or safely defaulted

- **WHEN** a configured Model is absent from the Provider catalog or cannot be
  verified for the current Host
- **THEN** the request reports the exact capability failure and uses Host-native
  fallback only when automatic policy permits it

#### Scenario: Explicit target does not silently change

- **WHEN** a user explicitly selects an unavailable Model without allowing
  fallback
- **THEN** the dispatch returns `BLOCKED` and does not run another Provider

### Requirement: Kill switch restores pre-change behavior

When `orchestration_dispatch=off`, touched flows SHALL not use the new
Provider-neutral Dispatch Engine. They SHALL preserve the documented pre-change
inline or caller-owned behavior and SHALL not emit a false capability or
fallback success.

#### Scenario: Off switch regression check

- **WHEN** `orchestration_dispatch=off`
- **THEN** the affected flow follows its pre-change behavior and no new
  Provider selection is performed

### Requirement: userConfig keys for CLI-backed fast-worker models

The manifest and generic config loader SHALL expose canonical Host-aware
Provider/Model/Effort and timeout settings for supported worker Roles. Legacy
keys such as `codex_fast_worker_*`, `codex_deep_reasoner_*`, `codex_bridge_*`,
and `agy_fast_worker_model` MAY be read as aliases for one release; canonical
keys take precedence and diagnostics identify legacy use. The configuration
contract SHALL not assume that a CLI-backed target is always external or that
Claude is always native. Timeout budgets SHALL be enforced by the attested
portable transport runner, which reports the effective deadline and never
delegates containment to a shell timeout backstop.

#### Scenario: Canonical target key wins

- **WHEN** a canonical Codex target and a legacy Codex worker key are both
  configured
- **THEN** the canonical target supplies the effective Provider/Model/Effort
  and the legacy source is reported as deprecated

#### Scenario: Shared timeout remains stable

- **WHEN** only the shared timeout is configured
- **THEN** every eligible external Adapter inherits it according to the existing
  scope and Role precedence rules

#### Scenario: Invalid target is safe

- **WHEN** a target contains an unknown Provider, Model, or Effort
- **THEN** configuration reports the invalid value and prevents an unauthorized
  dispatch or applies the permitted Host-native fallback

### Requirement: CLI-backed worker model defaults are lockstep across all declaration sites
A CLI-backed worker's default model string is declared in more than one file — the `userConfig` schema, the agent definition and its index entry, the wrapper script's usage text, the economics rule table, the configuration docs in every shipped language, the session-start default-detection expression, the test fixtures, **and any spec requirement that quotes the shipped default as normative text** (see the `model-economics` capability, whose tier-map requirement names the default inline). When that default changes, every declaration site SHALL be updated in the same change.

The enumeration above SHALL be read as covering both shipped files and governing spec text. Treating it as a list of shipped files only is the failure mode that let a live spec requirement keep pinning a superseded default while the rule file it governs moved on. In particular, `scripts/hooks/session-start.sh` compares the effective value against the shipped default to decide whether to announce a non-default configuration; leaving a stale literal there SHALL be treated as a defect, because it makes every session report a non-default worker model that is in fact the default.

#### Scenario: Default change updates every site
- **WHEN** the shipped default for a CLI-backed worker model is changed
- **THEN** the `userConfig` default, agent definition, agent index, wrapper usage text, economics table, all localized configuration docs, session-start comparison, test fixtures, and every spec requirement quoting that default as normative text all carry the new value

#### Scenario: Stale session-start literal is a defect
- **WHEN** the default model is changed but the session-start comparison still names the previous value
- **THEN** the session announces a non-default worker model on every start, and this is treated as a defect rather than cosmetic drift

#### Scenario: Spec text quoting a default is a declaration site
- **WHEN** a live spec requirement names a shipped default inline as normative text
- **THEN** that requirement is updated in the same change as the shipped files, so the governed file never contradicts the requirement governing it

#### Scenario: Overrides continue to layer
- **WHEN** a project or global config overrides the worker model after the default changes
- **THEN** the override still wins over the new shipped default with unchanged layering semantics
