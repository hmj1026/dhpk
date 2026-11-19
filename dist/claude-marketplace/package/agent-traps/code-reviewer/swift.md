# Swift Code Review Traps

Applies only when the diff touches Swift sources or Swift package/project manifests. Apply the shared [prompt defense](../_common/prompt-defense.md); report a missing required resource as a capability gap. A Swift language reference may be consulted if installed; its absence is not a finding.

## Verdict mapping

Use the code-reviewer's verdict contract: any CRITICAL => BLOCK; HIGH without CRITICAL => WARNING; no CRITICAL or HIGH => APPROVE. The canonical role owns this mapping; stack guidance does not override it.

Severity needs a concrete, reachable scenario: name the input or call sequence, the code path, and the resulting crash, corruption, leak, or wrong outcome. A pattern that is merely unattractive, or that no caller can reach, is not a finding.

## Trap format

Each trap reads: trigger => evidence/action. Bounds say when it does not apply.

### 1. Crash path from dynamic input

- Trigger: force unwrap, `try!`, `as!`, `fatalError`, unchecked indexing, forced array/dictionary access, integer arithmetic or conversion on values from the network, disk, user input, decoded payloads, or deep links.
- Evidence/action: trace the value to its origin and show an input that reaches the crash. Suggest a guarded alternative that matches the surrounding error-handling style.
- Bounds: values fixed at compile time, bundled resources verified by a test, and invariants the type system or a nearby precondition enforces are not findings. A deliberate trap on a programmer-error invariant is acceptable when the message names the invariant.

### 2. Isolation and actor boundaries

- Trigger: mutable state shared across tasks, callbacks or queues, or UI-bound state touched from non-UI contexts, or isolation annotations or `Sendable` conformances that were added to silence diagnostics.
- Evidence/action: first read the project's configured default isolation and strictness settings in the package or build manifest. Then show the specific access that can race or run on the wrong executor. Do not assume a default the project did not configure.
- Bounds: unchecked-Sendable markers need evidence that the synchronization mechanism protects every affected access. Do not flag code whose isolation is guaranteed by the configured default.

### 3. Cancellation and continuation completion

- Trigger: a long async loop, retry, or polling path with no cancellation check, cleanup that is skipped on cancellation, or a checked/unsafe continuation that can resume zero times or twice (a branch, early return, thrown error, or delegate that never fires).
- Evidence/action: enumerate every exit of the wrapper and show the one that does not resume exactly once, or the loop that keeps running after the parent is cancelled.
- Bounds: work intentionally detached from the caller's lifetime and documented as such is acceptable. Short non-suspending code needs no cancellation check.

### 4. Closure and resource ownership

- Trigger: an escaping closure stored on a long-lived object that captures its owner strongly, a timer, observer, stream, file handle, or task that is never released, or a delegate declared strong.
- Evidence/action: draw the ownership cycle or name the holder that outlives its purpose. Propose the narrowest fix (weak capture, explicit teardown, scoped lifetime).
- Bounds: non-escaping closures and closures whose holder is released in a visible teardown path are fine. A weak capture is not required when the lifetime is provably shorter.

### 5. Observation correctness

- Trigger: observable state mutated off its intended context, a property that views depend on but that is excluded from change tracking, or a subscription whose token is dropped immediately.
- Evidence/action: show the update that is lost, duplicated, or delivered to the wrong context, using the observation mechanism the project actually uses.
- Bounds: do not mix guidance for different observation mechanisms. Do not demand observation for state that nothing reads reactively.

### 6. Exhaustive enums and `default`

- Trigger: a `default` branch that swallows a closed, project-owned enum, so a new case would be silently misrouted.
- Evidence/action: list the cases `default` would absorb and state what the wrong behavior would be. Prefer explicit cases for enums the project controls.
- Bounds: enums owned by external libraries or the platform that can evolve need a forward-looking default or the language's unknown-case handling. A `default` that is intentionally the catch-all for open-ended input is fine.

## Out of scope here

Measured speed or memory cost belongs to the performance analyzer. Swallowed errors and lost outcomes belong to the silent-failure hunter. Mention them here only when they also create a crash or race.

## Reference

Reference: [The Swift Programming Language](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/)
