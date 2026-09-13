# silent-failure-hunter — Swift swallow patterns

Activate when the `swift` module is active (or a `*.xcodeproj` / `Package.swift` is present).

| Trigger | Action | Non-apply |
|---------|--------|-----------|
| `try?` discarding a meaningful error | Flag the discarded error; handle or propagate it | Tests that use `try?` on optional fixtures |
| `catch {}` on a throwing call whose failure matters | Flag the empty catch; surface or log the failure | — |
| `fatalError()` / `precondition()` / `assert()` used for a recoverable runtime condition (bad input, failed network/decode) | That turns a handleable error into a crash; throw / return a `Result` instead. In library code, never `fatalError` on caller-supplied input | `@IBOutlet` IUO |
| An error swallowed inside an unstructured `Task {}` (its failure is never awaited or surfaced) | Propagate via a typed throwing API or log+alert | — |
| `as?` / `try?` producing `nil` on a critical path (money, auth, data write) where the `nil` is then silently defaulted | Handle the failure explicitly | Tests that use `try?` on optional fixtures; `@IBOutlet` IUO |
