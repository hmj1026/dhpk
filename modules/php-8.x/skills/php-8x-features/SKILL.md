---
name: php-8x-features
description: PHP 8.0 → 8.3 language features and when to adopt them. Use when the project's PHP floor permits 8.x syntax, when reviewing whether a 7.4-and-up library can adopt an 8.x idiom conditionally, when designing a public API leveraging attributes / enums / readonly, or when migrating a 7.4-style class to its 8.x equivalent. Covers match, nullsafe, named arguments, constructor promotion, attributes, readonly properties / classes, enums, intersection / DNF types, new in initializers, and typed class constants, each with a min-PHP marker. Counterpart to php-modern-pro (7.4-baseline). Not for everyday business logic — load when picking between two valid idioms or designing API shape.
---

# PHP 8.x features — additive on top of 7.4

This skill assumes you've read or have access to
`modules/php-7.4/skills/php-modern-pro/SKILL.md`. That skill covers 7.4
baseline + dual-version-floor library patterns. This skill adds the 8.x
features and the **library-author rule** for each: when can you use it
unconditionally, when must you gate it.

> Mental model: every 8.x feature is **syntax**, not runtime. There is
> no polyfill. If the constraint floor is 7.x, the code is a parse error
> on 7.x runtimes — you cannot wrap it in a `function_exists` check.

---

## 8.0 features

### `match` expression — min PHP 8.0

```php
$label = match ($code) {
    100, 200, 300 => 'success',
    404           => 'not found',
    500           => 'server error',
    default       => 'unknown',
};
```

- Strict comparison (`===`), unlike `switch`'s loose `==`.
- Each arm is an *expression* — returns a value. The whole `match`
  evaluates to that value.
- Missing default + unhandled value throws `UnhandledMatchError`. This
  catches bugs that `switch`'s silent fall-through hides.
- **Library rule**: gate to apps with PHP floor ≥8.0. Don't ship in a
  `^7.4 \|\| ^8.0` library — `switch` is the right idiom there.

### Nullsafe `?->` — min PHP 8.0

```php
$city = $user?->profile?->address?->city ?? 'unknown';
```

- Chain stops at the first `null`; the whole expression evaluates to
  `null`. Pair with `??` for a default.
- Only works on method/property access, not array indexing
  (`$arr['k']?->` is invalid; use `($arr['k'] ?? null)?->`).
- **Library rule**: same as `match` — parse error on 7.4.

### Named arguments — min PHP 8.0

```php
$msg = new Message(body: $text, subject: $title, priority: 'high');
```

- Skip optional params positionally, name only the ones you set.
- **API stability trap**: once tagged a release where consumers can pass
  named args, your internal parameter *names* become part of the public
  contract. Renaming `$msg` → `$body` becomes a breaking change.
- **Library rule**: use freely in apps. In libraries, document which
  classes/methods you guarantee parameter-name stability for. Mark
  helpers with `@internal` so consumers know not to use named args
  against them.

### Constructor promotion — min PHP 8.0

```php
final class UserId
{
    public function __construct(
        public readonly int $value,   // 8.1 readonly
        private string $generatedBy = 'system',
    ) {}
}
```

- Combines property declaration + constructor assignment into the
  signature. Cuts boilerplate dramatically for value objects and DTOs.
- Works without `readonly` on 8.0 (use `private`/`public` directly).
- **Library rule**: parse error on 7.4.

### Attributes `#[…]` — min PHP 8.0 (with a wrinkle)

```php
#[Route('/users/{id}', methods: ['GET'])]
final class UserController { /* ... */ }
```

- Native replacement for PHPDoc annotations that drove runtime
  behaviour (Doctrine annotations, Symfony routes).
- **PHP 7.x wrinkle**: `#[` parses as a comment in 7.x (since `#` starts
  a comment). So attributes are *forward-compatible* — a 7.4 runtime
  ignores them silently. You can ship attributes in a `^7.4 \|\| ^8.0`
  library; they're inert on 7.x but useful on 8.x.
- Caveat: the framework reading the attributes (Symfony, Laravel,
  Doctrine) must run on 8.x for the attribute to do anything. If the
  framework version constraint includes 7.x, the attribute is dead
  weight there.

---

## 8.1 features

### `readonly` properties — min PHP 8.1

```php
final class Point
{
    public function __construct(
        public readonly float $x,
        public readonly float $y,
    ) {}
}
```

- Compile-time enforcement of single-assignment. Writing after
  construction throws `Error`.
- Combined with constructor promotion, this is the killer feature for
  value objects.
- **Library rule**: 8.1+ floor required.

