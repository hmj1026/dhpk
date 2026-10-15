# Swift concurrency — Sendable, actors, @MainActor, async/await

The Swift 6 language mode turns data-race safety into a **compile error**. Under
Swift 5.10 the same diagnostics exist as **warnings** when
`SWIFT_STRICT_CONCURRENCY = complete` (or `targeted`). Treat the warnings as
errors-in-waiting — code that warns under 5.10 fails to build under 6.

## Isolation domains

A value is safe to use from a context if it is isolated to that context or is
`Sendable`. The domains:

- **Non-isolated** (default for free functions, plain types) — runs wherever the
  caller is.
- **Actor-isolated** — `actor` types and `@MainActor`/global-actor-annotated
  declarations. Access from outside requires `await`.
- **`@MainActor`** — the global actor for UI. View models that drive SwiftUI
  views are usually `@MainActor`.

## Decision: actor vs @MainActor vs Sendable struct

| Need | Use |
|------|-----|
| Owns mutable state shared across tasks/threads (cache, key store, DB handle) | `actor` |
| Drives UI / touches UIKit / publishes to a SwiftUI view | `@MainActor final class` (or `@Observable @MainActor`) |
| Immutable, or value-typed with only Sendable members, passed across boundaries | `struct` / `enum` (implicitly or explicitly `Sendable`) |
| Reference type that is genuinely safe but the compiler can't prove it | `final class … : @unchecked Sendable` + a comment naming the lock |

## async/await rules

- An `async` function suspends at every `await`; **state can change across a
  suspension point**. Re-check invariants after `await` (the "actor reentrancy"
  trap) — don't assume a property you read before `await` is unchanged after.
- Structured concurrency: prefer `async let` and `withTaskGroup` over detached
  `Task {}`. Children are awaited/cancelled with the parent.
- **Cancellation is cooperative.** Long loops call `try Task.checkCancellation()`
  or check `Task.isCancelled`. Cancellation does not interrupt blocking calls.
- Bridge callbacks with `withCheckedThrowingContinuation` — resume the
  continuation **exactly once** on every path (resuming twice traps; never
  resuming leaks the task forever). `LAContext.evaluatePolicy` and old
  delegate APIs are the common bridges.

## Sendable closures & capture

- `@Sendable` closures (e.g. `Task {}` bodies) cannot capture non-Sendable
  mutable state. Capture a copy, or hop to the owning actor.
- Long-lived closures capture `self` strongly → retain cycles. Use
  `[weak self] in guard let self else { return }`.

## Common fixes

- "Capture of 'self' with non-sendable type in a `@Sendable` closure" → make the
  type an `actor`, or `await` its work from inside the Task.
- "Main actor-isolated property can not be referenced from a non-isolated
  context" → annotate the caller `@MainActor`, or `await MainActor.run { … }`.
- Replace `DispatchQueue.main.async { self.x = … }` with `await MainActor.run`
  or make the enclosing type `@MainActor`.

## iOS 17 / Swift 5.10 note

On the iOS 17 toolchain, default isolation differs from Swift 6 (e.g. `@MainActor`
inference for some UIKit/SwiftUI types is narrower). Don't rely on implicit
main-actor isolation; annotate explicitly so the code behaves the same when the
project flips `SWIFT_VERSION` to 6.

## Swift 6.2+ (Xcode 26+) note

Swift 6.2 changes the model *defaults*: `async` stays on the calling actor (no
implicit background offloading), background work is opted into with `@concurrent`,
MainActor-isolated types can carry isolated protocol conformances, and a
default-MainActor-isolation mode removes most `@MainActor` boilerplate. If the
project is on Xcode 26+ / Swift 6.2+, read `approachable-concurrency.md` — several
data-race errors from earlier modes simply disappear under the new defaults, and
the fix for the rest changes.
