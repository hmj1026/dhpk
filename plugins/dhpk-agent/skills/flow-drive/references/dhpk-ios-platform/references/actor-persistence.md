# Actor-based local persistence

For an offline-first store of a `Codable & Identifiable` model, an `actor` that
holds an in-memory cache and writes through to a file gives you thread safety **by
construction** — no locks, no `DispatchQueue`, and the compiler proves there are no
data races. This is the pattern babylon's `RxScan*` repositories use; pair it with
`cryptokit-keychain.md` when the bytes on disk are PHI (encrypt before write,
`.completeFileProtection` in the iOS layer only — see that file's host-test caveat).

## Generic repository

```swift
public actor LocalRepository<T: Codable & Identifiable & Sendable> where T.ID == String {
    private var cache: [String: T]
    private let fileURL: URL

    public init(fileURL: URL) {
        self.fileURL = fileURL
        self.cache = Self.loadSynchronously(from: fileURL)   // sync load in init: isolation not yet active
    }

    public func save(_ item: T) throws { cache[item.id] = item; try persist() }
    public func delete(_ id: String) throws { cache[id] = nil; try persist() }
    public func find(_ id: String) -> T? { cache[id] }
    public func all() -> [T] { Array(cache.values) }

    private func persist() throws {
        let data = try JSONEncoder().encode(Array(cache.values))
        try data.write(to: fileURL, options: .atomic)        // PHI: encrypt + add file protection in the iOS layer
    }
    private static func loadSynchronously(from url: URL) -> [String: T] {
        guard let data = try? Data(contentsOf: url),
              let items = try? JSONDecoder().decode([T].self, from: data) else { return [:] }
        return Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
    }
}
```

Every call is `await` (actor isolation), so concurrent callers serialize safely.

## Drive an @Observable view model (Swift 6.2 MainActor default)

```swift
@Observable @MainActor
final class MedicationListModel {
    private(set) var items: [Medication] = []
    private let repo: LocalRepository<Medication>
    init(repo: LocalRepository<Medication>) { self.repo = repo }

    func load() async { items = await repo.all() }
    func add(_ m: Medication) async throws { try await repo.save(m); items = await repo.all() }
}
```

The model is MainActor (drives SwiftUI); the repository is a background actor; the
`await` boundary between them is the only crossing, and it's explicit.

## Design decisions

| Decision | Why |
|----------|-----|
| `actor`, not `class` + lock | compiler-enforced data-race safety, no manual sync |
| in-memory cache + file write | O(1) reads from cache, durable atomic writes |
| sync load in `init` | actor isolation isn't active yet in `init`; avoids async-init complexity |
| `.atomic` write | no partial file on crash |
| `Codable & Identifiable` generic | one repository serves every model |

## Rules

- Keep the actor's public API to domain operations; never expose the cache dict.
- All cross-boundary types are `Sendable` (the model is a value type → free).
- For PHI: the *encryption* and `.completeFileProtection` write live in the
  iOS-only data layer wrapping this actor, so the actor core stays host-testable
  (inject the file-write boundary per the `swift-testing` module's
  `protocol-di-host-testing.md`).
- Don't reach for `nonisolated` to dodge `await` — that reintroduces the race the
  actor removed.
