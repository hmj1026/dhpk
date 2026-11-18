# Navigation — NavigationStack + type-safe routing

## Type-safe routes

Model routes as a `Hashable` enum, push values onto a `NavigationPath` the
coordinator owns:

```swift
enum ScanRoute: Hashable {
    case capture
    case review(attemptID: UUID)
    case edit(itemID: UUID)
}

struct RootView: View {
    @Bindable var coordinator: AppCoordinator
    var body: some View {
        NavigationStack(path: $coordinator.path) {
            coordinator.start()
                .navigationDestination(for: ScanRoute.self) { route in
                    coordinator.destination(for: route)
                }
        }
    }
}
```

- Append to navigate: `coordinator.path.append(ScanRoute.review(attemptID: id))`.
- Pop: `coordinator.path.removeLast()`; pop to root: `coordinator.path =
  NavigationPath()`.
- One `navigationDestination(for:)` per route type, registered near the stack
  root — not sprinkled in leaf views.

## Rules

- **Routes carry IDs, not objects.** Append a `UUID`/value, let the destination
  view model fetch the entity. Passing an `NSManagedObject` across a navigation
  boundary is a threading hazard (see ios-platform Core Data notes).
- **Gating flows** (consent, lock) are modeled as a different root, not a pushed
  screen — swap the `NavigationStack`'s root view based on app state so the
  back-stack can't reveal gated content.
- **Sheets/fullScreenCover** for modal sub-tasks (camera capture); dismiss via a
  binding the coordinator owns.
- Deep links resolve to a route value the coordinator appends — keep the mapping
  in one place.

## Back-stack & state restoration

- `NavigationPath` is `Codable` when its elements are `Codable` — persist/restore
  it for state restoration if needed, but **never persist a path that encodes
  PHI** (it would land in plaintext UserDefaults/state files; see
  ios-platform privacy notes).
