---
name: swiftui-architecture
description: SwiftUI app architecture — MVVM + Coordinator, the Observation framework (@Observable view models, @Bindable in views, replacing ObservableObject/@Published on the iOS 17 floor), NavigationStack + type-safe NavigationPath routing, state-ownership rules (@State / @Binding / @Environment / @Bindable), Combine bridging, and UIKit interop (UIViewRepresentable, UIHostingController). Use when building a SwiftUI screen, wiring a view model, adding navigation/routing, deciding which state-ownership property wrapper applies, or bridging a UIKit/Combine API into SwiftUI. Requires the swift module. Not for iOS SDK frameworks (ios-platform) or pure language questions (swift).
---

# SwiftUI architecture — MVVM + Coordinator

Load references on demand:

- `references/mvvm-coordinator.md` — layer responsibilities, DI/factory, Coordinator protocol.
- `references/observation-state.md` — `@Observable`/`@Bindable` vs `ObservableObject`, ownership.
- `references/navigation.md` — `NavigationStack`/`NavigationPath`, type-safe routes.
- `references/interop.md` — Combine bridge + `UIViewRepresentable`/`UIHostingController`.

---

## Core rules

1. **Views are thin and declarative.** No business logic, no persistence, no
   networking in a `View`. A view reads state from its view model and sends
   intents back. Logic that isn't "how to render" belongs in the view model or a
   service.

2. **View models are `@Observable @MainActor`.** On the iOS 17 floor prefer the
   Observation framework (`@Observable`) over `ObservableObject` + `@Published`.
   Don't mix the two paradigms in one type. Inject dependencies (services) via
   the initializer behind protocols — never `import`-reach into singletons.

3. **Navigation is owned by a Coordinator, not scattered in views.** A
   `NavigationStack` bound to a coordinator-held `NavigationPath`; views append
   typed route values, the coordinator maps routes → destination views.

4. **State ownership is explicit.** `@State` for value-typed view-local state;
   `@Bindable` for a two-way binding to an `@Observable` model; `@Binding` for
   delegated ownership; `@Environment` for ambient dependencies. Owning the same
   state in two places is the classic "stale UI" bug.

5. **UIKit/Combine stays behind a boundary.** Wrap `AVCaptureVideoPreviewLayer`,
   camera controllers, and the background-blur snapshot in `UIViewRepresentable`/
   `UIHostingController`; bridge callback/Combine APIs to `async` or `@Observable`
   state at the edge.

## Critical — never

- Never do file/DB/crypto work synchronously in `body` or in a computed view
  property — `body` can run many times per frame.
- Never mutate observable state from a background context (see swift module
  `concurrency.md`); hop to `@MainActor`.
- Never put `NavigationLink(destination:)` deep-linking logic inline when the app
  has more than a couple of screens — route through the coordinator.
- Never retain a view model across identity changes by constructing it inside
  `body` (`StateObject`/`@State` owns lifecycle; constructing in `body` recreates
  it every render).

## When NOT to Use

- Pure language questions (concurrency, optionals, value vs reference) → swift module.
- iOS SDK frameworks (persistence, crypto, OCR, camera, HealthKit) → ios-platform.
- Test strategy / target structure → swift-test-strategy.

## Output

A SwiftUI screen or layer where views stay declarative, view models are
`@Observable @MainActor` with protocol-injected dependencies, and navigation is
driven by a coordinator-owned `NavigationPath` — plus the correct state-ownership
wrapper (`@State` / `@Binding` / `@Environment` / `@Bindable`) for each piece of state.

## Verification

- [ ] No business logic, persistence, or networking in a `View` or in `body`.
- [ ] View models are `@Observable` (not `ObservableObject` + `@Published`) and `@MainActor`.
- [ ] Routing goes through the coordinator's `NavigationPath`, not inline `NavigationLink(destination:)`.
- [ ] Each state value has exactly one owner; bindings use `@Bindable` / `@Binding`.
- [ ] UIKit / Combine APIs are wrapped at a boundary, not called from `body`.

## babylon mapping

The consent gate, biometric lock gate, and background-masking overlay are
coordinator-driven SwiftUI flows from `app-foundation-compliance` tasks 3–4.
