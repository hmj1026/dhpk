# performance-analyzer — Swift traps

Runtime perf for Swift / SwiftUI. Loaded when a `swift` stack is detected. Concurrency
correctness / Sendable / retain cycles → `code-reviewer/swift.md`; this sheet owns
allocation, collection cost, and render churn.

| Lane | Flag | Fix |
|---|---|---|
| Allocation hot path | object / array allocation inside a tight loop or per-frame closure | hoist out of the loop; reuse buffers; prefer value types that stay on the stack |
| Collections | growing an `Array`/`Set`/`Dictionary` element-by-element to a known size; `array.contains` in a loop (O(n²)) | `reserveCapacity(n)` up front; index with a `Set`/`Dictionary` for O(1) lookup |
| Strings | string interpolation / concatenation building a large result in a loop | accumulate into an array and `joined()`, or a single interpolation |
| SwiftUI render | heavy compute inside `body`; an over-broad `@Observable` / `@Published` triggering whole-view invalidation; `ForEach` without a stable `id` | compute outside `body` / cache; split observable state so only the affected subview updates; stable `id` |
| Lazy / IO | eager load of a large collection where `LazySequence` / pagination fits; sync file/network on the main actor | lazy/paginate; move IO off the main actor with `async` |

## Worked example

```swift
// BAD — O(n^2): contains scans the whole array each iteration; array grows unreserved
var seen: [Int] = []
for x in input where !seen.contains(x) { seen.append(x) }
// GOOD — O(n) with a Set, capacity reserved
var seenSet = Set<Int>(minimumCapacity: input.count)
var seen: [Int] = []; seen.reserveCapacity(input.count)
for x in input where seenSet.insert(x).inserted { seen.append(x) }
```

Diagnostics (read-only): Instruments (Time Profiler, Allocations), `swift build -c release` for realistic timings, SwiftUI `Self._printChanges()` to find redundant re-renders. A failing build → hand off to `swift-build-resolver`.
