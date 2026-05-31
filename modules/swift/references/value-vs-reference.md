# Value vs reference semantics

Default to value types. The decision is about **identity and sharing**, not
performance — Swift's copy-on-write makes large value types cheap.

## Decision table

| Trait | struct / enum | class | actor |
|-------|---------------|-------|-------|
| Identity matters (`===`, same instance observed everywhere) | ✗ | ✓ | ✓ |
| Shared mutable state across tasks/threads | ✗ | ⚠ needs locking | ✓ (safe) |
| Obj-C / UIKit interop, `NSObject` subclass, KVO | ✗ | ✓ | ✗ |
| Pure data / model / DTO / configuration | ✓ | ✗ | ✗ |
| Reference cycle risk | none | yes | yes |
| Sendable for free | when members are Sendable | only if immutable/`@unchecked` | yes |

## Rules

- **Models, DTOs, view state, results → `struct`.** Equatable/Hashable derive
  cleanly; no aliasing surprises.
- **Closed sets of cases → `enum`** (with associated values). Prefer over a
  class hierarchy + downcasts. Makes `switch` exhaustive.
- **`class` → mark `final`** unless you genuinely subclass. `final` enables
  devirtualization and signals intent.
- **`actor`** when a reference type owns mutable state touched concurrently (a
  cache, an encryption-key store, a DB coordinator). The actor serializes access
  for free — no manual locks.

## Copy-on-write & mutation

- Value types passed to functions are copied logically; standard library
  collections share storage until mutated (COW). Don't add manual COW boxes
  unless profiling shows a hot copy.
- `mutating func` on a struct requires a `var` binding. A `let` struct is deeply
  immutable.
- Capturing a `var` of value type in an escaping closure captures a **copy at
  capture time** unless you capture by reference semantics — a frequent source of
  "my change didn't take" bugs. Prefer passing the value forward.

## Property wrappers

When authoring one: the wrapper is a `struct` exposing `wrappedValue` and
optionally `projectedValue` (the `$` accessor). Keep them value types; if a
wrapper needs shared storage, that storage should be an `actor`/class held inside,
documented as such.
