---
name: laravel-11-notes
description: Laravel 11.x (March 2024) signature features and the (significant) breaking-change traps from 10 → 11. Use when writing or reviewing code in a Laravel 11 project, or in a package whose composer constraint includes ^11.0. Covers the streamlined app structure (bootstrap/app.php replaces three Kernel/Handler files), the Model casts() method that replaces $casts property, per-second rate limiting, the /up health endpoint, SQLite-as-default, Sanctum 4, and the array-style middleware exception handling. Not for application business logic — load when touching bootstrap/app.php, middleware, casts, or rate limiting, or planning a 10 → 11 upgrade.
---

# Laravel 11 — streamlined structure, casts() method, /up

Released March 2024. PHP 8.2+ floor. **The biggest structural rework
since 5.0** — upgraders should expect a real migration project, not a
drop-in.

---

## Signature features

### Streamlined app structure

Laravel 11 collapses three previously-separate configuration files into
one:

| Before (L ≤10) | After (L 11) |
|---|---|
| `app/Http/Kernel.php` (middleware) | `bootstrap/app.php` (middleware section) |
| `app/Console/Kernel.php` (scheduled tasks) | `bootstrap/app.php` (commands section) |
| `app/Exceptions/Handler.php` (exception handling) | `bootstrap/app.php` (exceptions section) |

```php
// bootstrap/app.php
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web:      __DIR__ . '/../routes/web.php',
        api:      __DIR__ . '/../routes/api.php',
        commands: __DIR__ . '/../routes/console.php',
        health:   '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->web(append: [EnsureUserIsSubscribed::class]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            return response()->json(['error' => 'not found'], 404);
        });
    })->create();
```

**Upgrade trap**: Laravel 10 → 11 upgraders can **keep** the old
three-file layout — Laravel 11 stays compatible with the existing
Laravel 10 structure, so `app/Http/Kernel.php` and the other
Kernel/Handler files keep working. Don't feel pressured to migrate the
structure on the upgrade PR — feature parity comes first; structural
move later.

### Model `casts()` method

```php
final class User extends Authenticatable
{
    // Old:
    protected $casts = ['settings' => 'json', 'email_verified_at' => 'datetime'];

    // New (preferred):
    protected function casts(): array
    {
        return [
            'settings'          => AsArrayObject::class,
            'email_verified_at' => 'datetime',
            'role'              => Role::class,  // enum cast via class FQCN
        ];
    }
}
```

Method-based casts can use parameters (`AsArrayObject::class`,
`AsCollection::class` etc.) and can reference values computed at
runtime. `$casts` property still works.

### Per-second rate limiting

```php
RateLimiter::for('api', fn (Request $req) =>
    Limit::perSecond(10)->by($req->user()?->id ?: $req->ip())
);
```

Adds `perSecond()` alongside existing `perMinute()`, `perHour()`,
`perDay()`. Useful for fine-grained traffic shaping that
per-minute granularity can't catch.

### `/up` health endpoint

Auto-registered when `health: '/up'` is set in `withRouting()`. Returns
200 OK with no body when the app boots successfully. Wire to your
load balancer / kube probe.

### SQLite as default

`composer create-project laravel/laravel` now defaults `DB_CONNECTION=sqlite`
with a file at `database/database.sqlite`. Easier first-run; legacy
projects on MySQL/Postgres aren't affected.

---

## Migration traps from 10

### PHP 8.2 floor

CI matrix shifts:

```yaml
matrix:
  php:     ['8.2', '8.3']
  laravel: [11]
```

### Sanctum 4

`laravel/sanctum: ^4.0` is required. API mostly compatible, but:

- `personal_access_tokens` table got new columns — run `migrate`
- Token expiration semantics tightened — check
  `config/sanctum.php`'s `expiration` value

### Middleware groups can be array-defined

```php
$middleware->web(append: [...]);    // append to web group
$middleware->api(prepend: [...]);   // prepend to api group
$middleware->web(replace: [
    StartSession::class => CustomStartSession::class,
]);
```

If you previously customised `Kernel::$middlewareGroups` heavily, the
new array-style API is more declarative — port carefully.

### Default model property access

Eloquent models default to **eager-loaded relationship checks**
slightly differently in some edge cases. Audit code that does
`$model->relation` access without `with()`.

### Console scheduling moved

```php
// Before: app/Console/Kernel.php :: schedule()
// After: routes/console.php or bootstrap/app.php
Schedule::command('queue:prune-batches')->daily();
```

---

## Notable new packages / tools

- **Pulse** — first-party application performance monitoring
- **Reverb** — first-party WebSocket server
- **Prompts** — Artisan command prompt library (interactive CLI)

These are opt-in `composer require` packages, not bundled.

---

## What's *not* present

For upgraders coming from 12+ (when it ships):

- Streamlined structure is the new normal — no further structural
  reorganisation
- No native enums on most ORM features (still casts-only)

---

## When NOT to Use

Not for application business logic, and not for a project on a different
Laravel major — use the matching `laravel-N-notes`. Package-authoring
concerns (service providers, facades, testbench) live in
`laravel-package-author`.

## Output

Framework-touching code or review notes that match Laravel 11's APIs
(PHP 8.2 floor) — flag any call that actually belongs to a different
major.

## Verification

- Confirm the project runs Laravel 11 (`composer show laravel/framework`).
- Check the PHP 8.2 floor before using version-gated syntax.
- Cross-check cited APIs against the 10 → 11 upgrade guide.

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — testbench for 11.x cells
  (Testbench 9.x maps to Laravel 11)
- `modules/php-8.x/skills/php-8x-features/SKILL.md` — readonly classes
  / DNF types that L11's 8.2 floor permits
- `modules/laravel-10/skills/laravel-10-notes/SKILL.md` — prior version
