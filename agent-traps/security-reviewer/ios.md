# security-reviewer — iOS / Swift traps

Encodes a health/PHI app's at-rest-encryption + PDPA Art. 6 + App Review duties. Detail: ios-platform module `references/{cryptokit-keychain,coredata-encryption,privacy-compliance,local-authentication}.md`.

| Pattern | Severity | Fix |
|---------|----------|-----|
| Keychain item weaker than `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for PHI keys | CRITICAL | set that accessibility class; never `...AfterFirstUnlock` for the most sensitive keys |
| `kSecAttrSynchronizable = true` on a PHI / encryption key | CRITICAL | drop it — syncs to iCloud Keychain (prohibited for health data) |
| Prescription / medication data or images sent to iCloud / CloudKit, or not excluded from backup | CRITICAL | no CloudKit on the store; `isExcludedFromBackup = true`; File Protection. (App Review 5.1.3(ii) + PDPA §6) |
| Core Data store with PHI and no SQLCipher and no `NSFileProtectionComplete` | CRITICAL | encrypt at rest (SQLCipher) or at minimum `NSPersistentStoreFileProtectionKey = .complete` |
| Hardcoded encryption key, or key derived from a device constant | CRITICAL | generate `SymmetricKey(size: .bits256)`, store in Keychain |
| `AES.GCM` nonce reuse, or `open` result used without the auth-tag throw | CRITICAL | fresh random nonce per `seal`; never bypass the `open` throw (it is the integrity check) |
| SQLCipher silently falling back to plaintext SQLite (store type not registered / build flags missing) | CRITICAL | verify the encrypted store type loaded; on-disk header must not be a readable SQLite header |
| Missing / incomplete Privacy Manifest (`NSPrivacyAccessedAPITypes` reason codes, Health & Fitness in `NSPrivacyCollectedDataTypes`, `NSPrivacyTracking`) | HIGH | add `PrivacyInfo.xcprivacy` with correct reason codes |
| Missing usage strings (`NSCameraUsageDescription`, `NSFaceIDUsageDescription`, HealthKit, photos) | HIGH | add honest purpose strings (app crashes / is rejected otherwise) |
| `LAContext` result trusted without re-eval, no `LAError` handling, no passcode fallback policy | HIGH | re-evaluate per gated foreground; map `LAError`; allow `.deviceOwnerAuthentication` fallback |
| ATS disabled (`NSAllowsArbitraryLoads = true`) | HIGH | remove; keep ATS at defaults |
| PHI processed before the version-stamped consent gate | HIGH | gate all PHI processing behind recorded consent (version + timestamp) |
| PHI in `print` / `os_log` without redaction | HIGH | `os_log("\(x, privacy: .private)")`; never log keys / drug data |
| Data deletion that purges the store but leaves the Keychain key or encrypted image files | HIGH | deletion must purge store + Keychain key + encrypted files (PDPA §15/§16) |

**Gate** (same verdict vocabulary as the rest of this review): any **CRITICAL** row present → `FAIL`; **HIGH**-only → `WARNING`; none → `PASS`. A `FAIL` on a PHI path blocks the commit.

## False positives

- `kSecAttrAccessibleAfterFirstUnlock` on a **non-PHI** key that genuinely needs background read — note the File-Protection trade-off, don't flag as CRITICAL
- force-unwrap inside a test target, or an `@IBOutlet` / lifecycle-guaranteed property
