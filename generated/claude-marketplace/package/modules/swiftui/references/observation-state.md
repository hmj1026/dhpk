# Observation & state ownership

## Observation framework (iOS 17+) — preferred

```swift
@Observable @MainActor
final class LockViewModel {
    var isLocked = true          // observed automatically; no @Published
    private let auth: BiometricAuthenticating
    init(auth: BiometricAuthenticating) { self.auth = auth }
    func unlock() async { … }
}

struct LockGate: View {
    @Bindable var model: LockViewModel   // two-way bindings to @Observable
    var body: some View { … }
}
```

- `@Observable` tracks **property reads inside `body`** — a view re-renders only
  when a property it actually read changes (finer-grained than `@Published`,
  which invalidated on any change).
- Use `@Bindable` (not `@ObservedObject`) to get `$`-bindings into an
  `@Observable` model.
- **Don't** add `@Published` or conform to `ObservableObject` on an `@Observable`
  type — mixing the two breaks change tracking.

## Ownership decision table

| Wrapper | Use for | Lifecycle owner |
|---------|---------|-----------------|
| `@State` | view-local value state; OR the view that **creates** an `@Observable` model | the view |
| `@Bindable` | two-way binding into an `@Observable` model passed in | the passer |
| `@Binding` | delegated write access to a parent's value state | the parent |
| `@Environment` | ambient dependency / injected `@Observable` shared up the tree | the injector |

- The view that **owns** an `@Observable` view model holds it in `@State`
  (`@State private var model = …`) so it survives re-renders. Views that merely
  **use** it receive it as a `let` or `@Bindable` parameter, or read it from
  `@Environment`.
- Pre-iOS-17 / `ObservableObject` equivalents: `@StateObject` (owner),
  `@ObservedObject` (user), `@EnvironmentObject` (ambient). The project is iOS 17,
  so default to Observation.

## Anti-patterns

- Constructing a view model inside `body` → recreated every render, state lost.
- Holding the same source of truth in both a parent `@State` and a child `@State`
  → they diverge. Lift it to one owner and pass `@Binding`/`@Bindable` down.
- Storing derived data as stored properties that can go stale — compute it.
