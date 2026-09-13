# Issue #467 timing baseline

Source baseline: `develop @ bba2873facb429057d319ce74514077447ae0eb1` (clean
archive tree identity is pinned in the JSON report).

The triage evidence recorded before this instrumentation was **314 test files,
26 failed files, and approximately 144 seconds** on Node 26/macOS. The local
environment did not provide the Linux systemd cgroup used by the bounded CI
gate, so this is diagnostic evidence and not a CI pass.

The final post-instrumentation run on the feature tree observed **316 test
files, 26 failed files, 141.92 seconds**, and **2,792 assertion cases (2,642
passed, 150 failed)** with four workers. The count is two files higher because
this change adds `render-test-timing.test.js` and `skill-baseline.test.js`; the
dirty feature tree also causes existing provenance-bound tests to report their
expected clean-checkout and macOS symlink-environment failures. This is
diagnostic evidence, not a CI pass.

Observed slowest files in that run:

- `install-codex-skills.test.js`: 88.04 seconds, PASS
- `consumer-platform-probe.test.js`: 22.70 seconds, FAIL
- `review-gate-runtime-consumer-e2e.test.js`: 17.87 seconds, PASS
- `consumer-gate-cli.test.js`: 13.60 seconds, FAIL
- `codex-runtime-contract.test.js`: 13.21 seconds, PASS

The CI workflow now records the exact source/head/base ref and SHA identity,
run attempt, runtime, worker/shard distribution, per-file timings, failed
files, and partial evidence in an artifact and Job Summary. Missing or
malformed timing files remain `NOT_RUN` or `UNAVAILABLE`; they never override
the authoritative test result.

The pinned inventory report also records the initial context boundary: the
catalog set and its fingerprint are observed statically, while installed,
discoverable, loaded, and SessionStart sets are explicitly `NOT_RUN`. Static
description token estimates and `agents/openai.yaml` tool metadata are kept
separate from those runtime observations.

Each skill record also separates resolved local links and package assets from
optional tool/provider, repository-root, environment, and sibling-skill
dependency classes. A class that cannot be established statically is retained
as `UNKNOWN` with a reason rather than treated as absent.

## Repeat-work candidates

The reproducible baseline report records three duplicate-test-entry candidates
for issue #470. Each entrypoint is discovered by `tests/run-all.js` and
requires the listed implementation test:

- `tests/advise-once.test.js` → `tests/session-start-advisories.test.js`
- `tests/detect-stack-hints.test.js` → `tests/session-start-advisories.test.js`
- `tests/fast-worker-selector.test.js` → `tests/fast-worker-selection.test.js`

This is evidence of duplicate test entry points, not proof that the assertions
execute twice; #470 must measure and decide whether to merge, remove, or keep
the compatibility entry points.

The repository also contains package materialization, copying, hashing, and
validator code paths, but this baseline does not infer duplicate execution
from shared helper names. Issue #470 owns the before/after measurement for
those paths and for validation reruns; no scheduler, registry, or telemetry
behavior is changed by #467.
