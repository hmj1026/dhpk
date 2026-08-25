# Cursor Consumer Probe Safety Specification

## Purpose

Define finite, diagnosable, read-only execution for the optional Cursor CLI
consumer probe without confusing runtime evidence with package validation.

## Requirements

### Requirement: Cursor consumer probes are finite and bounded

The configured Cursor consumer probe SHALL validate a positive safe-integer
timeout below a fixed hard maximum, use a finite default when none is supplied,
and cap captured child output below a fixed hard maximum. A timeout with
captured output or an output-limit event MUST return a machine-readable
`BLOCKED` result with `exit_code`, `signal`, and `PASS`-ineligible evidence.
A timeout with no stdout or stderr MUST return `SKIP_INCOMPATIBLE` with
`no_stdout: true` and MUST NOT claim discovery `PASS`. The probe MUST NOT
mutate package or Cursor state. On POSIX, ordinary descendants SHALL be
terminated with the probe process group; deliberately detached descendants
are outside the guarantee.

#### Scenario: Hung Cursor client is blocked after the deadline

- **WHEN** an explicitly configured Cursor probe does not exit before its
  finite timeout and has already emitted captured output
- **THEN** the result is `BLOCKED`, includes `timed_out: true` and the timeout
  duration plus exit/signal evidence, and does not claim consumer discovery
  `PASS`

#### Scenario: Silent hung Cursor client is CLI-incompatible

- **WHEN** an explicitly configured Cursor probe does not exit before its
  finite timeout and emits no stdout or stderr
- **THEN** the result is `SKIP_INCOMPATIBLE`, includes `timed_out: true` and
  `no_stdout: true`, names that the CLI has no non-LLM plugin list, and does
  not claim consumer discovery `PASS`

#### Scenario: Invalid timeout fails closed

- **WHEN** a caller supplies zero, a negative value, or a non-safe integer as
  the probe timeout
- **THEN** the probe rejects the configuration before invoking the client

#### Scenario: Probe output is bounded and redacted

- **WHEN** the client emits output during a probe
- **THEN** returned diagnostics are capped and redacted, and an output-limit
  result is `BLOCKED` rather than an unbounded successful capture

### Requirement: Probe outcomes remain separate from package validation

The Cursor generator and validator SHALL preserve structural/provenance results
separately from the bounded consumer result. A silent timeout MUST remain
`SKIP_INCOMPATIBLE`; a timeout with captured output, unavailable client, or
unexecuted route MUST remain `BLOCKED`, `UNAVAILABLE`, or `NOT_RUN`
respectively and SHALL NOT be promoted to runtime discovery support. The documented wrapper
MUST resolve a Cursor executable from `PATH` and require a non-empty valid JSON
response containing positive evidence for the requested dhpk skills, commands,
agents, and rules before returning consumer `PASS`; clear negative/no-result
responses SHALL remain `BLOCKED`. The probe child SHALL receive an allowlisted
environment and MUST NOT inherit arbitrary credential variables. The documented
launch-scoped wrapper MUST pass `--trust` so the client does not wait for an
interactive workspace-confirmation prompt, and POSIX probes MUST ignore stdin.
The release consumer route SHALL additionally run from a disposable package
workspace and profile. Authenticated release probes SHALL use a verified
bubblewrap namespace with a read-only root, masked host secret roots, a
read-only bind for only the required client runtime root, and writable paths
contained below a private temporary root. The authenticated release network
mode SHALL be controlled shared networking (`--unshare-all` followed by
`--share-net`); unrestricted execution MUST NOT be used. Offline/fixture
probes MAY use technically disabled networking. If the requested OS network
namespace cannot be established, the route SHALL return `BLOCKED` with
`network: unknown`; fixture-only unsandboxed overrides MUST NOT be eligible for
release `PASS`. DNS or transport failures SHALL be `UNAVAILABLE`, not product
`FAIL`. It SHALL require
a package-owned loader boundary (the
temporary package hook/command) to emit an attestation containing a matching
package fingerprint and loaded component list. A challenge file, launcher
environment variable, prompt echo, or model-reported fields alone SHALL never
be sufficient for runtime `PASS`. For a client under a home directory, normal
installations SHALL bind only the physical directory containing the resolved
executable; a trusted Homebrew-style `.linuxbrew` prefix MAY be rebound as an
explicit runtime exception when absolute sibling libraries require that prefix.
Direct home-root and direct `.local` executables SHALL be rejected.

#### Scenario: Launch-scoped probe skips workspace confirmation

- **WHEN** a POSIX launch-scoped probe runs through the documented wrapper
- **THEN** the child is spawned with stdin ignored and `--trust` so it does
  not wait on a workspace-confirmation prompt or inherit the caller TTY

#### Scenario: Structural package is valid but the client hangs

- **WHEN** Cursor package validation passes and the configured consumer probe
  times out with no stdout or stderr
- **THEN** structural evidence remains `PASS` while the consumer evidence is
  `SKIP_INCOMPATIBLE` with `no_stdout: true`

#### Scenario: Successful process without a response is blocked

- **WHEN** the configured process exits zero but emits no valid JSON response
- **THEN** the wrapper returns `BLOCKED` and does not claim Cursor discovery
  `PASS`

#### Scenario: Negative capability response is blocked

- **WHEN** the client returns valid JSON explicitly saying that the requested
  dhpk skills, commands, agents, or rules were not discovered
- **THEN** the wrapper returns `BLOCKED` rather than treating keyword presence
  as positive discovery evidence

#### Scenario: Prompt echo cannot satisfy the release consumer probe

- **WHEN** a Cursor process returns the requested capability words but the
  package-owned loader hook does not emit the matching attestation
