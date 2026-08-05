# Scope multi-AI validation to configured platforms

Status: accepted

`multi-ai-sync` post-sync validation validates Claude plus target platforms that have deterministic local configuration evidence. An omitted target list uses automatic configured-platform discovery; explicit `--targets` overrides discovery, while `--all-targets` requests a full supported-platform audit. Missing unrequested platforms are reported as `not-configured`, explicitly requested but absent platforms are `BLOCKED`, and configured platforms with invalid artifacts remain `FAIL`.

This boundary prevents absent optional integrations from creating false failures without hiding broken configured integrations. `not-configured` is distinct from `skip-incompatible`; the latter remains an applicable capability limitation. `PASS` exits successfully; `FAIL` and `BLOCKED` return a failure exit code.

**Superseded clause**: this ADR originally stated that a run with no configured targets reports `PARTIAL`. That is exactly the absence-driven downgrade issue #89 (and this ADR's own first paragraph) exists to eliminate, so it does not survive implementation: a run with no configured (and unrequested) optional targets reports every non-Claude row `NOT_CONFIGURED` and the top-level gate `PASS`, consistent with "missing unrequested platforms are reported as `not-configured`" above. `multi-ai-sync validate` implements the final model with report field `gate` valued `PASS`/`FAIL`/`BLOCKED` and per-row values `PASS`/`FAIL`/`NOT_CONFIGURED`/`SKIP_INCOMPATIBLE` (uppercase); `PARTIAL` survives only through a deprecated, removal-pending `legacy_gate` compatibility field — computed independently from whether any applicable row is `SKIP_INCOMPATIBLE`, never from target count alone — for consumers not yet migrated. See `skills/dhpk-cross-agent-sync/references/execution-contract.md` §Validation for the exact mapping.

## Considered Options

- Validate every supported platform by default. Rejected because a repository that does not configure Gemini or Antigravity would fail for an irrelevant absence.
- Detect configuration from installed CLI executables or the current environment. Rejected because results would vary by machine and would not be reproducible in CI.
- Treat every missing target as success. Rejected because an explicit request for an absent platform must remain visible as a blocker.

## Consequences

Validation reports must include the resolved scope and evidence for excluded platforms. Existing failures for selected platforms remain real failures and must not be downgraded by the configured-platform filter. Full cross-platform audits remain available explicitly when a reviewer needs them.
