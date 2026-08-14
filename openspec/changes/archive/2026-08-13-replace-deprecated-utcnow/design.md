## Context

The installer embeds a Python reconciliation program in
`scripts/hooks/install-codex-skills.sh`. It currently uses naive
`datetime.utcnow()` values for the backup-run directory and the receipt's
`installed_at` field. Python 3.14 deprecates that API, but the installer must
continue emitting the existing UTC-with-`Z` format consumed by receipts and
rollback tooling.

## Goals / Non-Goals

**Goals:**

- Use the standard-library timezone-aware UTC API at both timestamp sites.
- Keep backup names and receipt values byte-compatible with the current format
  apart from removing warnings.
- Prove the behavior through the public shell installer and an isolated fixture.

**Non-Goals:**

- No receipt schema, ownership, reconciliation, backup, or CLI behavior change.
- No new dependency or clock abstraction.
- No broad timestamp cleanup outside this installer.

## Decisions

- **Use `datetime.datetime.now(datetime.timezone.utc)`.** This is the supported
  timezone-aware replacement available in the existing Python standard library.
  `datetime.UTC` is avoided because the installer remains compatible with older
  Python 3 versions that may not expose that alias.
- **Keep explicit formatting at each existing call site.** The backup-run name
  continues to use `%Y%m%dT%H%M%SZ`; `installed_at` continues to remove
  microseconds, serialize with `isoformat()`, and append `Z`. A shared helper
  would add surface area without changing the two established wire contracts.
- **Test through the shell command with warnings-as-errors.** The regression
  invokes the supported installer in a temporary project with
  `PYTHONWARNINGS=error::DeprecationWarning`, then checks exit status, receipt
  timestamp shape, and the absence of warning text. This covers the real
  embedded Python boundary rather than an internal helper.

## Risks / Trade-offs

- [Risk] A future Python version changes ISO formatting assumptions → Mitigation:
  assert the existing second-precision `...Z` shape in the focused regression.
- [Risk] Warning-as-error behavior differs across Python versions → Mitigation:
  keep the test scoped to `DeprecationWarning` and retain the existing installer
  suite for supported-version behavior.
