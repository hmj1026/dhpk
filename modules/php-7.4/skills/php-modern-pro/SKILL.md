---
name: php-modern-pro
description: PHP 7.4 → 8.x modern idioms and dual-version-floor library packaging. Use when writing or reviewing PHP that targets ≥7.4 (typed properties, arrow fns, null-coalesce assignment, spread, numeric separators) or a composer package whose constraint spans 7.x→8.x, where 8.0+ features (match, nullsafe, named args, attributes, readonly, enums) must be used conditionally. Also covers polyfill / class_alias / autoload-time runtime-detection for deps spanning multiple majors (Monolog 2/3, Laravel 6→11, Flysystem 1→3). Counterpart to php-pro (5.6 baseline, forbids ≥7.0 syntax). Not for everyday business logic — load when designing a public API, choosing a 7.4 vs 8.x idiom, writing a version-conditional shim, or reviewing composer.json constraints.
---

# PHP modern pro — 7.4 baseline + dual-floor library design

This skill is the **counterpart to `php-pro`** (which assumes PHP 5.6 and
forbids ≥7.0 syntax). Load it when working on code that targets PHP 7.4
or a library that intentionally spans 7.x→8.x.

`modules/php-7.4/references/static-checks.md` is the always-loaded index
into the tooling tier (php-cs-fixer + phpstan/psalm). This skill is the
**language & packaging companion** — load when designing API shape, picking
idioms, or reviewing composer constraints.

> Rule of thumb: `php-pro` is for legacy monoliths frozen at 5.6.
> `php-modern-pro` is for greenfield 7.4+ code and any composer package
> that ships against a version range.

---

## 7.4 baseline — prefer these idioms

### Typed properties

```php
final class UserId
{
    private int $value;

    public function __construct(int $value)
    {
        $this->value = $value;
    }
}
```

- Always type properties. Drop PHPDoc `@var` once the property is typed
  unless the type is a *narrowed* version of the declared type (e.g.
  `array<string, User>` on top of `array`).
- Prefer `final` on value objects and on classes that aren't designed for
  inheritance. Subclasses you can't anticipate are subclasses you'll regret.

### Arrow functions

```php
$ids = array_map(fn(User $u): int => $u->id(), $users);
```

- Use for one-expression callbacks. They auto-capture by value.
- Don't reach for `function (…) use (…) {}` unless you need a multi-line
  body. Arrow fns make `array_*` and `Collection::map/filter` callsites
  read top-to-bottom.

### Null-coalesce assignment

```php
$config['timeout'] ??= 30;
```

- Replaces `$config['timeout'] = $config['timeout'] ?? 30;`.
- Works on array offsets, object properties, and plain variables.

### Spread in arrays

```php
$base = ['a', 'b'];
$all  = [...$base, 'c', 'd'];
```

- Replaces `array_merge` for plain numeric arrays. **Not safe for
  string-keyed arrays in 7.4** — `string` keys throw; only numeric keys
  spread. (PHP 8.1+ lifts this restriction.)

### Numeric literal separator

```php
$retryBackoffMs = 1_500;
$maxBytes       = 10_485_760;
```

- Use for magnitude readability on any literal ≥4 digits.

---

## 8.x features — conditional / library-author rules

For **applications** pinned to PHP 8.0+, use these freely. For **libraries**
whose `composer.json` accepts `^7.4 || ^8.0`, treat them as conditional:

| Feature | Min PHP | Library-author rule |
|---|---|---|
| `match` expression | 8.0 | Use only when the entire constraint floor is ≥8.0. Otherwise fall back to `switch` |
| Nullsafe `?->` | 8.0 | Same — `?->` syntax is a hard parse error on 7.4 |
| Named arguments | 8.0 | Same — additionally, **don't rename internal parameters** of public API once tagged, since named-arg callers depend on the names |
| Constructor promotion | 8.0 | Same — useful but parses as syntax error on 7.4 |
| Attributes (`#[…]`) | 8.0 | Parses as a comment on 7.x (the `#[` prefix is a comment) so they're *forward-compatible* — you can ship them in a 7.4 library; they're inert on 7.x runtimes. Useful for opt-in framework hooks |
| `readonly` properties | 8.1 | Use only when floor is ≥8.1 |
| Enums | 8.1 | Same |
| Intersection types | 8.1 | Same |
| Pure intersection in return | 8.1 | Same |

### Library-author guardrail

