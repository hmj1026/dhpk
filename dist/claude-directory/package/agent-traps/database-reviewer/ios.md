# database-reviewer × ios (Core Data)

For the database-reviewer agent on Core Data. Neighboring agents: security-reviewer (SQLCipher / Keychain / File Protection), tdd-guide (test stores).

Applies when the `ios-platform` module is active OR `*.xcdatamodeld` is present. Encryption detail: ios-platform `references/coredata-encryption.md`.

| Trigger | Action | Non-apply |
|---|---|---|
| `NSManagedObject` passed across contexts/threads | pass `objectID` + re-fetch; all access inside `context.perform` / `performAndWait`; private-queue context for background writes, merge to the view context | in-memory test stores |
| relationship traversal in a loop without prefetch | set `fetchBatchSize` and `relationshipKeyPathsForPrefetching` | in-memory test stores |
| user input string-interpolated into `NSPredicate` format | `NSPredicate(format:, args)` | — |
| single-row fetch without limit / empty handling | `fetchLimit = 1`; handle the empty/`nil` result | — |
| SQLCipher store without verifying encrypted `NSIncrementalStore` registration; passphrase as a literal | passphrase from Keychain; build flags (`-DSQLITE_HAS_CODEC` / `-DSQLCIPHER_CRYPTO_CC`) + libsqlcipher + Security.framework; **verify the encrypted store actually registered** — silent fallback to plaintext SQLite is the classic trap. Baseline: `NSPersistentStoreFileProtectionKey = .complete` | in-memory test stores |
| background scheduling/notification code that reads the store while the device is locked | File Protection (Complete) makes the store unreadable while locked; flag those paths | in-memory test stores |
| destructive store recreation / SwiftData→Core Data template replacement on real user data | lightweight migration needs a versioned `.xcdatamodeld` + inferred/explicit mapping model; gate destructive recreate to the empty-template state, never run on real user data | in-memory test stores |
