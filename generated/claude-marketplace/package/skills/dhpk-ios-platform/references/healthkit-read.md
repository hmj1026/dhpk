# HealthKit — read-only medication access

## Scope

- babylon reads medication-related HealthKit data where available; it does
  **not** write medication records — there is **no public write API** for
  medication/clinical records, so don't design around writing them.
- Treat HealthKit as an **optional enrichment**, not a source of truth. The app's
  own encrypted Core Data store is the source of truth.

## Authorization

```swift
let store = HKHealthStore()
guard HKHealthStore.isHealthDataAvailable() else { return }   // iPad/Mac may lack it
try await store.requestAuthorization(toShare: [], read: readTypes)
```

- Request **read-only** (`toShare: []`).
- **You cannot detect read-denial.** HealthKit deliberately hides whether the
  user denied read access (to avoid leaking that data exists). So a query simply
  returns no results — design the UI to handle "no data" identically to "denied".
- iOS 26+ adds per-object authorization for some types; gate any reliance on it
  with availability checks and keep the read-only-enrichment posture.

## Rules

- Add the usage strings and the HealthKit capability/entitlement (see
  `privacy-compliance.md`); HealthKit data is special-category — the Privacy
  Manifest must declare Health & Fitness collection if you persist any of it.
- Never copy HealthKit-sourced PHI into an unencrypted store or off-device.
- Queries run async; deliver to `@MainActor` for UI.
- `isHealthDataAvailable()` is false on devices without Health — degrade
  gracefully, don't crash or block core flows.
