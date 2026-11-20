# Swift Silent-Failure Traps

Applies to Swift code where an error, absent value, or failed task can disappear without the caller or user learning that a required outcome was lost. Apply the shared [prompt defense](../_common/prompt-defense.md); report a missing required resource as a capability gap.

## Ground rule

A finding requires a lost required outcome: name what was supposed to happen (saved, sent, authorized, cleaned up, reported) and show the path where it does not happen with no signal. Intentional best-effort behavior with optionals is not a finding by itself.

## Trap format

Trigger => evidence/action. Bounds say when it does not apply.

### 1. Meaningful error suppression

- Trigger: `try?` or an empty `catch` around an operation whose failure changes correctness (persistence, payment, authorization, migration, upload, cleanup), or a catch that logs and then continues as if it succeeded.
- Evidence/action: show what state the system is left in after the swallowed error and who would notice. Propose propagating, surfacing to the user, recording a durable failure, or an explicit documented fallback.
- Bounds: `try?` on an optional-quality operation (cache warm-up, analytics ping, prefetch, preview) where the outcome is genuinely not required is fine. A catch that records the error and returns a defined degraded result counts as handled.

### 2. Unobserved Task failure

- Trigger: a task created without ever awaiting its value or handling its thrown error, so a failure is dropped silently, or a task handle discarded while the work is required.
- Evidence/action: identify the throwing path and show that nothing reads the result. Propose awaiting it, structuring the work under a parent, or handling errors inside the task body.
- Bounds: a task whose body catches and reports every error internally is handled. Fire-and-forget work with an explicitly non-required outcome is acceptable.

### 3. Critical nil fallback

- Trigger: nil-coalescing or optional chaining that substitutes a default (empty string, zero, empty list, `false`, a placeholder identifier) for a value that must exist, such as an identity, permission flag, price, or required configuration.
- Evidence/action: show how a missing value becomes a plausible-looking wrong one, and where the wrong value is consumed. Propose failing explicitly or returning a typed error.
- Bounds: defaults for presentation, optional preferences, or documented neutral values are fine.

### 4. Recoverable error turned into a crash

- Trigger: `try!`, force unwrap, or `fatalError` replacing handling of a failure that is expected in production (bad input, missing file, network loss, decode mismatch).
- Evidence/action: show a realistic scenario where the failure occurs and the user-visible effect. Propose recovery or a surfaced error. Crash-safety of the hazard itself is also covered by the code reviewer; report it here only for the lost recovery.
- Bounds: unreachable states and programmer-error invariants are acceptable.

## Reporting

Each finding states: the required outcome, the failure input or condition, the missing signal, and the minimal change that makes the loss visible. Do not report a pattern without that chain.

## Reference

Reference: [Swift error handling](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/errorhandling/)
