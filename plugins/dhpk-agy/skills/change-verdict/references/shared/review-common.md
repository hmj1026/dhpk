# Verdict definitions

## Severity

- **P0**: system crash, data loss, or security vulnerability.
- **P1**: functional anomaly, severe performance degradation, or a material regression risk.
- **P2**: maintainability, design, or test-quality concern.
- **Nit**: minor style or naming suggestion.

P0/P1 block `READY`. P2/Nit remain visible but do not authorize a code or
document change from this read-only skill.

## Shared dimensions

| Dimension | Evidence to inspect |
|---|---|
| Correctness | logic, boundaries, null/error handling, type safety, observable behavior. |
| Security | injection, access control, sensitive data, integrity, and OWASP risks. |
| Performance | repeated work, N+1 operations, memory, blocking, and payload growth. |
| Maintainability | naming, responsibility, duplication, coupling, and testability. |

Mode-specific references add dimensions but do not remove these checks when a
dimension is relevant.

## Evidence contract

Every material finding has a canonical path and line, commit, command, or
tool-result anchor. The reviewer reads enough surrounding code to establish
intent and checks tests/docs before assigning severity. Caller summaries are
context, not proof. Redact secrets, tokens, cookies, private keys, and personal
data from all output.

## Dual-source comparison

The primary model is authoritative for timing. An explicit CLI result is
additive and independently prompted. Use these source labels:

| Source | Meaning |
|---|---|
| `primary` | Found by the primary model only. |
| `cli` | Found by the optional CLI only. |
| `both` | Same evidence-backed issue found by both. |

If the CLI is not requested or fails, return the primary result with an
explicit degradation note. Do not invent a second source or treat a missing
source as approval.

## Normalized finding

```text
- [P0/P1/P2/Nit] <file:line> <issue> -> <text-only remediation> [source: primary|cli|both]
```

The remediation is a recommendation in the response. It is never executed by
this skill. Re-running after a new user-supplied snapshot is a new read-only
observation; there is no automatic fix loop or persisted review identity.
