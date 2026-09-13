# Core Data with at-rest encryption

babylon uses **Core Data** (not SwiftData) specifically because SwiftData has no
native at-rest file-encryption API suitable for special-category health data.

## Two encryption tracks

| Track | Mechanism | When |
|-------|-----------|------|
| **High (aspirational)** | SQLCipher via EncryptedCoreData (`NSIncrementalStore` subclass) — page-level AES encryption of the SQLite file; key from Keychain | PHI store, when the SQLCipher toolchain is wired |
| **Baseline (MVP fallback)** | Standard Core Data SQLite + `NSPersistentStoreFileProtectionKey = NSFileProtectionComplete` | until SQLCipher is integrated |

> File Protection (Complete) makes the file unreadable while the device is
> locked — which means **background reads fail when locked**. Any scheduling /
> notification code that reads the store from the background must tolerate this
> (use `CompleteUntilFirstUserAuthentication` only for the narrow data that truly
> needs background access, and never for the most sensitive rows).

## Setting up the store

```swift
let description = NSPersistentStoreDescription(url: storeURL)
description.setOption(FileProtectionType.complete as NSObject,
                      forKey: NSPersistentStoreFileProtectionKey)
// SQLCipher track additionally registers the EncryptedCoreData store type and
// passes the passphrase (sourced from Keychain) via store options.
container.persistentStoreDescriptions = [description]
```

- The encryption key/passphrase is **fetched from the Keychain** (see
  `cryptokit-keychain.md`), never a literal or derived from a device constant.
- **Verify the encrypted store actually loaded.** The classic SQLCipher trap is a
  silent fallback to a plaintext SQLite file when the store type isn't registered
  or the build flags are missing — confirm `loadPersistentStores` used the
  encrypted store type and that the on-disk header is not a readable SQLite
  header.

## Threading

- `NSManagedObject` is **not** thread-safe. Never pass one between contexts or
  threads — pass its `objectID` and re-fetch.
- All access goes through `context.perform { … }` / `performAndWait`. Use a
  private-queue context (`newBackgroundContext()`) for writes off the main queue;
  merge changes to the view context.
- The view context is `@MainActor`-adjacent — read it on the main queue for UI.

## Fetch hygiene

- `NSPredicate(format:, args)` — never string-interpolate user input into a
  predicate format.
- Set `fetchBatchSize` and `relationshipKeyPathsForPrefetching` to avoid faulting
  N+1 when iterating relationships.
- `fetchLimit = 1` for single-row lookups; handle the empty result.

## Migration

- Prefer lightweight migration (`shouldInferMappingModelAutomatically = true` +
  `shouldMigrateStoreAutomatically = true`) with a versioned `.xcdatamodeld`.
- The initial SwiftData-template → Core Data replacement **recreates the store**;
  there is no rollback. Guard against destructive store deletion on real user
  data, and gate the replacement to the empty-template state.
- Heavyweight migrations need an explicit mapping model — flag any model-version
  bump that lacks one.
