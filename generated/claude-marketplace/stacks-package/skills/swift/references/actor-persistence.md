# Actor-Owned Local Persistence

## Decide these before you write code

- **Identity:** every record has a stable ID that never changes between saves.
- **Missing file:** pick one meaning and write it down, for example "first launch, empty store".
- **Read failure:** accept an empty store only for a confirmed no-such-file error. A false [`fileExists(atPath:)`](https://developer.apple.com/documentation/foundation/filemanager/fileexists(atpath:)) result can also mean inaccessible or undetermined existence; propagate other read failures without publishing an empty cache.
- **Corrupt file:** surface an error. Never decode-fail into an empty cache and then overwrite the bad file on the next save, because that silently destroys user data.
- **Duplicate IDs:** reject them, both on load and on insert, with a defined error. `Dictionary(uniqueKeysWithValues:)` traps on duplicates, so do not feed it unvalidated input.
- **Recovery and staging** (backups, quarantine of bad files, migrations): these are project-owned policies. Document them in the consuming project.
- **Availability:** use the project's real deployment target. Do not assume a global OS floor.

## What the actor does and does not protect

An actor serializes access to its own state ([Swift book: Concurrency](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/); [SE-0306](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0306-actors.md)). It does not coordinate other actors, other processes, extensions, or anything else writing the same file. Actor methods are reentrant: at every `await`, other calls can run and change state. So a read-modify-write split across an `await` can lose updates. Two ways to keep it correct:

- Keep the stage-serialize-write-publish span synchronous, with no `await` inside it, or
- Use an owned serialized transaction or generation counter, and re-validate after resuming.

Never hold a synchronous lock across an `await`.

## Atomic writes

`.atomic` writes to an auxiliary file and then replaces the original with it ([Apple: NSData.WritingOptions.atomic](https://developer.apple.com/documentation/foundation/nsdata/writingoptions/atomic)). That protects readers from seeing a half-written file. It is not proof of crash durability, it is not a transaction across several files, and it does not coordinate between processes.

## Secrets

Tokens, passwords, and keys belong in the platform's secure storage under its access contract ([Apple: Keychain Services](https://developer.apple.com/documentation/security/keychain-services)). Never put them in this JSON file or in logs.

## Example

Check the consumer's Swift language mode, default isolation, and Foundation availability before compiling this example.

```swift
import Foundation

struct NoteID: Hashable, Codable, Sendable { let raw: UUID }

struct Note: Codable, Sendable {
    let id: NoteID
    var title: String
}

enum NoteStoreError: Error {
    case duplicateID(NoteID)
    case notFound(NoteID)
    case corrupt(any Error)
    case unreadable(any Error)
    case writeFailed(any Error)
}

actor NoteStore {
    private let fileURL: URL
    private var cache: [NoteID: Note] = [:]
    private var isLoaded = false

    init(fileURL: URL) { self.fileURL = fileURL }

    func all() throws -> [Note] {
        try loadIfNeeded()
        return cache.values.sorted { $0.id.raw.uuidString < $1.id.raw.uuidString }
    }

    func insert(_ note: Note) throws {
        try loadIfNeeded()
        guard cache[note.id] == nil else { throw NoteStoreError.duplicateID(note.id) }
        try commit(cache.merging([note.id: note]) { old, _ in old })
    }

    func remove(_ id: NoteID) throws {
        try loadIfNeeded()
        guard cache[id] != nil else { throw NoteStoreError.notFound(id) }
        try commit(cache.filter { $0.key != id })
    }

    private func loadIfNeeded() throws {
        guard !isLoaded else { return }
        let bytes: Data
        do { bytes = try Data(contentsOf: fileURL) }
        catch {
            let failure = error as NSError
            guard failure.domain == NSCocoaErrorDomain,
                  failure.code == CocoaError.fileReadNoSuchFile.rawValue else {
                throw NoteStoreError.unreadable(error)
            }
            isLoaded = true // policy: confirmed missing file means empty store
            return
        }
        let decoded: [Note]
        do { decoded = try JSONDecoder().decode([Note].self, from: bytes) }
        catch { throw NoteStoreError.corrupt(error) } // file left untouched
        var index: [NoteID: Note] = [:]
        for note in decoded {
            guard index[note.id] == nil else { throw NoteStoreError.duplicateID(note.id) }
            index[note.id] = note
        }
        cache = index
        isLoaded = true
    }

    // Synchronous on purpose: no await between staging, writing, and publishing.
    private func commit(_ candidate: [NoteID: Note]) throws {
        do {
            let ordered = candidate.values.sorted { $0.id.raw.uuidString < $1.id.raw.uuidString }
            let data = try JSONEncoder().encode(ordered)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            throw NoteStoreError.writeFailed(error) // cache keeps last good state
        }
        cache = candidate
    }
}

@MainActor
final class NotesScreenModel {
    private let store: NoteStore
    private(set) var notes: [Note] = []
    private(set) var lastError: (any Error)?

    init(store: NoteStore) { self.store = store }

    func refresh() async {
        do { notes = try await store.all() } catch { lastError = error }
    }
}
```

Notes:

- The UI model is a separate `@MainActor` type. It reaches the store only through `await`, so the store never touches UI state.
- The file I/O here is synchronous, so it occupies the store's executor while it runs. For large files, measure first, and then move encoding off the actor only if you keep the staged-commit guarantees.
- Payload types are `Codable` and `Sendable` so they can cross the actor boundary. Confirm that against the consumer's toolchain and language mode.
