# Swift 6.2+ Approachable Concurrency (Xcode 26+)

Swift 6.2 changes the *defaults* of the concurrency model so that ordinary code is
single-threaded and data-race-free without ceremony, and parallelism is something
you **opt into**. This is the model on babylon's toolchain (Xcode 26.5 / Swift 6.3).
The rules in `concurrency.md` still hold — this file is what changed on top of them.

> SSOT: the build settings *Approachable Concurrency*, *Default Actor Isolation*
> (`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`), and `SWIFT_VERSION = 6`. Read them
> before assuming any of the behaviours below are active — they are opt-in flags.

## 1. async stays on the calling actor (no implicit offloading)

Under Swift 6.0/6.1 an `async` function could be implicitly hopped to a background
thread, which surfaced as *"sending 'self.x' risks causing data races"* on otherwise
obvious code. Swift 6.2: **an `async` function runs on the actor that called it**
unless you say otherwise. The data race disappears because nothing crossed a boundary.

```swift
@MainActor
final class StickerModel {
    let processor = PhotoProcessor()
    func extract(_ item: PhotosPickerItem) async throws -> Sticker? {
        guard let data = try await item.loadTransferable(type: Data.self) else { return nil }
        return await processor.extract(data)   // 6.2: stays on MainActor, no data race
    }
}
```

Consequence: **write single-threaded code first.** Don't scatter `Task.detached` /
`DispatchQueue` to "go async" — `async` no longer implies "off the main actor".

## 2. @concurrent — opt into background execution

When you genuinely need parallelism (image processing, OCR, compression), mark the
type `nonisolated` and the function `@concurrent`:

```swift
nonisolated final class PhotoProcessor {
    @concurrent
    static func extractSubject(from data: Data) async -> Sticker { /* heavy work */ }
}
// call site:
let sticker = await PhotoProcessor.extractSubject(from: data)
```

Recipe: (1) make the containing type `nonisolated`, (2) add `@concurrent`, (3) make
it `async`, (4) `await` at call sites. **Profile first** — apply `@concurrent` only
to measured hot paths, not to every async function.

## 3. Isolated conformances

A MainActor-isolated type can now conform to a non-isolated protocol *as a
MainActor-isolated conformance*, instead of forcing `nonisolated` workarounds:

```swift
protocol Exportable { func export() }

extension StickerModel: @MainActor Exportable {   // isolated conformance
    func export() { processor.exportAsPNG() }
}
```

The compiler then only allows that conformance to be used from MainActor contexts —
a non-isolated caller using it is a compile error, which is the point.

## 4. MainActor default-inference mode

With *Default Actor Isolation = MainActor* (recommended for app / script / executable
targets that are mostly UI), declarations are implicitly `@MainActor`, so the
boilerplate annotations vanish:

```swift
final class StickerLibrary { static let shared = StickerLibrary() }  // implicitly @MainActor
final class StickerModel { var selection: [PhotosPickerItem] = [] }  // implicitly @MainActor
```

Types that must run off the main actor (a background `actor`, a `@concurrent`
worker, a Sendable value type) opt **out** with explicit `nonisolated` / `actor`.
This inverts the old habit: annotate the *background*, not the *foreground*.

## 5. Global / static mutable state

A `static let`/`var` of a non-Sendable type is a data-race error unless isolated.
Under default-MainActor inference it's covered automatically; otherwise annotate:

```swift
@MainActor final class StickerLibrary { static let shared = StickerLibrary() }
```

## Enablement

- **Xcode**: Build Settings → Swift Compiler – Concurrency → *Approachable
  Concurrency* = Yes; *Default Actor Isolation* = MainActor (per target).
- **SwiftPM**: in the manifest, add the upcoming/experimental features via
  `swiftSettings` on the target (e.g. `.defaultIsolation(MainActor.self)` and the
  approachable-concurrency feature flag for your toolchain).
- **Migrate incrementally** — enable one flag at a time; remaining data races become
  compile errors you fix where they surface (see the table in
  `swift-build-resolver` agent for the error → fix mapping).

## Anti-patterns

- Sprinkling `@concurrent` on every async function — most should stay on the caller.
- Using `nonisolated` to *silence* an isolation error instead of modelling ownership.
- Keeping `DispatchQueue`/`NSLock` where an `actor` (or just the MainActor default)
  already gives the same safety.
- Assuming `async` means "background" — under 6.2 it means "suspends", not "offloads".
