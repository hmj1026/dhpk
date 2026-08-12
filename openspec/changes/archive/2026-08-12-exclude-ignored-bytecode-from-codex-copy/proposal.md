## Why

Issue #157 shows that Codex copy mode currently traverses ignored Python
bytecode in executed skills. The bytecode is copied into consumer projects and
changes the schema-v3 source fingerprint, making a projection depend on local
Python version and execution history instead of distributable source.

## What Changes

- Apply one distribution-file filter to Codex source inventory, hashing, copy,
  and atomic copy paths.
- Exclude `__pycache__/` directories and `*.pyc` files from copy projections
  and source/destination fingerprints.
- Preserve all existing receipt schema, ownership, collision, migration, and
  rollback behavior for included files.
- Add a fixture regression that injects ignored bytecode and proves omission and
  fingerprint stability through the public installer command.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-install-materialization`: Codex source materialization and evidence
  must ignore non-distributable Python bytecode consistently.

## Impact

- `scripts/hooks/install-codex-skills.sh` embedded Python installer.
- `scripts/release/consumer-gate.js` project-projection fingerprint check.
- `tests/install-codex-skills.test.js` and `tests/consumer-gate-cli.test.js`
  behavioral fixtures.
- No receipt schema or public installer flag changes.
