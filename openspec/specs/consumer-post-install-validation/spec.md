# consumer-post-install-validation Specification

## Purpose

TBD - created by archiving change repair-open-issues-and-agent-guidance. Update Purpose after archive.
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

`codex-sync` validation SHALL additionally verify that every
receipt-managed agent role is a physical file and SHALL run a bounded named-
role probe through a fresh Codex CLI session. The probe SHALL run under a
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
