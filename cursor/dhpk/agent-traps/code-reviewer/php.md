# code-reviewer — PHP traps

Language floor and banned-syntax tables live at
the project's PHP coding rules. Apply them at the project's
`composer.json` `require.php` floor. Do not restate those tables here.

## LSP exceptions (do not flag)

When a class implements an interface or extends a base that declares a typed
signature, the subclass MUST match it even on a no-return-type floor.

| Trigger | Action | Non-apply |
|---|---|---|
| PHPUnit 8+ test class overrides `setUp` | declare `protected function setUp(): void` | PHPUnit 5.7 / Yii 1 `CTestCase` does not use that signature |
| `ArrayAccess` implementor on PHP 8.1+ tentative return types | `#[\ReturnTypeWillChange]` or matching declared types | PHP < 8.1 |
| Symfony 6+ `HttpExceptionInterface` (`getStatusCode(): int`, `getHeaders(): array`) | match the interface types | Symfony 5 / projects that do not implement that interface |

Verify against the parent/interface signature before flagging a return type as
out of style.

## Unique code-reviewer rows

| Trigger | Action | Non-apply |
|---|---|---|
| In-place mutation of a caller-owned array/object (`foreach` writing `$u->active`) | return a new value; do not mutate the input | framework hydrators / AR `save()` that own the row |
| Happy path buried under nested `if` (depth ≥ 3) | guard clauses, happy path at level 0 | generated code / a single early-return already at level 0 |

## Worked example (PHP 5.6-legal)

```php
// BAD — deep nesting, happy path buried
function price($o) {
    if ($o) {
        if ($o->isValid()) {
            if ($o->items) {
                return $o->total();
            }
        }
    }
    return 0;
}
// GOOD — guard clauses
function price($o) {
    if (!$o || !$o->isValid() || !$o->items) {
        return 0;
    }
    return $o->total();
}
```
