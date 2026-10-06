# Error handling — throws, typed throws, Result

## Model selection

| Situation | Mechanism |
|-----------|-----------|
| A function can fail and the caller should react to *why* | `throws` + a domain `Error` enum |
| Absence of a value (not a failure) | optional `T?` |
| Failure must be stored / passed through a non-throwing boundary (Combine, completion handler, cached) | `Result<Success, Failure>` |
| Programmer error / invariant violation | `precondition` / `assert` / `fatalError` — not a `throws` |
| Swift 6 + a single known error type, want it in the signature | typed throws: `func f() throws(MyError)` |

## Domain error enums

Define one `enum` per subsystem, conforming to `Error` (and `LocalizedError`
when a user-facing message is needed):

```swift
enum KeychainError: Error {
    case itemNotFound
    case unexpectedStatus(OSStatus)
    case dataCorrupted
}
```

- Carry context in associated values (`OSStatus`, the failing key) — don't
  collapse everything to a string.
- Map foreign error codes (`OSStatus`, `LAError`, `NSError`) into the domain
  enum at the boundary; don't leak framework error types up the stack.

## Rules

- **Never swallow silently.** `try?` discards the error — only use it when the
  caller truly does not care why (and document that). Bare `catch {}` is a bug.
- **Don't `print` and continue.** Either handle, rethrow, or convert to a
  `Result` the caller inspects.
- `do { … } catch let e as KeychainError { … } catch { … }` — catch the specific
  type first, keep a final general `catch` only to convert/rethrow.
- Errors crossing an `async` boundary still propagate with `try await`.
- **typed throws (Swift 6):** use sparingly — it couples callers to the concrete
  error type and complicates composition. Reserve for leaf APIs with one obvious
  failure type (a parser, a key store). General/layered APIs keep untyped `throws`.

## Result bridging

```swift
func loadKey(completion: @escaping (Result<SymmetricKey, KeychainError>) -> Void)
```

Convert a `Result` back into `throws` at the async edge with `try result.get()`.
Prefer `async throws` for new code; `Result` is for interop with callback APIs
and for caching a success-or-failure outcome.