- **THEN** the release consumer route returns `BLOCKED` and records that plugin
  loading is unproven

#### Scenario: Cursor network state is not falsely reported

- **WHEN** the release consumer route cannot establish an OS network namespace
- **THEN** the result is `BLOCKED` with network state `unknown`, rather than a
  false `disabled` claim

#### Scenario: Release consumer probe uses disposable state

- **WHEN** the release consumer route invokes Cursor with `--execute`
- **THEN** it stages the Agent/Cursor packages into a disposable workspace,
  assigns a temporary profile/config/cache root, and removes those paths after
  the bounded invocation

### Requirement: Cursor probes clone an allowlisted login session into disposable HOME

The Cursor consumer probe SHALL create a disposable probe HOME and SHALL copy
only allowlisted already-logged-in session files from the host into that HOME:
`$HOME/.config/cursor/auth.json` and, when present,
`$HOME/.cursor/cli-config.json`. Copied files MUST use mode `0600`. The probe
MUST NOT inherit the host HOME, MUST NOT copy the rest of the host
Cursor/config tree, and MUST NOT use `CURSOR_API_KEY` or any other API key as
consumer authentication. Probe diagnostics and receipts MUST redact session
contents. The disposable HOME MUST be deleted after the bounded invocation.
The probe SHALL expose explicit `disabled`, `shared`, and legacy
fixture-only `unrestricted` network modes. Unrestricted mode MUST be rejected
unless the caller explicitly opts into the fixture-only path; it MUST NOT be
the default for an authenticated or release route. Authenticated release
probes MUST use a verified bubblewrap namespace with a read-only root,
writable temporary probe paths, `--unshare-all` followed by `--share-net`, and
MUST NOT use unrestricted execution. A verified sandbox executable MUST be a
non-symlink, root-owned executable under non-writable ancestors. The namespace
MUST mask host secret roots and bind only the required client runtime root.
Writable probe paths MUST be real non-symlink directories contained below the
private temporary root. Normal home installations SHALL bind only the physical
directory containing the resolved client executable; a trusted Homebrew-style
`.linuxbrew` prefix MAY be rebound only when absolute sibling libraries require
that self-contained runtime tree. Direct home-root and direct `.local`
executables SHALL be rejected. Offline/fixture probes MAY use `disabled`; inability
to establish the requested sandbox SHALL remain `BLOCKED` with
`network: unknown`. DNS or transport failures SHALL be `UNAVAILABLE`, not
product `FAIL`.

#### Scenario: Host session files are cloned without inheriting HOME

- **WHEN** the host has the allowlisted Cursor session files and the release
  consumer probe runs
- **THEN** the child runs with a disposable HOME containing only those copied
  files at `0600`, and the host HOME is not the child HOME

#### Scenario: Missing login is BLOCKED

- **WHEN** the allowlisted session files are absent or the Cursor CLI reports
  that authentication is required
- **THEN** the consumer result is `BLOCKED` with a redacted diagnostic, and
  MUST NOT be `FAIL` or `PASS`

#### Scenario: API key authentication is rejected

- **WHEN** a caller supplies `CURSOR_API_KEY` or another API-key environment
  variable as the only Cursor credential
- **THEN** the probe does not treat that as login evidence and remains
  `BLOCKED` unless allowlisted session files were cloned

#### Scenario: Network policy is explicit and fail-closed

- **WHEN** an authenticated release consumer probe runs after cloning session
  files
- **THEN** the child runs in the controlled shared-network bubblewrap
  namespace, with `--share-net` after `--unshare-all`; a missing sandbox is
  `BLOCKED` with `network: unknown`, and an unrestricted release request is
  rejected before invoking the client

#### Scenario: Offline probes remain network-disabled

- **WHEN** a fixture or explicitly offline probe requests `networkMode:
  disabled`
- **THEN** the child runs with network isolation disabled, and the result
  records `network: disabled` only after the sandbox wrapper succeeds

#### Scenario: Host secrets and caller paths stay outside the release namespace

- **WHEN** a release probe runs with a client under the host home directory or
  a caller-supplied `cwd` outside the temporary root
- **THEN** host secret roots remain masked, only the client runtime subtree is
  rebound read-only, and the probe is `BLOCKED` instead of creating a
  writable bind outside the private temporary root

#### Scenario: PATH shims cannot become sandbox backends

- **WHEN** a regular user-owned `bwrap` or `unshare` shim appears before the
  system executable on `PATH`
- **THEN** the shim is ignored, the probe uses a verified trusted executable,
  or the requested sandbox remains unavailable; the shim MUST NOT be executed
  as the release backend

### Requirement: Cursor runtime evidence is the cursor-agent CLI

Cursor consumer-runtime `PASS` SHALL be produced only by a bounded
`cursor-agent` invocation. Desktop GUI flows, the `cursor` desktop binary,
Customize → Plugins, and project-local `.cursor/` trees SHALL NOT satisfy
Cursor runtime `PASS`. `cursor-plugin` SHALL invoke `cursor-agent` with both
the portable Agent Plugin directory and the Cursor-native package directory.
`agent-plugin` SHALL use a separate single-directory invocation defined by the
portable-package consumer contract.

#### Scenario: Desktop client is not runtime evidence

- **WHEN** only a Cursor desktop GUI, hanging `cursor` binary, or project-local
  `.cursor/` tree is observed
- **THEN** the Cursor consumer-runtime row MUST NOT become `PASS`

#### Scenario: cursor-plugin uses dual plugin directories

- **WHEN** the `cursor-plugin` consumer probe runs
- **THEN** it launches `cursor-agent` with `--plugin-dir` for the portable
  Agent Plugin package and `--plugin-dir` for the Cursor-native package
