# CryptoKit AES.GCM + Keychain key management

## Keychain key storage

The master data-encryption key is generated once and stored in the Keychain:

```swift
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "app.rxscan.masterKey",
    kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    kSecValueData as String: keyData,
]
```

Rules:

- **Accessibility = `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.** Available
  only while unlocked, and the `ThisDeviceOnly` suffix prevents the item
  migrating to a new device via backup. For PHI keys this is the floor.
- **Never set `kSecAttrSynchronizable = true`** — that syncs the key to iCloud
  Keychain across devices, which is prohibited for health-data keys.
- Wrap the key store behind a protocol (`KeychainKeyStoring`) for substitution in
  tests; make the implementation an `actor` (it owns mutable cached state and is
  touched from multiple tasks).
- Map `OSStatus` results into a domain `KeychainError` at the boundary; handle
  `errSecItemNotFound` (first launch → generate) vs `errSecDuplicateItem`
  (update) vs unexpected status (throw).
- Generation: `SymmetricKey(size: .bits256)` → store its raw representation.
  Generation must be idempotent (don't overwrite an existing key on every launch).
- **Testing:** the real SecItem path fails under a host `swift test` runner
  (no entitlements → `errSecMissingEntitlement`). Unit-test the *logic* against an
  in-memory fake conforming to the same protocol; integration-test the real store
  on a simulator/device. (This is why the store is protocol-wrapped.)

## AES.GCM file/image encryption

```swift
func encrypt(_ plaintext: Data, key: SymmetricKey) throws -> Data {
    let sealed = try AES.GCM.seal(plaintext, using: key)   // random nonce per call
    return sealed.combined!          // nonce ‖ ciphertext ‖ tag
}
func decrypt(_ blob: Data, key: SymmetricKey) throws -> Data {
    let box = try AES.GCM.SealedBox(combined: blob)
    return try AES.GCM.open(box, using: key)               // throws on tag mismatch
}
```

Rules:

- **Fresh random nonce per `seal`** — `AES.GCM.seal` generates one by default; do
  **not** pass a fixed/reused nonce. Nonce reuse under the same key is a
  catastrophic GCM failure.
- **`open` verifies the authentication tag** and throws if the ciphertext was
  tampered with — never bypass it or ignore the throw. That throw *is* your
  integrity check.
- Store `sealed.combined` (nonce + ciphertext + tag together). Don't split and
  drop the tag.
- Write ciphertext files with `NSFileProtectionComplete`
  (`try data.write(to:, options: [.completeFileProtection, .atomic])`).
  **Caveat:** `Data.WritingOptions.completeFileProtection` is **iOS-only** — it
  does not compile on a macOS host. Keep the crypto core a pure `Data → Data`
  type (host-testable under `swift test`) and do the protection-aware *write* in
  an iOS-only layer/extension. Mixing the write into the crypto type forces the
  whole package onto a simulator to test.
- The key comes from the Keychain key store — never hardcode, never derive from a
  device identifier, never log it.

## babylon services

- `KeychainKeyStore` (actor, protocol-wrapped) — generate/load the master key.
- `ImageCryptoService` (protocol-wrapped) — `AES.GCM` seal/open of scan images,
  key injected from the key store, ciphertext files protection-Complete.
