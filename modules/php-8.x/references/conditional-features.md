# PHP 8.x conditional-feature reference

Index of every PHP 8.x feature added by this module, with the min-PHP it
requires and the *library-author rule* for using it under a mixed
composer constraint.

## Min-PHP per feature

| Feature | Min PHP | Syntax or runtime? |
|---|---|---|
| `match` expression | 8.0 | syntax |
| Nullsafe `?->` | 8.0 | syntax |
| Named arguments | 8.0 | syntax |
| Constructor promotion | 8.0 | syntax |
| Attributes `#[…]` | 8.0 | syntax (but **parses as comment on 7.x**) |
| `readonly` properties | 8.1 | syntax |
| Enums | 8.1 | syntax |
| Intersection types | 8.1 | syntax |
| `new` in initializers | 8.1 | syntax |
| Never return type | 8.1 | syntax |
| `readonly` classes | 8.2 | syntax |
| DNF types | 8.2 | syntax |
| `AllowDynamicProperties` attribute | 8.2 | runtime |
| Typed class constants | 8.3 | syntax |
| `#[Override]` attribute | 8.3 | runtime |
| `json_validate()` | 8.3 | runtime |

> **Syntax features have no polyfill.** A function-based feature
> (`str_contains` in 8.0, `json_validate` in 8.3) can be polyfilled with
> `function_exists` checks + a userland implementation. A syntax feature
> cannot — it produces a parse error before any check runs.

## Library author quick-decision table

What you can ship under each composer constraint:

| Composer floor | Safe to use |
|---|---|
| `^7.4 \|\| ^8.0` | Attributes (forward-compatible) — and only those |
| `^8.0` | All 8.0 syntax features |
| `^8.1` | + readonly, enums, intersection, new in initializers, never |
| `^8.2` | + readonly classes, DNF types |
| `^8.3` | + typed class constants, `#[Override]`, `json_validate` |

## Behaviour-changes per minor

Not features per se, but things that change between minor versions:

| From | To | Change | Action |
|---|---|---|---|
| 8.0 | 8.1 | Implicit nullable from default `null` deprecated | Add `?` to the param type: `function f(int $x = null)` → `function f(?int $x = null)` |
| 8.1 | 8.2 | `${…}` string interpolation deprecated | Use `{$…}` or concatenation |
| 8.1 | 8.2 | Dynamic properties deprecated by default | Mark class `#[AllowDynamicProperties]` or refactor |
| 8.2 | 8.3 | `unserialize()` of class with readonly properties tightened | Test serialization roundtrips |

When supporting a range across these minors, your CI matrix should
include the lowest and the highest cell to surface deprecations early.

## Related references

- `modules/php-7.4/references/static-checks.md` — PHPStan / Psalm rules
  that catch deprecation usage when the project sets a min-PHP target
- `modules/php-8.x/skills/php-8x-features/SKILL.md` — the in-depth
  per-feature guidance
