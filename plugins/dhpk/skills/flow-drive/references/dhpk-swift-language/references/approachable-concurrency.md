# Approachable Concurrency: Decision Procedure

## Step 1: Record what is actually configured

For each target, write down:

- the compiler version,
- the language mode (Swift 5 or 6),
- the default actor isolation,
- which upcoming-feature flags are on.

These are separate settings. A 6.2 compiler does not automatically mean Swift 6 language mode, and it does not mean main-actor default isolation. If default isolation is not configured, it stays nonisolated ([SE-0466](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md)).

## Step 2: Know what each setting changes

- **Default isolation** (SE-0466, Swift 6.2): `-default-isolation MainActor` or `nonisolated`, set per module. In SwiftPM this is `.defaultIsolation(MainActor.self)` or `.defaultIsolation(nil)`, which requires PackageDescription 6.2 ([SE-0466](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md)). Don't put it in a manifest that declares an older tools version.
- **NonisolatedNonsendingByDefault** (SE-0461, Swift 6.2): with this flag on, a `nonisolated async` function runs on the caller's actor instead of leaving it. Spell that out explicitly with `nonisolated(nonsending)`. Mark a function `@concurrent` when it should leave the caller's actor. The rest of the containing type does not need to be nonisolated for that ([SE-0461](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md)).
- **Isolated conformances** (SE-0470, Swift 6.2): `extension T: @MainActor P` makes the conformance usable only on the main actor. The `InferIsolatedConformances` flag controls whether the compiler infers this for you ([SE-0470](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0470-isolated-conformances.md)).

Two consequences:

- `async` does not guarantee a background thread. Synchronous work inside an async function still blocks whichever actor it runs on.
- Diagnostics are information, not noise. Don't silence them with blanket `@Sendable`, `@unchecked Sendable`, or `Task.detached`. Shared mutable state still needs real isolation or synchronization ([Swift 6 migration guide](https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/)).

## Step 3: Separate UI state from heavy work

Keep UI-owned state on the main actor. Mark the CPU-heavy piece `@concurrent`, so its callers keep the same `async` signature they already use:

```swift
@MainActor
final class ThumbnailPanel {
    private(set) var pixelCount = 0

    func refresh(from raw: [UInt8]) async {
        pixelCount = await Histogram.countNonZero(raw)
    }
}

enum Histogram {
    @concurrent
    static func countNonZero(_ bytes: [UInt8]) async -> Int {
        bytes.reduce(0) { $0 + ($1 == 0 ? 0 : 1) }
    }
}
```

An opt-in package target could look like this (requires tools version 6.2):

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Gallery",
    targets: [
        .target(
            name: "GalleryUI",
            swiftSettings: [
                .defaultIsolation(MainActor.self),
                .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
                .enableUpcomingFeature("InferIsolatedConformances")
            ]
        )
    ]
)
```

## Step 4: Verify before adopting

- Enable one setting at a time, per target, and build a small consumer example after each change.
- Compile the examples and confirm the flag names and behavior on the consumer's real toolchain before relying on them.
