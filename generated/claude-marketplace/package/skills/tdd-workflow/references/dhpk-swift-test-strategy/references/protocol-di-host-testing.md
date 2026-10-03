# Protocol-based DI for host-testable Swift

The reliable way to unit-test code that touches the file system, Keychain,
network, or any device-only API is to put a **small protocol** in front of each
external boundary, inject a default real implementation in production, and inject
a fake in tests. This is what lets babylon's crypto/key-store units run under a
plain host `swift test` (seconds, no simulator) — see the `ios-platform` module's
`cryptokit-keychain.md` for *why* the real `SecItem` path can't run on the host
(`errSecMissingEntitlement`).

## 1. One focused protocol per external concern

Keep them small and `Sendable` (they cross actor boundaries):

```swift
public protocol KeyStoring: Sendable {
    func loadOrCreateKey() async throws -> SymmetricKey
    func deleteKey() async throws
}

public protocol FileAccessing: Sendable {
    func read(from url: URL) throws -> Data
    func write(_ data: Data, to url: URL) throws
    func fileExists(at url: URL) -> Bool
}
```

Avoid a single "god" protocol — one boundary, one protocol.

## 2. Default (production) implementation

```swift
public struct DefaultFileAccessor: FileAccessing {
    public init() {}
    public func read(from url: URL) throws -> Data { try Data(contentsOf: url) }
    public func write(_ data: Data, to url: URL) throws { try data.write(to: url, options: .atomic) }
    public func fileExists(at url: URL) -> Bool { FileManager.default.fileExists(atPath: url.path) }
}
```

## 3. Configurable fake (test)

Give the fake injectable error properties so you can drive failure paths
deterministically — testing error handling is the main payoff of DI.

```swift
public final class InMemoryFileAccessor: FileAccessing, @unchecked Sendable {
    public var files: [URL: Data] = [:]
    public var readError: Error?
    public var writeError: Error?
    public init() {}
    public func read(from url: URL) throws -> Data {
        if let readError { throw readError }
        guard let data = files[url] else { throw CocoaError(.fileReadNoSuchFile) }
        return data
    }
    public func write(_ data: Data, to url: URL) throws {
        if let writeError { throw writeError }
        files[url] = data
    }
    public func fileExists(at url: URL) -> Bool { files[url] != nil }
}
```

(`@unchecked Sendable` is acceptable on a test double; production types earn
`Sendable` honestly — value type or actor.)

## 4. Inject via default parameters

Production callers pass nothing; tests pass the fake:

```swift
public actor SyncManager {
    private let files: FileAccessing
    public init(files: FileAccessing = DefaultFileAccessor()) { self.files = files }
    public func load(_ url: URL) throws -> Data { try files.read(from: url) }
}
```

## 5. Test with Swift Testing

```swift
import Testing

@Test("read surfaces a domain error when the file is missing")
func missingFile() async {
    let files = InMemoryFileAccessor()
    let sut = SyncManager(files: files)
    await #expect(throws: CocoaError.self) { try await sut.load(URL(filePath: "/nope")) }
}

@Test("read returns stored bytes")
func readsStored() async throws {
    let files = InMemoryFileAccessor()
    let url = URL(filePath: "/x"); files.files[url] = Data("hi".utf8)
    let sut = SyncManager(files: files)
    #expect(try await sut.load(url) == Data("hi".utf8))
}
```

## Rules

- **Only mock boundaries.** External I/O (file, Keychain, network, clock) gets a
  protocol; internal pure types do not — over-abstracting is its own smell.
- **`Sendable` on every injected protocol** — they are awaited across actors.
- **Default-parameter injection**, not `#if DEBUG` swaps — keep one code path.
- The fake conforms to the *same* protocol the production type does, so the unit
  test exercises the real logic, only the boundary is substituted.
- Keep device-only side effects (`.completeFileProtection` writes, real `SecItem`)
  behind the protocol so the core logic stays host-testable; integration-test the
  real implementation on a simulator (see `test-taxonomy.md`).