When a feature's min-PHP exceeds your declared floor, **the code is a
syntax error on the older runtime — not a runtime feature gap**. There's no
"polyfill" for syntax. You have three choices:

1. **Bump the floor** in `composer.json` — narrows your audience but
   unlocks the syntax.
2. **Use the older idiom** unconditionally — clearer than runtime branching.
3. **Quarantine the newer syntax behind a runtime version check** in a
   *separate file* loaded conditionally via autoload `files` + a guard
   (see polyfill pattern below).

Option 2 is almost always the right answer for libraries.

---

## Dual-version-floor packaging patterns

When a library's runtime spans two majors of a dependency (Monolog 2/3,
Laravel 6→11, Flysystem 1→3), three patterns cover almost every case:

### 1. Autoload-time `class_alias` dispatch

For dependencies whose classes were renamed or moved. The composer
autoload `files` entry runs once per request; pick the concrete and alias
it to a stable name your code uses.

```php
// src/Logging/polyfills.php  (registered in composer.json "autoload.files")
namespace Devkit\Logging;

if (class_exists(\Monolog\LogRecord::class)) {
    class_alias(GoogleChatHandlerMonolog3::class, GoogleChatHandler::class);
} else {
    class_alias(GoogleChatHandlerMonolog2::class, GoogleChatHandler::class);
}
```

Caller code references `Devkit\Logging\GoogleChatHandler` — the alias
resolves to whichever concrete exists.

**Trap**: tests must exercise *both* paths. CI matrix needs cells for
each major version of the polyfilled dependency, or one of the branches
silently rots.

### 2. Trait-based feature shimming

For methods that exist in newer versions but not older. Define a trait
with the shim; conditionally include it.

```php
trait CompatStr
{
    public static function contains(string $haystack, string $needle): bool
    {
        if (\function_exists('str_contains')) {
            return \str_contains($haystack, $needle);
        }
        return $needle === '' || \strpos($haystack, $needle) !== false;
    }
}
```

`function_exists` checks are cheap (one hash lookup); the polyfill is OK
to inline rather than gate at autoload time.

### 3. Version-conditional service provider registration

For Laravel packages spanning 6→11. The service provider's `register()`
checks `app()->version()` and binds the version-correct concrete:

```php
public function register(): void
{
    $this->app->singleton(MailQueue::class, function ($app) {
        return version_compare($app->version(), '8.0.0', '>=')
            ? new MailQueueLaravel8Plus($app['queue'])
            : new MailQueueLaravel67($app['queue']);
    });
}
```

Pair with version-specific test cells in CI. Orchestra Testbench's
`composer.json` lets you pin Laravel per cell.

---

## composer.json hygiene for libraries

Surface-area decisions that matter for downstream consumers:

| Concern | Practice |
|---|---|
| PHP constraint | `"php": "^7.4 \|\| ^8.0"` — anchored at the lowest *supported* version, not the lowest *building* version. Use `^X` not `>=X` so you opt into majors deliberately |
| Dependency constraints | Use ORed unions for cross-major support (`"monolog/monolog": "^2.9 \|\| ^3.0"`). Never `>=2.9` — that auto-opts-into a future 4.0 |
| Autoload `files` | Use sparingly. Each entry runs on every request. Polyfills + helper-function bootstraps only |
| Autoload `psr-4` | One namespace → one root. No `psr-0` in new packages |
| Suggest vs require | `suggest` for optional features (AWS SDK for signed Elasticsearch). Require only what every consumer needs |
| `extra.laravel.providers` | Must point at a class that exists with all declared dependency constraints. CI should validate via `php artisan package:discover` on a fresh install |
| `extra.laravel.aliases` | One per public facade. The facade class must extend `Illuminate\Support\Facades\Facade` and implement `getFacadeAccessor()` |
| `minimum-stability` | `stable` for libraries. Never ship a beta dependency in a stable package |

---

## When to load the sibling pieces

| When… | Where to look |
|---|---|
| You need to know which static-check tool to add or what override env vars exist | `modules/php-7.4/references/static-checks.md` |
| You're working on legacy 5.6 code with no plans to upgrade | `modules/php-5.6/skills/php-pro/SKILL.md` |
| You're writing tests for a package that supports a Laravel range | (planned) `modules/laravel-N/skills/laravel-N-dev/` — until then, the existing `php-pro` skill has Laravel 10 / 11-12 reference docs |
| You're shipping a release and need to validate composer constraints / API surface | (planned) `skills/composer-package-hygiene/SKILL.md` |
