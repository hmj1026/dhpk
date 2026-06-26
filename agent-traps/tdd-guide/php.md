# tdd-guide — PHP traps

PHPUnit 5.7 + Yii 1.1 conventions. Code templates: `modules/php-5.6/skills/php-pro/references/agent-extracts/tdd-code-templates.md`. PHPUnit 5.7 API surface: `modules/php-5.6/skills/php-pro/references/phpunit57-*.md`.

## Project Test Layout

| Path | Rule |
|------|------|
| `protected/tests/unit/` | No `Yii::app()`, no real DB |
| `protected/tests/integration/` | Wraps DB ops in transaction; rollback in `tearDown()` |
| `protected/tests/functional/` | Critical business E2E |

- Class: `[Name]Test extends CTestCase`; method: `test[What][Under][Expected]()`; **no** `@test`
- Templates: `modules/php-5.6/skills/php-pro/references/agent-extracts/tdd-code-templates.md`

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

## Run

```bash
docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} phpunit -c protected/tests/phpunit.xml
```

Variants: `.claude/rules/php/testing.md`.

## References

- PHPUnit 5.7 API: `modules/php-5.6/skills/php-pro/references/phpunit57-*.md`
- `protected/tests/docs/TESTING_STANDARDS.md`
- `.claude/rules/php/testing.md`
