# consumer-runtime-preflight Specification

## Purpose
Provide a bounded, redacted preflight contract that proves an authenticated
consumer runner is ready to execute exact-head runtime evidence without exposing
credentials or promoting preflight success to release completion.

## Requirements

### Requirement: Consumer runtime preflight is exact-head identity-bound

A consumer-runtime preflight SHALL emit task ID, attempt ID, source commit, source
tree, target commit, target tree, worktree cleanliness, runner capability
versions, and the selected consumer surfaces. The preflight identity SHALL be
usable to match the subsequent deployment and consumer probe receipt, and a
preflight from a different checkout or attempt MUST be rejected as stale.

#### Scenario: Clean exact-head runner is preflighted

- **WHEN** a runner preflights a clean checkout for a declared exact source and target identity
- **THEN** the result records the identity and runner capability versions without recording credential contents

#### Scenario: Preflight identity does not match the deployed artifact

- **WHEN** a deployment or consumer probe presents a preflight with a different source/tree, target/tree, task, or attempt identity
- **THEN** the evidence is rejected as foreign or stale and cannot satisfy a release phase

### Requirement: Preflight classifies runtime readiness without promotion

A preflight SHALL report each requested consumer surface with an explicit
machine-readable status and a bounded, redacted reason code for authentication,
network, timeout, CLI compatibility, sandbox, or package conditions when
available. `PASS` from a preflight SHALL indicate runner readiness only and MUST
NOT satisfy a consumer-runtime `PASS` or full-release `COMPLETE` by itself.

#### Scenario: Runner dependency is unavailable

- **WHEN** a required client, sandbox, or network prerequisite cannot be used
- **THEN** preflight records `UNAVAILABLE` or `BLOCKED` with a redacted reason code and the release remains non-complete

#### Scenario: Preflight succeeds but consumer runtime is not run

- **WHEN** all runner prerequisites pass but a consumer probe is `NOT_RUN`, `SKIP_INCOMPATIBLE`, or `UNAVAILABLE`
- **THEN** the preflight remains informational and the required-runtime gate remains non-complete

### Requirement: Preflight evidence excludes credentials and host overlays

Preflight evidence SHALL record only allowlisted session file names or counts,
tool versions, status classifications, and redacted diagnostics. It MUST NOT
record token values, cookies, private keys, raw OAuth payloads, arbitrary host
HOME paths, or unallowlisted host file contents.

#### Scenario: Authenticated session is cloned for a probe

- **WHEN** the runner supplies an allowlisted authenticated session to a disposable probe HOME
- **THEN** the receipt records only the allowlist identity and resulting status, while the session contents remain outside the receipt

#### Scenario: Diagnostic contains sensitive text

- **WHEN** a client or sandbox emits a diagnostic containing a credential, private path, or host overlay marker
- **THEN** the evidence replaces the sensitive value with a redaction marker before persistence or display
