# silent-failure-hunter — Swift swallow patterns

Activate when the `swift` module is active (or a `*.xcodeproj` / `Package.swift` is present).

- `try?` discarding a meaningful error.
- `catch {}` on a throwing call whose failure matters.
- `fatalError()` / `precondition()` / `assert()` used for a *recoverable* runtime condition (bad input, failed network/decode) — that turns a handleable error into a crash; throw / return a `Result` instead. In library code, never `fatalError` on caller-supplied input.
- An error swallowed inside an unstructured `Task {}` (its failure is never awaited or surfaced) — propagate via a typed throwing API or log+alert.
- `as?` / `try?` producing `nil` on a critical path (money, auth, data write) where the `nil` is then silently defaulted — handle the failure explicitly.
