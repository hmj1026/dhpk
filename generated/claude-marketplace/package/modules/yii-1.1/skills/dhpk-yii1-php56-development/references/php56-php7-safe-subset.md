# PHP 5.6 To PHP 7 Safe Subset

This reference distills migration-safe rules from the PHP manual and migration guidance.

Source basis: Context7 queries against `/websites/php_net_manual`.

## Prefer

- short array syntax: `[]`
- namespaces and `use` statements when the codebase already uses them
- PHPDoc for parameter, return, and property intent
- small methods, early returns, and explicit null or false checks
- variadics and argument unpacking only when they improve clarity and the repo style already accepts them
- `password_hash()` and `password_verify()` for password storage and verification
- PDO prepared statements with bound values

## Avoid

- scalar parameter types, return types, typed properties, anonymous classes, null coalescing, array spread, union types, and other PHP 7+ syntax
- `ext/mysql`
- PHP 4 style constructors
- `create_function()`
- relying on error suppression `@` as control flow
- relying on edge-case loose typing behavior that changed across PHP versions
- building SQL by concatenating untrusted input

## Data-access rules

- Use placeholders only for values, not SQL identifiers.
- Validate dynamic table names, column names, and sort directions with allow-lists before composing SQL.
- Bind data after preparing the statement.

## Migration-safe habits

- Prefer explicit casting and normalization near the boundary layer.
- Check falsey return values carefully when an API may return `false`, `null`, or `[]`.
- Keep language features conservative enough that the same code can be parsed by PHP 5.6 and still remain acceptable after upgrading to PHP 7.x.

## Security baseline

- Hash passwords with `password_hash()` and verify with `password_verify()`.
- Continue validating data even when prepared statements are used.
- Escape output for HTML separately; SQL safety does not protect against XSS.
