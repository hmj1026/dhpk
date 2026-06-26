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
