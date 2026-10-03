# Privacy & compliance — manifest, usage strings, data protection

babylon handles special-category health data (Taiwan PDPA Art. 6) and must pass
App Review for a health app. These are the platform-level obligations.

## Privacy Manifest (`PrivacyInfo.xcprivacy`)

Required for the app and any SDK that needs one. Declare:

- **`NSPrivacyCollectedDataTypes`** — if any data is "collected" (leaves the
  device or is linked), list it. babylon keeps PHI on-device, so ideally **no**
  health data is "collected" in Apple's sense — but if analytics/crash data is
  collected, declare it accurately and never link it to health data.
- **`NSPrivacyAccessedAPITypes`** — declare required-reason APIs you use with the
  correct reason codes: `UserDefaults` (CA92.1), file timestamp, disk space,
  active keyboard, etc. Missing/incorrect reason codes → App Store rejection.
- **`NSPrivacyTracking`** — `false` for babylon (no cross-app tracking / IDFA).
- **`NSPrivacyTrackingDomains`** — empty.

## Info.plist usage strings (purpose strings)

Every protected resource needs a clear, honest purpose string or the app
crashes on first access / is rejected:

| Key | For |
|-----|-----|
| `NSCameraUsageDescription` | scanning prescriptions |
| `NSPhotoLibraryUsageDescription` / `...AddUsageDescription` | importing/saving images (if used) |
| `NSFaceIDUsageDescription` | biometric app lock |
| HealthKit usage strings + capability | reading health data |
| `NSUserNotificationsUsageDescription` (where applicable) | reminders |

## Data protection & iCloud prohibition

- Enable **Data Protection** capability; write PHI files with
  `NSFileProtectionComplete`; the Core Data store uses
  `NSPersistentStoreFileProtectionKey` (see `coredata-encryption.md`).
- **Exclude PHI from iCloud backup:** set `URLResourceValues.isExcludedFromBackup
  = true` on data file URLs; do **not** enable CloudKit on the store; do **not**
  set `kSecAttrSynchronizable` on Keychain items.
- App Transport Security: never set `NSAllowsArbitraryLoads = true`. If the app
  has no network calls for PHI, keep ATS at defaults.

## Consent

- `app-onboarding-consent` spec: obtain explicit, **version-stamped** consent
  before any PHI processing. Store the consent version + timestamp; re-prompt on
  policy change. No feature that processes PHI runs before the consent gate.
- Provide data rights (PDPA §15/§16): export, correction, deletion, consent
  withdrawal (`settings-data-management`). Deletion must purge the encrypted
  store **and** the Keychain key + encrypted image files.

## App Review specifics for a medical app

- No diagnostic/efficacy/treatment claims the app can't back up.
- Drug data sourcing must be labeled (TFDA/NHI per spec); do not redistribute
  prohibited datasets (WHO ATC) in-app.
- Time Sensitive (not Critical) notifications (see `notifications.md`).
