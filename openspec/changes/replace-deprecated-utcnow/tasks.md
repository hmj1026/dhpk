## 1. Regression coverage

- [x] 1.1 Add a public installer regression for warning-free sync under
  `PYTHONWARNINGS=error::DeprecationWarning`.
- [x] 1.2 Assert the receipt `installed_at` value and backup-run naming retain
  second-precision UTC `Z` formatting.

## 2. Installer implementation

- [x] 2.1 Replace both `datetime.utcnow()` calls with timezone-aware UTC
  construction compatible with the supported Python baseline.
- [x] 2.2 Run focused installer tests and the complete repository validation
  gates; record the results in the PR.

## 3. Delivery evidence

- [x] 3.1 Link issue #163 and the focused OpenSpec change in the PR, then leave
  the issue open until the merged exact-head CI result is confirmed.
