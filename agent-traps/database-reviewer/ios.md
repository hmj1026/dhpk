# database-reviewer — Core Data traps

Applies when the `ios-platform` module is active OR `*.xcdatamodeld` is present. Detail: ios-platform module `references/coredata-encryption.md`.

- **Threading** — `NSManagedObject` is not thread-safe. Never pass one across contexts/threads; pass `objectID` + re-fetch. All access inside `context.perform` / `performAndWait`; private-queue context for background writes, merge to the view context.
- **Faulting / N+1** — set `fetchBatchSize` and `relationshipKeyPathsForPrefetching`; don't traverse relationships in a loop without prefetch.
- **Predicates** — `NSPredicate(format:, args)`; never string-interpolate user input into the format.
- **Fetch correctness** — `fetchLimit = 1` for single-row; handle the empty/`nil` result.
- **Encryption (SQLCipher)** — passphrase sourced from Keychain (not a literal); build flags (`-DSQLITE_HAS_CODEC` / `-DSQLCIPHER_CRYPTO_CC`) + libsqlcipher + Security.framework linked; **verify the encrypted `NSIncrementalStore` actually registered** — the classic trap is a silent fallback to a plaintext SQLite file. Baseline fallback: `NSPersistentStoreFileProtectionKey = .complete`.
- **Locked-device reads** — File Protection (Complete) makes the store unreadable while locked; flag scheduling/notification code paths that read the store from the background.
- **Migration** — lightweight migration needs a versioned `.xcdatamodeld` + inferred/explicit mapping model; **flag destructive store recreation** (the SwiftData→Core Data template replacement has no rollback) — gate it to the empty-template state, never run on real user data.
