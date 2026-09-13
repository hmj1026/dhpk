# Swift Testing API (`import Testing`)

The modern framework (Xcode 16+, available on the iOS 17 toolchain). babylon's
`babylonTests` already uses it.

## Basics

```swift
import Testing
@testable import RxScanData

@Test func storesAndLoadsKey() async throws {
    let store = KeychainKeyStore(service: "test.\(UUID())")   // unique per test
    let key = try await store.loadOrCreate()
    let again = try await store.loadOrCreate()
    #expect(key == again)                                     // idempotent
}
```

- `@Test` marks a test function (free function or method in a `@Suite` type). No
  `test` prefix needed (unlike XCTest).
- `#expect(expr)` — soft assertion; records a failure but continues, and captures
  the sub-expression values in the failure message.
- `#require(expr)` — throwing assertion; unwraps optionals (`let x = try
  #require(maybe)`) or aborts the test when false. Use before dereferencing.

## Errors

```swift
#expect(throws: KeychainError.itemNotFound) {
    try store.loadExisting()
}
#expect(throws: (any Error).self) { try risky() }
```

## Parameterized tests

```swift
@Test(arguments: [Data(), Data("a".utf8), Data(repeating: 7, count: 4096)])
func roundTrips(_ plaintext: Data) async throws {
    let blob = try crypto.encrypt(plaintext, key: key)
    #expect(try crypto.decrypt(blob, key: key) == plaintext)
}
```

- `arguments:` runs the test once per value (each is an independent case).
- Multiple `arguments:` collections form a zipped/cross product — keep it small
  and intentional.

## Suites & traits

```swift
@Suite("Image crypto", .serialized)
struct ImageCryptoTests {
    let key = SymmetricKey(size: .bits256)
    @Test func tamperFailsAuth() throws { … }
}
```

- A `struct`/`final class` annotated `@Suite` groups tests; **stored properties
  are fresh per test** (init runs before each), giving clean fixtures.
- Traits: `.serialized` (no parallelism), `.disabled("reason")`,
  `.tags(.fast)`, `.timeLimit(.minutes(1))`.
- `init`/`deinit` (or `async` init) replace `setUp`/`tearDown`.

## Async & confirmations

- Tests are `async throws` directly — just `await`.
- For callback/event APIs that should fire N times, use `confirmation`:
  ```swift
  await confirmation("delegate called", expectedCount: 1) { confirm in
      service.onDone = { confirm() }
      await service.run()
  }
  ```
