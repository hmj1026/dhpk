---
name: ios-platform
description: iOS SDK framework guidance for a health/PHI app — Core Data at-rest encryption (SQLCipher / EncryptedCoreData, File Protection), CryptoKit AES.GCM + Keychain key management, Vision OCR (RecognizeTextRequest / VNRecognizeTextRequest), AVFoundation capture, LocalAuthentication biometric lock, UserNotifications (Time Sensitive, 64-pending limit), HealthKit read-only, and privacy-manifest / data-protection / iCloud-prohibition compliance. Use when implementing or reviewing persistence, encryption, Keychain, OCR, camera, biometric auth, local notifications, HealthKit, or the privacy manifest in an iOS app. Requires the swift module. Not for SwiftUI view composition (swiftui) or pure language questions (swift). Output: SDK-specific implementation or review guidance with privacy and verification gates.
---

# iOS platform SDK

Routing index — load the reference that matches the task:

| Task | Reference |
|------|-----------|
| Core Data store, encryption, migration | `references/coredata-encryption.md` |
| Encrypting files/images, key storage | `references/cryptokit-keychain.md` |
| Text recognition / OCR | `references/vision-ocr.md` |
| Face ID / Touch ID / passcode | `references/local-authentication.md` |
| Local reminders / scheduling | `references/notifications.md` |
| Reading HealthKit data | `references/healthkit-read.md` |
| Privacy manifest, usage strings, data protection | `references/privacy-compliance.md` |
| Offline local store (actor + file-backed cache) | `references/actor-persistence.md` |

---

## Always-on non-negotiables (health / PHI data)

These hold regardless of which reference you load — they encode babylon's PDPA
Art. 6 special-category-data + App Review obligations:

1. **No iCloud for health data.** Prescriptions, medications, scan images, and
   member health profiles must never go to iCloud / CloudKit / iCloud backup.
   Exclude data files from backup; do not enable CloudKit on the Core Data store;
   never set `kSecAttrSynchronizable` on PHI keys. (App Review 5.1.3(ii).)

2. **Encrypt at rest.** The Core Data store holding PHI is encrypted — SQLCipher
   via EncryptedCoreData (high), or at minimum `NSFileProtectionComplete` on the
   store file (baseline). Images are encrypted with CryptoKit `AES.GCM` and
   written with `NSFileProtectionComplete`.

3. **Keys live in the Keychain**, accessible
   `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, never synchronizable, never
   hardcoded.

4. **Vision OCR does not read handwriting reliably** — a manual-correction path
   (`rawDrugName` free entry) is mandatory, not an afterthought.

5. **Notifications use Time Sensitive**, not Critical Alert; respect the
   64-pending-notification limit with rollover re-scheduling on launch.

6. **HealthKit is read-only** (no public write API for medication records).

## When NOT to Use

- SwiftUI view composition / state / navigation → swiftui module.
- Pure language questions (concurrency, optionals, actors) → swift module.
- Test authoring for these services → swift-test-strategy.

## Output

Persistence / encryption / Keychain / OCR / camera / biometric / notification /
HealthKit / privacy-manifest code that satisfies the always-on PHI rules: no
iCloud sync, encrypted at rest, keys in the Keychain (this-device-only,
non-synchronizable), a manual fallback for OCR, and Time Sensitive notifications.

## Verification

- [ ] No PHI reaches iCloud / CloudKit / iCloud backup; `kSecAttrSynchronizable` never set on PHI keys.
- [ ] PHI store encrypted (SQLCipher / EncryptedCoreData, or `NSFileProtectionComplete` baseline); images via `AES.GCM`.
- [ ] Keychain items use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
- [ ] OCR has a manual-correction path; notifications stay under the 64-pending limit with rollover.
- [ ] Privacy manifest + usage strings present for every accessed sensitive API.

## Reviewer hand-off

Encryption / Keychain / privacy-manifest / consent findings → `security-reviewer`
(iOS Fix Map). Core Data threading / migration / SQLCipher wiring →
`database-reviewer` (Core Data section). Concurrency of these services → the
swift module / `code-reviewer`.
