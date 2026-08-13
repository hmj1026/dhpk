# Implementation evidence

## Issue finding

- GitHub #157 reproduction with a temporary fake plugin: adding ignored
  `__pycache__/` and standalone `.pyc` entries under a Python-backed Codex
  skill caused `--copy` to materialize the bytecode and changing those files
  changed the receipt `source_fingerprint`.
- Existing comparable package generators already exclude `__pycache__` and
  `.pyc`; the installer was the remaining unfiltered distribution path.

## Regression and verification

### RED baseline

- Before the implementation, the new installer fixture produced the intended
  failure: ignored bytecode was copied into the projection and changing it
  changed the receipt `source_fingerprint` (`copied_pyc: true`,
  `fingerprint_changed: true`). The focused installer suite was 33/34.
- The release consumer gate then exposed the same contract gap: its independent
  project fingerprint still included the checkout's ignored bytecode, so the
  clean-consumer check reported Codex duplicate-surface validation as
  `BLOCKED` until the gate traversal received the matching filter.

- `bash -n scripts/hooks/install-codex-skills.sh` — PASS.
- `node tests/install-codex-skills.test.js` — PASS (34/34), including the new
  omission and fingerprint-stability fixture for both ignored patterns.
- `node tests/consumer-gate-cli.test.js` — PASS (10/10), including the
  release-gate fingerprint stability fixture.
- `git diff --check` — PASS.
- `openspec validate exclude-ignored-bytecode-from-codex-copy --strict
  --no-interactive` — PASS.

No receipt schema or installer flag changed.
