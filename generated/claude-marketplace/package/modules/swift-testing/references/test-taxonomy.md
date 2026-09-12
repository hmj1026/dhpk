# Test taxonomy — 3 layers → homes

| Layer | Home | Mocks | Framework | Focus |
|-------|------|-------|-----------|-------|
| **Unit** | SPM package `Tests/` targets + `babylonTests/` | full (in-memory Keychain, in-memory Core Data, fake services) | Swift Testing | one type/function: view model logic, crypto round-trip, key store, schedule math |
| **Integration** | SPM package `Tests/` + `babylonTests/` | only externals; real DB in a throwaway store | Swift Testing | type ↔ type: view model ↔ repository ↔ Core Data; encrypt → persist → reload |
| **UI / E2E** | `babylonUITests/` | none (real app, seeded via launch args) | XCTest + XCUIApplication | full user flow: consent, lock, scan happy path |

## Layer rules

- **Unit**: no disk, no network, no real Keychain. Sub-second. The bulk of the
  suite. Substitute every dependency through its protocol.
- **Integration**: real Core Data but an **isolated** store (`NSInMemoryStoreType`
  or a temp-dir SQLite deleted in teardown); wrap mutations so each test starts
  clean. Real CryptoKit (it's pure). Never the app's shared encrypted store.
- **UI**: few, critical-path only; deterministic via launch-argument seams (see
  `xcuitest.md`). Slowest — don't push edge cases here.

## Coverage dimensions (per feature)

1. **Happy path** — public API, main flow. (High)
2. **Error handling** — thrown errors, denied auth, network/IO failure,
   cancellation. (High)
3. **Edge cases** — empty/`nil`, boundaries (`Int.max`, empty `Data`, very large
   image), locked-device state. (Medium)
4. **Fake quality** — fakes behave like the real thing (a fake Keychain that
   "forgets" on relaunch, an in-memory store that enforces constraints). (Medium)

## Boundary checklist (Swift)

| Type | Cases |
|------|-------|
| String | `""`, whitespace, very long, non-ASCII (zh-Hant), emoji |
| Optional | `nil`, `.some` |
| Number | `0`, negative, `.max`/`.min`, overflow |
| Collection | `[]`, single, large, nested |
| Data | empty, 1 byte, multi-MB image, tampered |
| Date | DST boundary, timezone, schedule rollover at midnight |

## Targets

- New business-logic code lands with its unit tests in the same change (RED-first).
- Critical flows (spec §6.2) get one UI test each.
- Coverage target ≥ 70% per the project NFR; services/view models aim higher.
