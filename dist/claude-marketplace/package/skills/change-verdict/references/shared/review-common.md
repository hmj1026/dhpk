# Shared review evidence

This reference owns evidence anchors, source labels, and normalized finding
format. [`review-rubric.md`](review-rubric.md) owns severity and final verdict
definitions.

## Shared dimensions

| Dimension | Evidence to inspect when relevant |
|---|---|
| Correctness | logic, boundaries, null/error handling, type safety, observable behavior. |
| Security | injection, access control, sensitive data, integrity, and applicable OWASP risks. |
| Performance | repeated work, N+1 operations, memory, blocking, and payload growth. |
| Maintainability | naming, responsibility, duplication, coupling, and testability. |

Mode-specific references add relevant dimensions. They do not make an
unrelated dimension mandatory.

## Evidence contract

Anchor every material finding to a canonical path and line, commit, command,
or tool result. Read enough surrounding source to establish intent and check
relevant tests or documentation before assigning severity. Caller summaries
are navigation hints, not proof. Redact secrets, tokens, cookies, private
keys, and personal data from all output.

## Code-only Standards and Spec status

Use these axes only in `code` mode. Report each separately in the human
response and cite its governing source and evidence.

| Status | Meaning |
|---|---|
| `MET` | Available applicable evidence supports the axis. |
| `GAP` | Available evidence shows a mismatch or leaves a requested criterion unverified. |
| `UNAVAILABLE` | No applicable normative source was found, or a source could not be read. State which case applies. |

For Spec, no applicable normative specification found is `UNAVAILABLE` and
must remain a visible evidence gap; do not infer satisfaction from the
implementation. If the request names a specification that cannot be read,
state that failure. Return `INCONCLUSIVE` when the missing comparison prevents
the requested judgment. A bounded review can still report an established
outcome when no normative specification applies and the requested judgment does
not depend on one.

## Optional CLI comparison

The primary model is authoritative for timing. An explicit CLI result is an
additive, independently prompted source. Use these labels:

| Source | Meaning |
|---|---|
| `primary` | Found by the primary model only. |
| `cli` | Found by the optional CLI only. |
| `both` | The same evidence-backed issue was found by both. |

If the CLI is not requested or fails, return the primary result with an
explicit degradation note. A missing source is not approval.

## Normalized finding

Deduplicate the same issue by canonical path and evidence; tolerate nearby line
movement and retain the highest severity. Report only findings that survive
evidence, context, false-positive, severity, and gap checks.

```text
- [P0/P1/P2/Nit] <file:line> <issue> -> <text-only recommendation> [source: primary|cli|both]
```

Recommendations stay in the response. Re-running after a caller supplies a
new snapshot is a new read-only observation; there is no automatic fix loop or
persisted review identity.

## Related shared files

- [`review-rubric.md`](review-rubric.md) — severity and final verdict definitions.
- [`codex-research-instructions.md`](codex-research-instructions.md) — source of shared research guidance used by code prompts.
