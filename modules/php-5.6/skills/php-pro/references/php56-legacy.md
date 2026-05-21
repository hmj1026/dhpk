# PHP 5.6 Legacy Reference

## Contents

- Scope
- Upgrade-Ready Principles (Write Today, Upgrade Tomorrow)
- Language Features Introduced in PHP 5.6
- Compatibility Notes
- Upgrade-Safe Patterns in PHP 5.6
- Common 5.6 Patterns
- Upgrade Guidance (5.6 -> 7.4)
- References

## Scope

Use this reference when maintaining or backporting PHP 5.6 codebases. Write changes so the codebase can upgrade to PHP 7.4 with minimal refactors.

## Upgrade-Ready Principles (Write Today, Upgrade Tomorrow)

- Prefer Composer autoloading and namespaces for new code.
- Use PDO or mysqli, avoid `mysql_*`.
- Avoid deprecated or removed features: `mcrypt`, `preg_replace` with `/e`, `each()`, `create_function()`.
- Prefer strict comparisons and explicit type casting.
- Use small, testable functions. Add PHPUnit tests where feasible.
- Use PHPDoc for parameters and return types to prepare for future type hints.
- Centralize configuration in one place; avoid hardcoded constants scattered in code.

## Language Features Introduced in PHP 5.6

- Variadic functions with `...$params`
- Argument unpacking with `...$array` (arrays and Traversable)
- Constant scalar expressions in `const`, class constants, and default parameter values
- `use function` and `use const` for importing namespaced functions/constants
- Exponentiation operator `**` and `**=` (right-associative)

## Compatibility Notes

- Short array syntax `[]` is supported in PHP 5.6; follow repository style unless the codebase intentionally preserves pre-5.4 syntax.
- No `declare(strict_types=1);` (PHP 7+)
- No scalar type declarations or return types (added in PHP 7+)
- No null coalescing operator `??` (PHP 7+)
- No spaceship operator `<=>` (PHP 7+)
- No anonymous classes or arrow functions (PHP 7.4)
- No named arguments, attributes, constructor property promotion, union/intersection types, `match`, `readonly`, or enums (PHP 8+)
- No `Throwable` interface or `Error` exceptions (PHP 7+)
- Use `array()` instead of short array syntax only if the codebase is older than PHP 5.4

## Upgrade-Safe Patterns in PHP 5.6

### Use PHPDoc to future-proof type hints

```php
<?php
/**
 * @param int $userId
 * @return array
 */
function loadUser($userId) {
    // ...
}
```

### Centralize error handling

```php
<?php
function withErrorHandler(callable $fn) {
    try {
        return $fn();
    } catch (Exception $e) {
        error_log($e->getMessage());
        throw $e;
    }
}
```

### Prefer explicit casting

```php
<?php
$total = (int)$row['total'];
$price = (float)$row['price'];
```

## Common 5.6 Patterns

### Variadic functions

```php
<?php
function logMessages($level, ...$messages) {
    foreach ($messages as $message) {
        error_log("[$level] $message");
    }
}
```

### Argument unpacking

```php
<?php
function sum($a, $b, $c) {
    return $a + $b + $c;
}

$args = array(1, 2, 3);
$total = sum(...$args);
```

### Constant expressions

```php
<?php
const BASE = 10;
const MULTIPLIER = BASE * 2;

class Flags {
    const READ = 1;
    const WRITE = self::READ << 1;
}
```

### Namespace imports

```php
<?php
namespace Acme\Utils {
    const VERSION = '1.0';
    function help() { return 'help'; }
}

namespace {
    use const Acme\Utils\VERSION;
    use function Acme\Utils\help;

    echo VERSION;
    echo help();
}
```

### Exponentiation

```php
<?php
$area = 3 ** 2; // 9
$scale = 2;
$scale **= 3; // 8
```

## Upgrade Guidance (5.6 -> 7.4)

- Replace `mysql_*` with `mysqli` or PDO.
- Replace `mcrypt` with OpenSSL or Sodium.
- Remove `preg_replace` with `/e` (rewrite to callbacks).
- Remove `each()` usage and refactor to `foreach`.
- Convert old-style constructors to `__construct`.
- Add Composer autoloading to reduce manual `require` calls.
- Add tests around critical paths before changing language features.

## References

- PHP Manual: Migration 5.6
- PHP 5 official manual pages queried through Context7 for allowed 5.6 syntax examples
