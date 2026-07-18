---
name: feature-verify
description: 'Feature verification (READ-ONLY, P0-P5). Use when: verifying feature behavior after deployment, validating API responses, diagnosing production issues, post-deploy smoke test. Not for: modifying data (use feature-dev), code review (use codex-review-fast), writing tests (use codex-test-gen), security audit (use codex-security).'
allowed-tools: 'Read, Grep, Glob, Bash, WebFetch, Task, Skill, mcp__codex__codex, mcp__codex__codex-reply'
context: fork
---

# Feature Verify — Runtime-First API Verification

Verify deployed behavior with read-only runtime evidence:

`Claude analysis → Codex independent confirmation → integrated verdict`

Use this for post-deploy checks, smoke tests, and production diagnosis. For local tests use `/verify`; for changes use `/feature-dev`; for code review use `/codex-review-fast`.

## Required References

Read these at the indicated phase:

- P0/P3: [safety-rules.md](references/safety-rules.md) and [environments.md](references/environments.md)
- P1/P2/P4/P5: [blackbox-testing.md](references/blackbox-testing.md)
- P0/P2/P5: [verification-playbook.md](references/verification-playbook.md)
- Report: [output-template.md](references/output-template.md)

`Bash` is permitted only for read-only curl and observation queries reviewed against the safety rules. Missing endpoint allowlist means P3 is skipped.

## P0 — Scope and Safety

1. Select `--env`, defaulting to test, and load its configuration.
2. Run `scripts/health-probe.sh <health-url>` (3 attempts, 2-second timeout).
3. Compare local HEAD with the deployed version and warn on mismatch.
4. Confirm every planned operation is read-only.
5. Determine L4/L3/L2-API/L2-OBS/L1 using the playbook matrix.

API unreachable with logs gives L2-OBS; without logs gives L1. At L1 skip P3/P4. `--level L2` remains an alias for L2-API.

## P1 — Diff-Lite Scope

Follow [blackbox-testing.md § P1](references/blackbox-testing.md#p1-diff-lite-scoping). Map `git diff main...HEAD --name-only` to affected endpoints, dependency chains, active triggers, and passive targets. This phase scopes behavior; it does not judge code quality. If no diff exists, build scope from the user's feature description.

## P2 — Test Charter and Approval

Follow [blackbox-testing.md § P2](references/blackbox-testing.md#p2-test-charter-design). Generate only cases supported by the detected level: L1 regression, L2 active trigger, L3 passive observation, and M1 metrics. Present the charter and wait for user approval before any P3 request.

## P3 — API Execution

Run only for L2-API/L3/L4 after approval. For each allowlisted case:

1. Confirm method and endpoint exactly match the allowlist.
2. Run one request at a time with fixed, non-PII test parameters:
   `scripts/api-exec.sh <GET|POST> <allowlisted-url> [json-payload]`
3. Record its request ID, HTTP status, response fields, and latency.

The script rejects methods other than GET and POST; the operator must separately confirm that POST is allowlisted and read-only. L2-OBS always skips P3.

## P4 — Observation Correlation

Follow [blackbox-testing.md § P4](references/blackbox-testing.md#p4-log-verification-flow).

- L3/L4: correlate each request ID, then fall back to alternate fields and endpoint/time window.
- L2-OBS/L3/L4: scan the observation window for related errors and warnings.
- Observe background services after their expected delay; query affected metrics at L4.
- Record blind spots. A missing log signal is not itself proof of failure.

For L2-OBS use deploy time → now, a user-provided window, or the last 30 minutes, in that order.

## P5 — Independent Verdict

1. Claude forms a conclusion from P3/P4 evidence.
2. Codex independently reviews scope, commands, allowlist compliance, evidence, blind spots, and confidence using [blackbox-testing.md § P5](references/blackbox-testing.md#p5-codex-brainstorm-prompt).
3. Integrate both conclusions using the verdict/confidence rules in the playbook.
4. Render [output-template.md](references/output-template.md).

The report may recommend another skill, but must not auto-invoke it.
