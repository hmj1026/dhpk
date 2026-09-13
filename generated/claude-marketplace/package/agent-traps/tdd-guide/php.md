# tdd-guide × php (PHPUnit 5.7 + Yii 1.1)

For the tdd-guide agent on PHPUnit 5.7 / Yii 1.1. Neighboring agents: database-reviewer (DAO vs AR), php-runtime-router (version-gated PHPUnit API).

Code templates: `skills/dhpk-php-runtime-router/references/agent-extracts/tdd-code-templates.md`. PHPUnit 5.7 API surface: `skills/dhpk-php-runtime-router/references/phpunit57-*.md`. Testing conventions: `modules/phpunit-5.7/references/testing.md`.

| Trigger | Action | Non-apply |
|---|---|---|
| new test file / wrong tree | unit → `protected/tests/unit/` (no `Yii::app()`, no real DB); integration → `protected/tests/integration/` (wrap DB ops in a transaction; rollback in `tearDown()`); functional → `protected/tests/functional/` (critical business E2E) | — |
| class not `[Name]Test extends CTestCase`, method not `test[What][Under][Expected]()`, or `@test` annotation | follow that layout; **no** `@test`. Templates: `skills/dhpk-php-runtime-router/references/agent-extracts/tdd-code-templates.md` | — |
| `assertIsArray($v)` (or other type-named asserts) | `assertInternalType('array', $v)` — 5.7 has no type-named asserts | PHPUnit 8+ projects that already have typed asserts (this sheet's 5.7 rows do not apply) |
| mixing `createMock()` with `getMockBuilder()->setMethods(null)` | pick one: `createMock` stubs all to null; the latter executes real methods | PHPUnit 8+ projects that already have typed asserts (this sheet's 5.7 rows do not apply) |
| `assertEquals` for ints | `assertSame` — avoid loose equality | — |
| `assertEquals` without delta for float | `assertEquals($exp, $act, '', $delta)` | — |
| `strcmp()` for MySQL `utf8_unicode_ci` ordering | `strcasecmp()` | — |
| `queryRow()` empty-result asserted as `null` | DAO `queryRow()` returns `false` on no row; AR `findByPk()` returns `null` (DAO ≠ AR) | — |
| `Yii::app()->request->getPost('x')` treated as empty string when missing | returns `null` if missing | — |
| `save()` asserted true without collecting errors | `save()` returns `false` on validation failure — collect `getErrors()` in test | — |
| money `+` / `*` / float in tests | `bcadd`/`bcmul`; rounding via custom bcround (`memory/bcmath-rounding-trap.md`) | non-money integer counts |
| CJK length via `strlen` | `mb_strlen` | — |

## Run

```bash
docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} phpunit -c protected/tests/phpunit.xml
```

## References

- PHPUnit 5.7 API: `skills/dhpk-php-runtime-router/references/phpunit57-*.md`
- `protected/tests/docs/TESTING_STANDARDS.md`
- testing: `modules/phpunit-5.7/references/testing.md`
