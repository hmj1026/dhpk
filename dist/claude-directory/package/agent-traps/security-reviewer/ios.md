# security-reviewer — iOS / Swift traps

Encodes a health/PHI app's at-rest-encryption + PDPA Art. 6 + App Review duties. Detail: ios-platform module `references/{cryptokit-keychain,coredata-encryption,privacy-compliance,local-authentication}.md`.

| Trigger | Action | Non-apply |
| --- | --- | --- |
| CRITICAL — Keychain item weaker than `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` for PHI keys | set that accessibility class; never `...AfterFirstUnlock` for the most sensitive keys | `kSecAttrAccessibleAfterFirstUnlock` on a **non-PHI** key that genuinely needs background read — note the File-Protection trade-off, don't flag as CRITICAL |
| CRITICAL — `kSecAttrSynchronizable = true` on a PHI / encryption key | drop it — syncs to iCloud Keychain (prohibited for health data) | |
| CRITICAL — Prescription / medication data or images sent to iCloud / CloudKit, or not excluded from backup | no CloudKit on the store; `isExcludedFromBackup = true`; File Protection. (App Review 5.1.3(ii) + PDPA §6) | |
| CRITICAL — Core Data store with PHI and no SQLCipher and no `NSFileProtectionComplete` | encrypt at rest (SQLCipher) or at minimum `NSPersistentStoreFileProtectionKey = .complete` | |
| CRITICAL — Hardcoded encryption key, or key derived from a device constant | generate `SymmetricKey(size: .bits256)`, store in Keychain | |
| CRITICAL — `AES.GCM` nonce reuse, or `open` result used without the auth-tag throw | fresh random nonce per `seal`; never bypass the `open` throw (it is the integrity check) | |
| CRITICAL — SQLCipher silently falling back to plaintext SQLite (store type not registered / build flags missing) | verify the encrypted store type loaded; on-disk header must not be a readable SQLite header | |
| HIGH — Missing / incomplete Privacy Manifest (`NSPrivacyAccessedAPITypes` reason codes, Health & Fitness in `NSPrivacyCollectedDataTypes`, `NSPrivacyTracking`) | add `PrivacyInfo.xcprivacy` with correct reason codes | |
| HIGH — Missing usage strings (`NSCameraUsageDescription`, `NSFaceIDUsageDescription`, HealthKit, photos) | add honest purpose strings (app crashes / is rejected otherwise) | |
| HIGH — `LAContext` result trusted without re-eval, no `LAError` handling, no passcode fallback policy | re-evaluate per gated foreground; map `LAError`; allow `.deviceOwnerAuthentication` fallback | force-unwrap inside a test target, or an `@IBOutlet` / lifecycle-guaranteed property |
| HIGH — ATS disabled (`NSAllowsArbitraryLoads = true`) | remove; keep ATS at defaults | |
| HIGH — PHI processed before the version-stamped consent gate | gate all PHI processing behind recorded consent (version + timestamp) | |
| HIGH — PHI in `print` / `os_log` without redaction | `os_log("\(x, privacy: .private)")`; never log keys / drug data | |
| HIGH — Data deletion that purges the store but leaves the Keychain key or encrypted image files | deletion must purge store + Keychain key + encrypted files (PDPA §15/§16) | |

**Gate** (same verdict vocabulary as the rest of this review): any **CRITICAL** row present → `FAIL`; **HIGH**-only → `WARNING`; none → `PASS`. A `FAIL` on a PHI path blocks the commit.

## Worked example

```swift
// BAD — PHI key syncs to iCloud Keychain and survives at AfterFirstUnlock
SecItemAdd([kSecAttrSynchronizable: true,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlock, ...] as CFDictionary, nil)
// GOOD — device-only, unlocked-only, non-syncing for PHI keys
SecItemAdd([kSecAttrSynchronizable: false,
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly, ...] as CFDictionary, nil)
```
