---
status: accepted
---

# Separate resumed-review lifecycle clearance from approval

When a sentinel-backed reviewer is resumed through `SendMessage`, dhpk records a session-scoped obligation and reconciles the exact sentinel only after a conclusive result is paired with a fresh canonical review artifact. Native `SubagentStop` remains the first-choice hook path, while the orchestrator-owned fallback is idempotent, fail-closed for foreign or ambiguous ownership, and never treats lifecycle clearance as approval; this preserves liveness without allowing a message or manual deletion to bypass review evidence.

## Considered Options

- Clear on a final-looking message: rejected because messages are transient and can be detached from the canonical artifact.
- Let the reviewer self-clear: rejected because it collapses review execution and gate ownership.
- Keep the broad sentinel sweep as the resumed path: rejected because it cannot distinguish an intermediate response, a stale artifact, or a concurrent session.

## Consequences

The implementation adds a session-scoped resumed-review obligation sidecar and stricter ownership/freshness checks. A BLOCK, FAIL, malformed verdict, or actionable severity may finish the lifecycle transition but remains a completion blocker through the existing unresolved-verdict and quality gates.
