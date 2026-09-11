# host-provider-capability-matrix Specification

## Purpose
TBD - created by archiving change provider-neutral-subagent-orchestration. Update Purpose after archive.
## Requirements
### Requirement: Capability resolution combines Provider catalog and Host access

The resolver SHALL combine a Provider Model Catalog with the current Host Access
Policy. The catalog SHALL describe Provider/Model support for Roles, Effort
levels, Transports, and authority; the Host policy SHALL describe native
Provider, allowed Providers, installation or authentication evidence, quotas,
and concurrency limits.

#### Scenario: Catalog support is not sufficient for execution

- **WHEN** the catalog says Codex Sol5.6 supports `reasoner` but the current
  Host has no authenticated Codex CLI
- **THEN** the resolved capability is `UNAVAILABLE` or `BLOCKED` with Host access
  evidence

#### Scenario: Host access does not invent model support

- **WHEN** a Host has an authenticated Provider but the requested Model/Effort
  is absent from the catalog
- **THEN** the target is unavailable and no alternate Model is inferred

### Requirement: Model identities are Provider-scoped

The matrix SHALL identify Models by Provider and model ID together. A bare
display name SHALL not identify a target, and Provider-specific aliases SHALL be
resolved before capability evaluation.

#### Scenario: Same display name is disambiguated

- **WHEN** two Providers expose Models with the display name `opus5`
- **THEN** the matrix evaluates them as distinct Provider-scoped Model entries

#### Scenario: Codex Sol5.6 is explicit

- **WHEN** a request names `codex-cli/sol5.6`
- **THEN** capability lookup uses the Codex Provider entry and does not search a
  global `sol5.6` Model

### Requirement: Effort is normalized before Provider translation

The matrix SHALL expose canonical Effort levels `low`, `medium`, `high`, and
`max`. A Provider entry MAY map those levels to Provider-specific settings;
callers SHALL not need to know those settings.

#### Scenario: High effort maps per Provider

- **WHEN** Claude Code and Codex CLI both receive `high`
- **THEN** each Adapter receives its own mapped setting while the request and
  receipt retain canonical `high`

#### Scenario: Unsupported effort is explicit

- **WHEN** a Provider Model does not support requested `max` Effort
- **THEN** the matrix returns the missing capability and does not silently lower
  Effort

### Requirement: Availability and access evidence use explicit statuses

Capability resolution SHALL distinguish `AVAILABLE`, `UNAVAILABLE`, and
`BLOCKED`, and `NOT_RUN`, and SHALL include concise evidence for installation,
authentication, Model, Transport, authority, or policy failure. Static
declarations SHALL not be reported as runtime success, and `NOT_RUN` SHALL not
be promoted to `AVAILABLE`.

#### Scenario: Missing CLI is unavailable

- **WHEN** a declared external Provider executable is missing
- **THEN** its target is `UNAVAILABLE` with the executable evidence

#### Scenario: User denial is blocked

- **WHEN** a Host policy denies a Provider despite the catalog supporting it
- **THEN** resolution is `BLOCKED` with policy evidence and does not probe the
  denied Provider

#### Scenario: Unperformed probe is not availability

- **WHEN** a declared target has not had its bounded runtime probe performed
- **THEN** resolution reports `NOT_RUN` and automatic selection does not claim
  that the target is available

### Requirement: Automatic capability checks respect Host policy

Automatic selection SHALL use only Providers allowed by the current Host Access
Policy and SHALL not launch or authenticate an undeclared external Provider just
to discover whether it is available. Explicit target requests MAY perform the
Adapter's bounded preflight.

#### Scenario: Automatic selection does not probe undeclared AGY

- **WHEN** AGY is absent from the current Host policy and the request is
  automatic
- **THEN** the resolver skips AGY without launching or authenticating it

#### Scenario: Explicit Codex request is checked

- **WHEN** a user explicitly requests Codex CLI
- **THEN** the resolver or Adapter performs the allowed preflight and reports
  exact availability evidence

#### Scenario: Explicit denied Provider is blocked

- **WHEN** a user explicitly requests a Provider that the Host Access Policy
  denies
- **THEN** resolution returns `BLOCKED` with policy evidence and does not probe
  or launch that Provider

### Requirement: Host identity and native execution are explicit

The caller SHALL provide a versioned Host Profile containing Host identity,
native Provider, native Transport, allowed Providers, access evidence, quota
pools, and concurrency limits. Environment inspection MAY contribute diagnostic
evidence, but SHALL not invent Host identity or prove Provider availability.

#### Scenario: Missing Host profile is blocked

- **WHEN** a request has no explicit Host Profile or the profile is internally
  inconsistent
- **THEN** capability resolution returns `BLOCKED` and does not assume Claude as
  the native Provider

#### Scenario: Native Provider comes from profile

- **WHEN** the Host Profile declares Cursor native as the native Provider
- **THEN** automatic fallback uses Cursor native even when Claude Code is
  installed

### Requirement: Automatic selection prefers native and requires external opt-in

Automatic selection SHALL prefer the current Host's native target. External
Providers SHALL be considered automatically only when the Host Access Policy
explicitly allows them and the requested capability is available. An explicit
target MAY perform a bounded preflight, but automatic selection SHALL not launch
or authenticate an undeclared Provider to discover availability.

#### Scenario: Eligible native target wins

- **WHEN** the native target and an external target are both eligible
- **THEN** automatic selection chooses the native target when no explicit
  preference is configured

#### Scenario: Explicit preference may rank an external target

- **WHEN** an external target is allow-listed, fully eligible, and an explicit
  preference ranks it before the native target
- **THEN** automatic selection may choose the external target while preserving
  all capability, authority, scope, quota, and fallback checks

#### Scenario: External automatic target requires opt-in

- **WHEN** an external Provider is available in the catalog but is absent from
  Host Access Policy
- **THEN** automatic selection skips it without probing or launching it

### Requirement: Host-native and concurrency metadata are explicit

The Host Access Policy SHALL declare the Native Provider and applicable
concurrency, quota, and scope constraints. No Provider identity SHALL be used
as a universal concurrency restriction.

#### Scenario: Native fallback comes from Host metadata

- **WHEN** the current Host profile declares Cursor native as its Native Provider
- **THEN** automatic fallback resolves Cursor native even if Claude is installed

#### Scenario: Provider quota limits a wave

- **WHEN** two targets share a Provider quota pool whose remaining capacity is
  one
- **THEN** the scheduler admits at most one and records the quota reason for the
  other
