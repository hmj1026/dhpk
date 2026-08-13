## Why

The supported Codex project-local installer still calls `datetime.utcnow()`
when creating backup-run and receipt timestamps. Python 3.14 emits a
`DeprecationWarning` on every successful sync, making a healthy installation
noisy and preventing warning-as-error verification even though the receipt
format is otherwise valid.

## What Changes

- Replace both deprecated naive-UTC timestamp calls with timezone-aware UTC
  construction.
- Preserve the existing second-precision UTC wire format and trailing `Z` in
  backup directory names and `installed_at` receipt values.
- Add an installer regression that runs the public sync command with
  deprecation warnings treated as errors and verifies the receipt timestamp.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-install-materialization`: successful syncs must create UTC timestamps
  without deprecated Python API warnings while retaining the receipt contract.

## Impact

- `scripts/hooks/install-codex-skills.sh` embedded Python installer.
- `tests/install-codex-skills.test.js` public installer regression coverage.
- No CLI flags, receipt schema version, ownership behavior, or rollback policy
  changes.
