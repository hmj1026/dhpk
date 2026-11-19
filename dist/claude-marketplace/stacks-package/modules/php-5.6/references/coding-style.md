# PHP Coding Style (<your-project>-specific)

> Extends `~/.claude/rules/common/coding-style.md`. PHP 5.6 baseline — assume **all** PHP 7.0+ syntax is forbidden (typed params/returns/properties, `??`, `?->`, `match`, arrow fn, named args, group use, multi-catch, short list `[$a,$b]=`, `new class`, union types). Use PHPDoc for types, `isset() ?:` for null coalescing.

## PHP 5.6 polyfills (no PHP 7+ stdlib)

| Forbidden | Use |
|-----------|-----|
| `random_bytes()` / `random_int()` | `openssl_random_pseudo_bytes()` |
| `intdiv()` | `(int)($a / $b)` |
| `dirname(__FILE__, N)` | nested `dirname()` |
| `str_contains` / `str_starts_with` | `strpos` / `substr` |
| `array_column($a, null, $key)` reindex | pass explicit value key |
| `preg_replace_callback_array` | sequential `preg_replace_callback` |

## Framework Access

- Single key: `Yii::app()->request->getPost($key)` / `$this->Request->getPost($key)` (forbidden: `$_POST[$key]` / `$_GET[$key]`)
- Whole POST array in Controller: `$_POST` is the **only allowed exception** (Yii 1.1 has no `getAll()`); Controller layer only, and only after detecting presence via `$this->Request->getPost($key)` first.
- **Domain / Infrastructure layers (Request, Service, Repository)**: strictly forbid `$_POST` / `$_GET`. Request classes must receive an already-normalised array via constructor; do not read superglobals.
- Models need `public static function model($className=__CLASS__) { return parent::model($className); }`
- `queryRow()` returns `false` on miss (not null) — check with `!$result`

## Helper Priority (Str / Arr / Date)

Before any string / array / date operation, **first check** `infrastructure/Support/`:
- `Str`: contains / startsWith / endsWith / length / lower / upper / limit
- `Arr`: get / has / set / only / except / wrap / first / last / flatten
- `Date`: startOfDay / endOfDay / normalizeYmd

If the helper lacks the needed operation: **extend the helper**; manual concatenation in business code is forbidden.

| Forbidden | Correct |
|-----------|---------|
| `$date . ' 00:00:00'` | `Date::startOfDay($date)` |
| `$date . ' 23:59:59'` | `Date::endOfDay($date)` |

## Magic Values (DB column enums)

Bare literals `0` / `'0'` / `1` forbidden in queries / conditions. Priority:

1. **`AbstractEnum` subclass** (`infrastructure/Foundation/Structures/AbstractEnum.php`) — when reused in multiple places or needs description / Select options
   - Subclasses live in `domain/{Module}/Enums/` or `domain/Models/`
   - `const DESCRIPTIONS` is required, otherwise `getDescription()` throws
2. **Repository class constants** (fallback) — single-Repo usage, simple flags
   - Naming: `FIELD_SEMANTIC` (e.g. `PACKAGE_STATE_PENDING`)
   - Declared at top of class body + PHPDoc noting the field semantic source

Code smell: `(string)$x === '0'` → use `$x == self::CONST_UNSELECTED` (loose comparison).

## Variable Naming

| Kind | Rule | Example |
|------|------|---------|
| array / collection | snake_case plural | `$order_items`, `$pay_actions` |
| object | PascalCase | `$PayAction`, `$OrderRepo` |
| scalar | camelCase | `$storeId`, `$totalAmount` |
