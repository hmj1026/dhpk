# code-reviewer — Swift traps

Severities feed the same Verdict gate (BLOCK on CRITICAL, WARNING on HIGH-only).

| Severity | Trigger | Action | Non-apply |
|---|---|---|---|
| HIGH | `!` force-unwrap, `try!`, `as!`, IUO `var x: T!` outside `@IBOutlet`/lifecycle | `guard let` / `if let` / `??` / `try?` / `as?` | test helpers that document the crash; `@IBOutlet` |
| HIGH | shared mutable state crossing an isolation boundary without `Sendable`; non-`@MainActor` mutation of UI / `@Observable` / `@Published` | make the type `Sendable` or isolate; hop to `@MainActor` | `@unchecked Sendable` on a documented FFI wrapper that names the lock |
| HIGH | blocking calls inside `async` (`DispatchSemaphore.wait`, `Thread.sleep`, sync I/O); resuming a `CheckedContinuation` 0 or >1 times | async I/O; resume exactly once | a test that uses `sleep` to wait for an expectation |
| MEDIUM | `delegate` not `weak`; missing `[weak self]` on long-lived closures | `weak`; `[weak self]` | a short-lived `Task` that completes before the owner can leak |
| MEDIUM | mixing `@Observable` and `ObservableObject` on one type; constructing a view model inside `body` | pick one observation paradigm; inject the model | iOS 16-only targets that cannot use `@Observable` |
| MEDIUM | class inheritance where a protocol + value type fits; `Any` erasing a knowable type | protocol + struct; name the type | ObjC interop that requires a class |
| MEDIUM | wildcard `default:` in a `switch` over a project-owned enum | match each case so a new case is a compile error | a `default` over a vendor enum that cannot be exhaustive |
| LOW | comparing optionals to `nil` where `guard let` is clearer | `guard let` | a boolean API that is documented as `== nil` |

Detail: swift module `references/concurrency.md` (+ `approachable-concurrency.md` on
Xcode 26+); swiftui module `references/observation-state.md`. A failing **build**
from any of these → the documented language-build fallback or the exact command
for the host's build resolver.

## Worked examples

```swift
// BAD — force-unwrap on dynamic input is a crash / DoS
let url = URL(string: userInput)!
// GOOD — guard and handle the nil path
guard let url = URL(string: userInput) else { return .invalidURL }
```

```swift
// BAD — strong self in a long-lived closure → retain cycle
store.sink { self.update($0) }
// GOOD — capture weak
store.sink { [weak self] in self?.update($0) }
```
