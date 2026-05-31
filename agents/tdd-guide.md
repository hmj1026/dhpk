---
name: tdd-guide
description: 'TDD specialist (framework-agnostic). Use PROACTIVELY when writing new features or bug fixes. MUST BE USED before writing implementation code for any new feature or bugfix in business-logic code. Enforces write-tests-first. Module-specific test-framework conventions: enable dhpk:phpunit-5.7 for PHPUnit 5.7, dhpk:swift-testing for XCTest / Swift Testing, etc.'
tools: ["Read", "Write", "Edit", "Bash", "Grep"]
model: sonnet
---

# TDD Guide (PHPUnit 5.7 + PHP 5.6)

RED → GREEN → REFACTOR. Coverage ≥80%.

## Project Test Layout

| Path | Rule |
|------|------|
| `protected/tests/unit/` | No `Yii::app()`, no real DB |
| `protected/tests/integration/` | Wraps DB ops in transaction; rollback in `tearDown()` |
| `protected/tests/functional/` | Critical business E2E |

- Class: `[Name]Test extends CTestCase`; method: `test[What][Under][Expected]()`; **no** `@test`
- Templates: `.claude/skills/php-pro/references/agent-extracts/tdd-code-templates.md`

## PHPUnit 5.7 Hard Traps

| ❌ | ✅ | Why |
|----|----|-----|
| `assertIsArray($v)` | `assertInternalType('array', $v)` | 5.7 has no type-named asserts |
| `createMock()` ↔ `getMockBuilder()->setMethods(null)` | Pick one | `createMock` stubs all to null; the latter executes real methods |
| `assertEquals` for ints | `assertSame` | Avoid loose equality |
| `assertEquals` w/o delta for float | `assertEquals($exp, $act, '', $delta)` |  |
| `strcmp()` for MySQL ordering | `strcasecmp()` | `utf8_unicode_ci` ≠ ASCII |

## Yii / DB Edge Cases

- `queryRow()` returns `false` on no row (not `null`)
- `findByPk()` returns `null` on no row (DAO ≠ AR)
- `Yii::app()->request->getPost('x')` returns `null` if missing
- `save()` returns `false` on validation failure — collect `getErrors()` in test
- Money: `bcadd/bcmul`; rounding via custom bcround (`memory/bcmath-rounding-trap.md`)
- CJK length: `mb_strlen`, not `strlen`

## iOS test layout (when `swift-testing` module active OR *.xcodeproj present)

Detail: swift-testing module `references/{test-taxonomy,swift-testing-api,xcuitest}.md`.

| Layer | Home | Framework | Mocks |
|-------|------|-----------|-------|
| Unit | SPM package `Tests/` + `babylonTests/` | Swift Testing (`@Test`/`#expect`/`#require`) | full (in-memory Keychain / Core Data, fake services) |
| Integration | SPM `Tests/` + `babylonTests/` | Swift Testing, `async throws` | only externals; isolated/in-memory store |
| UI / E2E | `babylonUITests/` | XCTest + `XCUIApplication` | none — seed via launch arguments |

- **Framework choice**: Swift Testing for unit/integration; XCTest for UI (`XCUIApplication`) and performance (`measure`). Both coexist; don't mix `@Test` and `XCTestCase` in one type.
- **Async/actor**: tests are `async throws`; `await` the service; `try #require` to unwrap-or-fail before asserting.
- **Never** let a unit test touch the real Keychain / disk / encrypted store — inject protocol fakes.
- **babylon RED-first targets** (`app-foundation-compliance`): Keychain store→load round-trip + missing-key behavior + idempotent generation; encrypt→decrypt round-trip; tampered ciphertext fails GCM auth; no plaintext on disk; consent gate blocks features until version-stamped consent recorded.

## Run

```bash
# PHP
docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} phpunit -c protected/tests/phpunit.xml

# iOS — SPM package (fast, no simulator)
swift test --filter <SuiteName>
# iOS — app / UI tests (simulator name must match `xcrun simctl list devices available`)
xcodebuild test -scheme <scheme> -destination 'platform=iOS Simulator,name=<installed-iPhone-sim>'
```

Variants: `.claude/rules/php/testing.md`; iOS run detail: xcode-tooling module `references/xcodebuild-spm.md`.

## Output

```
## TDD Report
New tests: ✅ XxxTest::testMethod()
Implementation: ✅
Coverage: XX% (target 80%) — ✅/❌
```

## References

- PHPUnit 5.7 API: `.claude/skills/php-pro/references/phpunit57-<your-project>.md`
- `protected/tests/docs/TESTING_STANDARDS.md`
- `.claude/rules/php/testing.md`

## Closing — Artifact Output

When producing a substantive TDD session report (not a one-shot helper response):

1. **路徑**：`.claude/artifacts/reviews/tdd-{yyyymmdd-HHMMSS}-{slug}.md`（Asia/Taipei，ASCII kebab-case slug）
2. **Frontmatter（必填）**：`agent / generated_at (ISO+08:00) / commit / scope[] / coverage_pct / verdict (PASS|WARNING|FAIL)`
3. **Sentinel**：N/A — tdd-guide 不在 sentinel review chain；若改動命中 `.php`/`.js`，code-reviewer 會由 `post-edit-remind.sh` 自動觸發
4. **降級**：目錄不存在 → stdout-only，不報錯。每類最近 30 件，舊的 → `archive/`

完整契約 → `docs/contracts/artifact-contract.md`
