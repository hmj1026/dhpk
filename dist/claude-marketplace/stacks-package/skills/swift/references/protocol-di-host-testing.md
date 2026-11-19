# Protocol Seams for Host-Side Tests

## What a host test can and cannot prove

A host unit test proves your type's logic against a stand-in for external I/O. It does not prove code signing, entitlements, device behavior, or real Keychain access. Keychain sharing between apps depends on signed access groups and entitlements ([Apple: Sharing access to keychain items](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)), so a fake that returns success says nothing about whether the platform will. Keep a separate on-device or integration check for those paths. Do not write a blanket rule that host tests can never have entitlements; check the consumer's actual signing setup.

## Check the toolchain first

- Find the toolchain the consumer actually builds with (`xcrun swift --version`, plus the Xcode version in use). Swift Testing is included with Xcode 16 and later ([Apple: Swift Testing](https://developer.apple.com/xcode/swift-testing/)). On older toolchains, use XCTest instead.
- Find the consumer's test target, and its Swift language mode, before you add files ([Apple: Adding tests to your Xcode project](https://developer.apple.com/documentation/xcode/adding-tests-to-your-xcode-project)).

## Designing the seam

- Write one protocol per external boundary (files, network, secure storage). Shape it around what the service needs, not around the platform API.
- Mark it `Sendable` and give it `async throws` requirements. That way the production type and the fake satisfy the same contract under strict concurrency checking.
- Inject the protocol through the initializer. Avoid globals and singletons that the test has to reset.

## Rules for fakes

- Build a fresh fake inside each test. Do not share fake instances through static or global state.
- Put the fake's mutable state (recorded calls, scripted outcomes) in an actor. Do not reach for `@unchecked Sendable` or `nonisolated(unsafe)` just because the type is a test double.
- Swift Testing runs tests in parallel by default. The `.serialized` trait only orders the tests within the suite or parameterized test it is applied to. It is not a process-wide lock ([swift-testing: Parallelization](https://github.com/swiftlang/swift-testing/blob/main/Sources/Testing/Testing.docc/Parallelization.md)). Isolation is the fix, not serialization.
- `@Test` functions can be `async`, `throws`, and actor-isolated ([swift-testing: Defining tests](https://github.com/swiftlang/swift-testing/blob/main/Sources/Testing/Testing.docc/DefiningTests.md)). Add `@MainActor` only when the code under test is actually main-actor isolated.

## Example: one seam, three outcomes

```swift
import Foundation
import Testing

// Production code
protocol ProfileSource: Sendable {
    func readProfile(id: String) async throws -> Data?
}

struct Profile: Codable, Equatable, Sendable {
    let id: String
    let displayName: String
}

enum ProfileLoadError: Error, Equatable {
    case notFound
    case sourceUnavailable
}

struct ProfileLoader: Sendable {
    let source: any ProfileSource

    func load(id: String) async throws -> Profile {
        let data: Data?
        do { data = try await source.readProfile(id: id) }
        catch { throw ProfileLoadError.sourceUnavailable }
        guard let data else { throw ProfileLoadError.notFound }
        return try JSONDecoder().decode(Profile.self, from: data)
    }
}

// Test target
struct SourceDown: Error {}

actor ScriptedProfileSource: ProfileSource {
    enum Outcome: Sendable { case stored(Data), absent, fails }
    private let script: [String: Outcome]
    private(set) var requestedIDs: [String] = []

    init(_ script: [String: Outcome]) { self.script = script }

    func readProfile(id: String) async throws -> Data? {
        requestedIDs.append(id)
        switch script[id] ?? .absent {
        case .stored(let data): return data
        case .absent: return nil
        case .fails: throw SourceDown()
        }
    }
}

struct ProfileLoaderTests {
    @Test func returnsDecodedProfileWhenStored() async throws {
        let expected = Profile(id: "p1", displayName: "Rin")
        let source = ScriptedProfileSource(["p1": .stored(try JSONEncoder().encode(expected))])
        let loaded = try await ProfileLoader(source: source).load(id: "p1")
        #expect(loaded == expected)
        let requested = await source.requestedIDs
        #expect(requested == ["p1"])
    }

    @Test func reportsNotFoundWhenAbsent() async {
        let loader = ProfileLoader(source: ScriptedProfileSource([:]))
        do {
            _ = try await loader.load(id: "missing")
            Issue.record("Expected notFound")
        } catch {
            #expect(error as? ProfileLoadError == .notFound)
        }
    }

    @Test func mapsSourceFailure() async {
        let loader = ProfileLoader(source: ScriptedProfileSource(["p2": .fails]))
        do {
            _ = try await loader.load(id: "p2")
            Issue.record("Expected sourceUnavailable")
        } catch {
            #expect(error as? ProfileLoadError == .sourceUnavailable)
        }
    }
}
```

The error tests use explicit do/catch. That avoids relying on one particular overload of the throwing-expectation macro across toolchain versions.

## Running

Run the tests in the consumer's own configured test target: `swift test --filter ProfileLoaderTests` for packages, or the scheme's test action / `xcodebuild test` for app projects. Report the result you actually observe. Passing host tests do not remove the need for platform checks such as signing, entitlements, and on-device Keychain behavior.
