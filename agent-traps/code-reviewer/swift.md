# code-reviewer — Swift traps

Severities feed the same Verdict gate (BLOCK on CRITICAL, WARNING on HIGH-only).

- **HIGH — Force operators in non-test code** — `!` force-unwrap (`dict[k]!`, `array.first!`, `URL(string:)!` on dynamic input), `try!`, `as!`, implicitly-unwrapped `var x: T!` (outside `@IBOutlet`/lifecycle) → `guard let` / `if let` / `??` / `try?` / `as?`. A crash here is a DoS. (CRITICAL when the unwrapped value is attacker-controlled external input.)
- **HIGH — Data-race / Sendable** — shared mutable state crossing an isolation boundary without `Sendable`; non-`@MainActor` mutation of UI / `@Observable` / `@Published` state; `@unchecked Sendable` without a comment naming the lock. (Warnings under Swift 5.10 `complete`, **errors** under Swift 6.)
- **HIGH — Concurrency smells** — blocking calls inside `async` (`DispatchSemaphore.wait`, `Thread.sleep`, sync I/O); `DispatchQueue.main.async` papering over an isolation error instead of `await MainActor.run` / `@MainActor`; resuming a `CheckedContinuation` zero or >1 times (a double-resume traps at runtime).
- **MEDIUM — Retain cycles** — `delegate` not `weak`; missing `[weak self]` on long-lived closures (`Task {}`, Combine `sink`, `NotificationCenter`, stored closures); strong `self` capture in `@Sendable` closures.
- **MEDIUM — Observation** — prefer `@Observable` over `ObservableObject` / `@Published` on the iOS 17 floor; don't mix paradigms in one type; don't construct a view model inside `body`.
- **LOW — Optionals style** — comparing optionals to `nil` where `guard let` is clearer; IUO misuse.
- Detail: swift module `references/concurrency.md` (+ `approachable-concurrency.md` on Xcode 26+); swiftui module `references/observation-state.md`. A failing **build** from any of these → hand off to `swift-build-resolver`.
