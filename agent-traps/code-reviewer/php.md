# code-reviewer — PHP traps

Apply at the project's `composer.json` `require.php` floor.

| Floor | Allowed | Banned |
|---|---|---|
| `^5.6` or `^7.0` | param class type hints, scalar type hints (7.0+) | **return-type declarations**, `??`, arrow fns, named args, union types, group `use`, multi-catch, short list `[$a,$b]=`. See `rules/php/coding-style.md`. |
| `^7.1+` (incl. `^7.3`, `^8.0`+) | return-type declarations, `??`, nullable types, `void` return, `?:`; `mixed` (8.0+); native enums (8.1+); union types (8.0+); `match` (8.0+); readonly (8.1+) | anything above the project's stated floor; match an explicit convention in CLAUDE.md / openspec config if present |

**LSP exceptions (never flag as violations)** — when a class implements an interface or extends a base that declares a typed signature, the subclass MUST match it even on a no-return-type floor:

- `PHPUnit\Framework\TestCase::setUp(): void` — every PHPUnit 8+ subclass MUST declare `protected function setUp(): void`.
- `ArrayAccess` (PHP 8.1+ tentative return types) — use `#[\ReturnTypeWillChange]` to defer, OR declare matching types.
- `Symfony\Component\HttpKernel\Exception\HttpExceptionInterface` (v6+ has `getStatusCode(): int` / `getHeaders(): array`) — implementations must match.
- Verify against the interface / parent signature before flagging a return type as "out of style".

## Worked examples

```php
// BAD — in-place mutation (violates the project immutability rule)
function activate(array $users): array {
    foreach ($users as $u) { $u->active = true; }   // mutates caller state
    return $users;
}
// GOOD — return new objects, never mutate the input
function activate(array $users): array {
    return array_map(fn($u) => $u->withActive(true), $users);
}
```

```php
// BAD — deep nesting, happy path buried at level 3
function price(?Order $o): int {
    if ($o) { if ($o->isValid()) { if ($o->items) { return $o->total(); } } }
    return 0;
}
// GOOD — guard clauses, happy path at level 0
function price(?Order $o): int {
    if (!$o || !$o->isValid() || !$o->items) return 0;
    return $o->total();
}
```
