# Issue #470 test governance

This batch removes one confirmed duplicate test entry point while retaining
the production-script coverage obligation.

## Disposition record

| Item | Owner / invariant | Before | After | Replacement evidence |
| --- | --- | --- | --- | --- |
| `tests/fast-worker-selector.test.js` | `scripts/fast-worker-selector.js`; selector and fallback semantics | Forwarding wrapper required the full implementation test, so the aggregate runner discovered both files | Removed; only `tests/fast-worker-selection.test.js` is discovered | `scripts/ci/catalog.js` maps the production script to `fast-worker-selection.test.js`; `tests/test-entrypoint-dedup.test.js` asserts no uncovered script |

The implementation test remains the single owner of selector behavior, and its
mutating temporary directories remain local to each test case. No receipt,
HOME, workspace, or security-state fixture is shared. The baseline collector
now treats the removed wrapper as absent; the historical #467 JSON remains an
immutable record of the prior candidate and is not rewritten.

## Scope and timing evidence

The #467 baseline recorded 314 test files and approximately 144 seconds on
Node 26/macOS, with known environment-sensitive failures. The latest
`develop` before this batch contains 319 test files; this batch keeps the file
count at 319 because one forwarding entry is removed and one dedicated
governance test is added, while reducing one duplicate implementation
execution from the aggregate run.

Measured selected-suite evidence on the same local Node 26/macOS host:

- `node tests/fast-worker-selection.test.js`: 14/14 passed.
- `node scripts/ci/catalog.js --check`: 0 uncovered scripts.
- `node tests/test-entrypoint-dedup.test.js`: 1/1 passed.

A full aggregate timing comparison remains CI-owned because the local checkout
does not provide Linux cgroup containment and macOS `/var` is symlinked in the
local environment. The workflow's existing bounded runner, per-file timing
artifact, full-suite path, and required failure semantics remain unchanged;
no new scheduler or blanket retry was introduced.
