---
name: swift-language
description: Swift 6 language baseline with Swift 5.10 / iOS 17 compatibility notes — strict concurrency (Sendable, actors, @MainActor, data-race safety), async/await + structured concurrency (TaskGroup, cancellation, continuations), optionals discipline (no force-unwrap outside tests), value-vs-reference decision rules, property-wrapper authoring, and error handling (typed throws / Result). Use when writing or reviewing any .swift file, deciding actor vs @MainActor vs Sendable struct, unwrapping optionals, choosing struct vs class, or porting Swift 5.10 code onto the Swift 6 language mode. Not for SwiftUI view composition (swiftui) or iOS SDK frameworks (ios-platform).
---

# Swift language — baseline

This is the shared language floor for the iOS suite. `swiftui`, `ios-platform`,
`swift-testing`, and `xcode-tooling` all `requires: swift`. Load the references
on demand:

- `references/concurrency.md` — Sendable / actors / @MainActor / async-await, Swift 6 vs 5.10 mode.
- `references/approachable-concurrency.md` — Swift 6.2+ (Xcode 26+) defaults: async stays on the caller, `@concurrent` opt-in offload, isolated conformances, MainActor default inference.
- `references/value-vs-reference.md` — struct vs class vs actor decision table; copy-on-write.
- `references/error-handling.md` — `throws` / typed throws / `Result` / `do-catch` selection.
- `references/swift5-compat-notes.md` — the iOS 17 / Swift 5.10 floor and what differs from Swift 6.

> SSOT for the project's language mode is the Xcode build setting
> `SWIFT_VERSION` + per-target `SWIFT_STRICT_CONCURRENCY`. Read those before
> assuming Swift 6 enforcement is on.

---

## Core rules

1. **No force operators in non-test code.** `!` (force-unwrap), `try!`, `as!`,
   and implicitly-unwrapped optionals (`var x: T!`) are banned outside tests
   and `@IBOutlet`/lifecycle-guaranteed properties. Use `guard let … else`
   (early exit), `if let`, `??`, `try?`, or `as?` + `guard`.

2. **Concurrency is type-checked, not hoped.** Shared mutable state that crosses
   an isolation boundary must be `Sendable` (a value type of Sendable members,
   an `actor`, or an explicitly-audited `@unchecked Sendable` with a documented
   lock). UI state mutated from `@MainActor`. See `concurrency.md`.

3. **Prefer value types.** Default to `struct`/`enum`. Reach for `class` only
   for identity, reference semantics, or Obj-C interop; reach for `actor` when
   the type owns mutable state shared across tasks. See `value-vs-reference.md`.

4. **Model absence with optionals, errors with `throws`.** Don't use sentinel
   values (`-1`, `""`, `NSNotFound`). Don't swallow errors with `try?` when the
   caller needs to know why something failed. See `error-handling.md`.

5. **Escaping closures capture weakly when long-lived.** `Task {}`, Combine
   `sink`, `NotificationCenter` observers, and stored closures capture `self`
   strongly by default → `[weak self]` + `guard let self` for anything that
   outlives the call.

## Critical — never

- Never `!`-unwrap a value you did not just check (`dict[k]!`, `array.first!`,
  `URL(string:)!` on dynamic input). A crash here is a denial-of-service.
- Never mutate `@Published`/`@Observable`/UI properties off the main actor.
- Never mark a type `@unchecked Sendable` without a comment naming the
  synchronization mechanism that makes it safe.
- Never block a thread inside an `async` function (`DispatchSemaphore.wait`,
  `Thread.sleep`, synchronous network) — use `await`.
- Never use `DispatchQueue.main.async` to "fix" a data race; it hides the
  isolation problem the compiler is pointing at.

## When NOT to Use

- SwiftUI view composition, state wrappers, navigation → swiftui module.
- iOS SDK frameworks (Core Data, CryptoKit, Vision, HealthKit) → ios-platform.
- Test authoring / framework choice → swift-test-strategy.
- SwiftLint / xcodebuild / SPM build config → xcode-tooling.

## Output

Reviewed or written `.swift` that compiles under the project's `SWIFT_VERSION`
and `SWIFT_STRICT_CONCURRENCY`: no force operators outside tests, explicit
isolation (`actor` / `@MainActor` / `Sendable`), optionals modelled with
`guard`/`if let`, and errors surfaced via `throws`/`Result`.

## Verification

- [ ] No `!` / `try!` / `as!` / `var x: T!` outside tests or lifecycle-guaranteed properties.
- [ ] Cross-isolation state is `Sendable`, an `actor`, or audited `@unchecked Sendable` with a named lock.
- [ ] UI / observable mutations happen on `@MainActor`.
- [ ] Long-lived closures capture `[weak self]`.
- [ ] Project build is clean with strict concurrency at the project's setting.

## Reviewer hand-off

This module's traps feed `code-reviewer` (Swift section). Persistence
(`NSManagedObject`, SQLCipher), crypto/Keychain, and privacy concerns belong to
`database-reviewer` / `security-reviewer` via the `ios-platform` module.
