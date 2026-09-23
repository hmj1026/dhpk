# Swift 5.10 / iOS 17 compatibility notes

babylon (RxScan) targets **iOS 17 minimum**, iOS 18 target, Swift 5.10+ moving
toward Swift 6. This module's guidance is written for the Swift 6 language mode
but stays usable on the iOS 17 floor. Where they differ:

## Concurrency enforcement

- **Swift 6 mode:** data-race violations are **errors**.
- **Swift 5.10 + `SWIFT_STRICT_CONCURRENCY = complete`:** the same violations are
  **warnings**. Migrate by enabling `complete` warnings first, fixing them, then
  flipping `SWIFT_VERSION` to 6.
- Don't rely on implicit `@MainActor` inference — annotate explicitly so behavior
  is identical across both modes.

## Availability gating

iOS 17 is the floor, so APIs introduced in iOS 18+ need `if #available` /
`@available` guards. Relevant to babylon:

| API | Available | Floor (iOS 17) fallback |
|-----|-----------|--------------------------|
| Vision `RecognizeTextRequest` (new Swift API) | iOS 18 | `VNRecognizeTextRequest` |
| `@Observable` macro (Observation) | iOS 17 | available — preferred over `ObservableObject` |
| SwiftData | iOS 17 | **not used** — project uses Core Data (encryption requirement) |
| Some HealthKit per-object auth | iOS 26+ | read-only queries only |

## Language features safe on the iOS 17 / Swift 5.10 floor

- `@Observable` / `@Bindable` macros (Observation framework) — yes.
- `async`/`await`, actors, `Sendable`, `TaskGroup` — yes (since Swift 5.5).
- Macros (`#Predicate`, custom macros) — yes (Swift 5.9+).
- `if`/`switch` expressions — yes (Swift 5.9+).
- **Not** on the 5.10 floor: typed throws (`throws(E)`) is Swift 6 — guard its use
  behind the project's actual `SWIFT_VERSION`.

## Practical migration order

1. Set `SWIFT_STRICT_CONCURRENCY = complete` per target; treat warnings as a
   work list.
2. Annotate UI-driving types `@MainActor`; convert shared-state classes to
   `actor`.
3. Make models `Sendable` (value types usually are for free).
4. Flip `SWIFT_VERSION = 6` once warnings reach zero.

Keep new code Swift-6-clean from the start so the eventual flip is a no-op.
