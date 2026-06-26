# silent-failure-hunter — Swift swallow patterns

Activate when the `swift` module is active (or a `*.xcodeproj` / `Package.swift` is present).

- `try?` discarding a meaningful error.
- `catch {}` on a throwing call whose failure matters.
