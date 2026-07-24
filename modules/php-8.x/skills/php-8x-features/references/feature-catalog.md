# PHP 8.x feature catalog

This catalog is the detailed reference for
`modules/php-8.x/skills/php-8x-features/SKILL.md`. Every feature below has a
minimum PHP version and a library-floor rule. PHP 8.x language features are
syntax, not runtime polyfills: code that cannot be parsed by the declared
floor cannot be conditionally hidden behind `function_exists`.

## PHP 8.0

### `match` expression

```php
$label = match ($code) {
    100, 200, 300 => 'success',
    404           => 'not found',
    500           => 'server error',
    default       => 'unknown',
};
```

- Minimum PHP: 8.0.
- Uses strict comparison (`===`), unlike `switch`'s loose comparison.
- Arms are expressions and the whole construct returns a value.
- Missing default plus an unhandled value throws `UnhandledMatchError`.
- Library rule: use unconditionally only when the application or package
  floor is at least PHP 8.0. For a `^7.4 || ^8.0` package, use `switch`.

### Nullsafe `?->`

```php
$city = $user?->profile?->address?->city ?? 'unknown';
```

- Minimum PHP: 8.0.
- The chain stops at the first `null`; combine with `??` for a default.
- It does not work on array indexing. Use `($arr['k'] ?? null)?->`.
- A 7.4 runtime treats it as a parse error, so mixed-floor packages cannot
  use it unconditionally.

### Named arguments

```php
$msg = new Message(body: $text, subject: $title, priority: 'high');
```

- Minimum PHP: 8.0.
- Optional parameters can be skipped, but parameter names become part of a
  public API once consumers use named calls.
- Libraries should document stable parameter names for public methods and
  mark helpers `@internal` when named calls are not supported.

### Constructor promotion

```php
final class UserId
{
    public function __construct(
        public int $value,
        private string $generatedBy = 'system',
    ) {}
}
```

- Minimum PHP: 8.0.
- It combines property declaration and constructor assignment.
- `readonly` in a promoted property requires PHP 8.1; promotion itself does
  not.

### Attributes `#[…]`

```php
#[Route('/users/{id}', methods: ['GET'])]
final class UserController { /* ... */ }
```

- Minimum PHP: 8.0 for native attribute reflection.
- On PHP 7.x, `#[` parses as a comment, so attributes can be inert in a
  `^7.4 || ^8.0` library.
- The framework or tool reading the attributes must also support PHP 8.x;
  otherwise the metadata is dead weight on that framework branch.

## PHP 8.1

### `readonly` properties

```php
final class Point
{
    public function __construct(
        public readonly float $x,
        public readonly float $y,
    ) {}
}
```

- Minimum PHP: 8.1.
- Assignment is enforced once; later writes throw `Error`.
- This pairs well with constructor promotion for value objects.

### Enums

```php
enum Status: string
{
    case Active   = 'active';
    case Disabled = 'disabled';
    case Banned   = 'banned';

    public function isAccessible(): bool
    {
        return match ($this) {
            self::Active                 => true,
            self::Disabled, self::Banned => false,
        };
    }
}

$status = Status::from('active');
$status = Status::tryFrom($input);
```

- Minimum PHP: 8.1.
- Pure enums have no backing type; backed enums use `string` or `int`.
- Cases are singletons and should be compared with `===`.
- For a 7.4-compatible library, use a deliberate enum-class pattern such as
  `myclabs/php-enum` instead of shipping native enum syntax.

### Intersection types

```php
function persist(Countable&Iterator $items): void { /* ... */ }
```

- Minimum PHP: 8.1.
- The value must implement every listed interface.
- Use when no single concrete type expresses the required capabilities.

### `new` in initializers

```php
final class Cache
{
    public function __construct(
        private LoggerInterface $log = new NullLogger(),
    ) {}
}
```

- Minimum PHP: 8.1.
- Default values, attributes, and property or parameter defaults can use
  `new X()` instead of a nullable value plus lazy initialization.

## PHP 8.2

### `readonly` classes

```php
final readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}
```

- Minimum PHP: 8.2.
- It makes every property readonly and disallows dynamic properties.
- Non-readonly classes need the `AllowDynamicProperties` attribute when that
  legacy behavior is intentional.

### Disjunctive Normal Form (DNF) types

```php
function handle((Countable&Iterator)|null $items): void { /* ... */ }
```

- Minimum PHP: 8.2.
- It combines union and intersection types, allowing an optional interface
  intersection that earlier PHP versions could not express.

## PHP 8.3

### Typed class constants

```php
final class Config
{
    public const string DEFAULT_TIMEZONE = 'UTC';
    public const int MAX_RETRIES = 3;
}
```

- Minimum PHP: 8.3.
- Explicit constant types catch incompatible redeclarations.

### Other 8.3 additions

- `#[Override]` requires a method to override a parent method, guarding
  against parent-renaming drift.
- `json_validate()` checks JSON syntax without decoding it.

## Mixed-floor library decision table

For `composer.json` constraint `^7.4 || ^8.0`:

| Feature | Use unconditionally? | Reason |
|---|---|---|
| Attributes `#[…]` | Yes, with framework caveat | PHP 7.4 parses them as comments |
| Every other feature in this catalog | No | PHP 7.4 cannot parse the syntax |

For a `^8.0` floor:

| Feature group | Status |
|---|---|
| match, nullsafe, named args, promotion, attributes | Available |
| readonly, enums, intersection, `new` in initializers | Requires PHP 8.1 |

Raising a package floor is a semver-major decision. Use
`skills/composer-package-hygiene/SKILL.md` for the composer, API, and release
checks.
