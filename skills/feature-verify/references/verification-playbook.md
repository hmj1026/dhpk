# Feature Verification Playbook

This reference carries detailed decision tables, production guardrails, the completion checklist, and examples for `feature-verify`.

## Degradation Matrix

| Level | Available | API execution | Observation | Confidence cap |
| ----- | --------- | ------------- | ----------- | -------------- |
| L4 | API + logs + metrics | Full | Logs + metrics | High |
| L3 | API + logs | Full | Logs | High |
| L2-API | API only | Full | Response only | Medium |
| L2-OBS | Logs only | Skip | Time-window/passive | Medium |
| L1 | No runtime access | Skip | Skip | Low |

If endpoint configuration is absent, use L1. If the allowlist is absent, skip P3 even when the API is reachable.

## Charter by Level

| Case | L4 | L3 | L2-API | L2-OBS | L1 |
| ---- | -- | -- | ------ | ------ | -- |
| L1 regression | Yes | Yes | Yes | N/A | N/A |
| L2 active trigger | Yes | Yes | Response-only | N/A | N/A |
| L3 passive | Yes | Yes | N/A | Yes | N/A |
| M1 metrics | Yes | N/A | N/A | N/A | N/A |

## Verdict and Confidence

| Verdict | Condition |
| ------- | --------- |
| Pass | Required cases pass and expected signals are normal |
| Warn | Regression passes but a non-blocking signal is absent or anomalous |
| Blocked | Regression fails, a regression is detected, or metric labels are wrong |
| Inconclusive | Evidence is unavailable or insufficient |

High requires L3/L4 evidence and Claude/Codex agreement. Medium applies to API-only, observation-only, or partial agreement. Low applies to L1 or divergent conclusions.

## Production Guardrails

- Execute one request at a time; never load test.
- Use fixed disposable parameters and only allowlisted read-only endpoints.
- Never include real credentials, secrets, keys, or PII.
- Respect rate limits.
- Redact secrets and PII from stored commands, responses, and reports.

## Completion Checklist

- [ ] P0 environment, reachability, deployment alignment, and level recorded
- [ ] P1 affected endpoints and dependency chains mapped
- [ ] P2 charter approved by the user
- [ ] P3 calls allowlisted, read-only, sequential, and evidenced; or correctly skipped
- [ ] P4 correlation/window scan/passive checks completed where available
- [ ] P4 observation window and blind spots documented
- [ ] P5 Claude and Codex conclusions formed independently
- [ ] Integrated verdict and confidence supported by evidence
- [ ] Report follows `output-template.md`

## Examples

- API + logs: L3 → regression/active charter → approved API calls → log correlation → High-confidence integrated verdict.
- API only: L2-API → API charter → response evidence → confidence capped at Medium.
- API unreachable + logs: L2-OBS → no active calls → deploy-to-now scan and passive observation → confidence capped at Medium.
- No environment: L1 → code-based scope only → no P3/P4 → Low-confidence Inconclusive result.
