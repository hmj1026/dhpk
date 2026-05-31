# MVVM + Coordinator

## Layers

| Layer | Owns | Knows about | Never touches |
|-------|------|-------------|---------------|
| **View** (`View`) | layout, animation, local `@State` | its view model (via `@Bindable`/`let`) | persistence, networking, navigation decisions |
| **ViewModel** (`@Observable @MainActor`) | screen state, intent handling, formatting | injected service protocols | UIKit, `View` types, the Core Data store directly |
| **Coordinator** | navigation path, screen assembly, DI wiring | view models + services | rendering details |
| **Service** (`actor`/protocol) | a capability (Keychain, crypto, repo) | lower services | the UI |

## Coordinator protocol

```swift
@MainActor
protocol Coordinator: AnyObject {
    associatedtype Route: Hashable
    var path: NavigationPath { get set }
    func start() -> AnyView
    func destination(for route: Route) -> AnyView
}
```

- The coordinator holds the `NavigationPath` and builds destination views,
  injecting each view model with its dependencies.
- Child coordinators handle sub-flows (onboarding/consent, lock); the root
  coordinator composes them.

## Dependency injection

- Inject services through the **view model initializer**, typed as protocols, so
  tests substitute fakes:
  ```swift
  @Observable @MainActor
  final class ScanViewModel {
      private let keyStore: KeychainKeyStoring
      private let crypto: ImageCrypting
      init(keyStore: KeychainKeyStoring, crypto: ImageCrypting) { … }
  }
  ```
- A lightweight DI container or factory (hand-rolled or a library like Factory)
  assembles the graph at the composition root (the App / root coordinator).
- **Never** reach for a global singleton inside a view model — it defeats
  substitution and hides the dependency.

## Why Coordinator over inline NavigationLink

- Centralizes deep-linking, back-stack manipulation, and conditional routing
  (e.g. "if not consented → consent flow").
- Keeps views reusable (a view that hard-codes its next screen can't be reused).
- Makes the navigation logic unit-testable without rendering.

## babylon application

- Root coordinator gates on consent + lock state before exposing main features
  (`app-onboarding-consent`, `app-lock-biometric` specs).
- Feature coordinators: scan flow (capture → OCR → edit → save), member
  switching, drug browse.
