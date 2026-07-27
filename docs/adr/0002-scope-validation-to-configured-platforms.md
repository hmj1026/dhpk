# Scope multi-AI validation to configured platforms

Status: accepted

`multi-ai-sync` post-sync validation validates Claude plus target platforms that have deterministic local configuration evidence. An omitted target list uses automatic configured-platform discovery; explicit `--targets` overrides discovery, while `--all-targets` requests a full supported-platform audit. Missing unrequested platforms are reported as `not-configured`, explicitly requested but absent platforms are `BLOCKED`, and configured platforms with invalid artifacts remain `FAIL`.

This boundary prevents absent optional integrations from creating false failures without hiding broken configured integrations. `not-configured` is distinct from `skip-incompatible`; the latter remains an applicable capability limitation and may produce `PARTIAL`. The change is limited to validation scope and reporting, so Claude-first planning, approval, dry-run, apply behavior, and existing `PASS`/`PARTIAL`/`FAIL` semantics remain intact. A run with no configured targets validates Claude only and reports `PARTIAL`; `PASS` and `PARTIAL` exit successfully, while `FAIL` and `BLOCKED` return a failure exit code.

## Considered Options

- Validate every supported platform by default. Rejected because a repository that does not configure Gemini or Antigravity would fail for an irrelevant absence.
- Detect configuration from installed CLI executables or the current environment. Rejected because results would vary by machine and would not be reproducible in CI.
- Treat every missing target as success. Rejected because an explicit request for an absent platform must remain visible as a blocker.

## Consequences

Validation reports must include the resolved scope and evidence for excluded platforms. Existing failures for selected platforms remain real failures and must not be downgraded by the configured-platform filter. Full cross-platform audits remain available explicitly when a reviewer needs them.