### Enums — min PHP 8.1

```php
enum Status: string
{
    case Active   = 'active';
    case Disabled = 'disabled';
    case Banned   = 'banned';

    public function isAccessible(): bool
    {
        return match ($this) {
            self::Active                            => true,
            self::Disabled, self::Banned            => false,
        };
    }
}

// Caller
$status = Status::from('active');                 // throws if invalid
$status = Status::tryFrom($input);                // returns null if invalid
```

- Pure enums (no backing type) and backed enums (`: string` / `: int`).
- Cases are singletons — compare with `===`.
- Replaces "constants on a class + a `valueOf()` static method" pattern.
- **Library rule**: 8.1+ floor required. For 7.4-compatible libraries,
  use the `myclabs/php-enum` polyfill class pattern instead.

### Intersection types — min PHP 8.1

```php
function persist(Countable&Iterator $items): void { /* ... */ }
```

- Parameter must implement *all* listed types. Stronger than union;
  weaker than a concrete type.
- Useful when you need behaviour from multiple interfaces but no single
  type captures both.
- **Library rule**: 8.1+ floor required.

### `new` in initializers — min PHP 8.1

```php
final class Cache
{
    public function __construct(
        private LoggerInterface $log = new NullLogger(),  // before: had to be null + lazy-init
    ) {}
}
```

- Default values, attributes, property/parameter defaults can now use
  `new X()`. Eliminates `null`-and-then-lazy-init dances.
- **Library rule**: 8.1+ floor required.

---

## 8.2 features

### `readonly` classes — min PHP 8.2

```php
final readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}
```

- Shortcut for "every property is readonly". Equivalent to marking each
  property `readonly` individually.
- Cannot have dynamic properties (also blocked in 8.2 by default for
  non-readonly classes via the `AllowDynamicProperties` attribute
  opt-in).
- **Library rule**: 8.2+ floor required.

### Disjunctive Normal Form (DNF) types — min PHP 8.2

```php
function handle((Countable&Iterator)|null $items): void { /* ... */ }
```

- Combine union and intersection. The example accepts either
  `(Countable AND Iterator)` or `null`.
- Required when you need optional intersection types — previously
  impossible to express.
- **Library rule**: 8.2+ floor required.

---

## 8.3 features

### Typed class constants — min PHP 8.3

```php
final class Config
{
    public const string DEFAULT_TIMEZONE = 'UTC';
    public const int    MAX_RETRIES      = 3;
}
```

- Constants gain explicit types — catches accidental redeclaration with
  the wrong type.
- **Library rule**: 8.3+ floor required.

### Other 8.3 niceties

- `#[Override]` attribute — declares "this method must override a
  parent's method"; compiler errors if it doesn't. Cheap insurance
  against parent-rename drift.
- `json_validate()` function — checks JSON syntax without decoding
  (faster than `json_decode + last_error` for validate-only use cases).

---

## Library author summary table

When the composer constraint is `^7.4 || ^8.0` (mixed):

| Feature | Can use? | Why |
|---|---|---|
| Attributes `#[…]` | ✓ (forward-compatible) | Parses as comment on 7.4 |
| Everything else listed here | ✗ | Hard parse error on 7.4 — no polyfill possible |

When the floor is `^8.0`:

| Feature | Status |
|---|---|
| match, nullsafe, named args, constructor promotion, attributes | ✓ all |
| readonly, enums, intersection, new in initializers | ✗ require 8.1 |

Bump the floor in `composer.json` deliberately — semver major. See
`skills/composer-package-hygiene/SKILL.md` for the bump checklist.

---

## When NOT to Use

- Everyday business logic — load only when picking between valid idioms or designing API shape
- 7.4-baseline idioms or dual-floor packaging patterns — use `php-modern-pro`
- Legacy 5.6 code — use `php-pro`

## Output

Inline guidance only — a feature recommendation with its min-PHP marker, or a migration suggestion. No file artifact.

## Verification

- [ ] The chosen feature's min-PHP is ≤ the project's declared floor
- [ ] For `^7.4 || ^8.0` libraries, only attributes are used unconditionally; every other 8.x feature is gated
- [ ] A floor bump in composer.json is treated as a semver major

---

## Cross-references

- `modules/php-7.4/skills/php-modern-pro/SKILL.md` — the 7.4 baseline
  this skill builds on; covers dual-floor patterns
- `modules/php-7.4/references/static-checks.md` — the lint/analysis
  pipeline; also runs against 8.x code when both modules are enabled
- `skills/composer-package-hygiene/SKILL.md` — semver bumps, public API
  surface, release flow
