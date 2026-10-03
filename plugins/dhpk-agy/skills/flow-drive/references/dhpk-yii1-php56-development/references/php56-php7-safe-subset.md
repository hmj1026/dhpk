# PHP 5.6 To PHP 7 Safe Subset

Use this file to keep syntax, API calls, and data access valid on PHP 5.6 and clean after a move to PHP 7.x.
Source basis: dhpk-authored guidance; general practice and public Yii 1.1 / PHP / PHPUnit facts, written without copying upstream text.

## Use freely

- `[]` array literals; namespaces and `use` imports where the codebase already has them.
- PHPDoc `@param`, `@return`, `@var` to express type intent in place of declared types.
- Short methods, guard clauses with early return, explicit `=== null` / `=== false` checks.
- Variadics and argument unpacking only when they read clearly and the repo already accepts them.
- `password_hash()` and `password_verify()` for credentials; PDO prepared statements with bound values.

## Do not use

- Scalar parameter type declarations or return type declarations.
- Typed properties or anonymous classes.
- `??`, spread inside array literals, or union types.
- Any other syntax that only parses on PHP 7+.
- `ext/mysql` (`mysql_*`) - gone in PHP 7; PHP 4-style constructors named after the class - deprecated in PHP 7.
- `create_function()` - deprecated and later removed; `@` error suppression as a way to steer control flow.
- Code that leans on loose-comparison or juggling behavior that changed between versions.
- SQL assembled by concatenating untrusted input.

## Data access

- Placeholders bind values only; they can never stand in for table names, column names, or `ASC`/`DESC`.
- Pick dynamic identifiers and sort directions from an allow-list, then prepare, then bind values.

```php
$columns = ['created_at' => 'created_at', 'name' => 'name'];
$column = isset($columns[$sort]) ? $columns[$sort] : 'created_at';
$direction = strtoupper($dir) === 'DESC' ? 'DESC' : 'ASC';
$stmt = $pdo->prepare("SELECT id, name FROM customer WHERE status = :status ORDER BY $column $direction");
$stmt->bindValue(':status', $status, PDO::PARAM_STR);
$stmt->execute();
```

## Habits that survive the upgrade

- Cast and normalize input explicitly at the boundary instead of relying on implicit coercion.
- Treat `false`, `null`, and `[]` as three different results; check for the one the API actually returns.
- Choose conservative features: parseable by PHP 5.6, unremarkable on PHP 7.x.

## Security baseline

- Hash and verify passwords only through the `password_*` functions.
- Validate input even when every query is prepared.
- Escape HTML output as a separate step: safe SQL does nothing to stop XSS.
