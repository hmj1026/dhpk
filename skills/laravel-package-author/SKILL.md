---
name: laravel-package-author
description: Laravel package author concerns that apply across Laravel versions — service provider design (deferred vs immediate, when to bind in register vs boot), facade patterns (accessor binding, IDE helpers), version-conditional service binding for packages spanning multiple Laravel majors, Orchestra Testbench setup and per-cell version pinning, publishing migrations / config / assets / views, package discovery validation, and Laravel's package-specific BC sensitivities. Use when designing the public surface of a Laravel package, writing the service provider, picking a facade name, setting up the testbench matrix, troubleshooting auto-discovery, or releasing a package version that supports a Laravel range. Framework-agnostic version-wise — pair with the matching laravel-N module for version-specific deprecations and new APIs. Not for application code — load only when working on code distributed as a Laravel package.
---

# Laravel package author — cross-cutting patterns

This skill captures concerns that apply to *any* Laravel package
regardless of Laravel version. Pair with the matching `laravel-N` module
(`laravel-6` → `laravel-11`) for version-specific deprecations and new
APIs, and with `composer-package-hygiene` for the publish-side flow.

> Mental model: a Laravel package's surface is **wider** than a plain
> PHP package's — you ship not just classes but service providers,
> facades, config files, migrations, views, and routes. Each is a
> separate contract to maintain.

---

## Service provider design

### Register vs boot

```php
final class DevkitServiceProvider extends ServiceProvider
{
    // register(): bind into the container ONLY. No facade calls, no DB.
    public function register(): void
    {
        $this->app->singleton(Gateway::class, function ($app) {
            return new Gateway($app['config']->get('devkit.timeout', 30));
        });

        $this->mergeConfigFrom(__DIR__ . '/../config/devkit.php', 'devkit');
    }

    // boot(): everything that needs other providers to have registered.
    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../config/devkit.php' => config_path('devkit.php'),
        ], 'devkit-config');

        $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
        $this->loadRoutesFrom(__DIR__ . '/../routes/devkit.php');
    }
}
```

Trap: doing `config('devkit.x')` inside `register()` will silently return
`null` because `ConfigServiceProvider` may not have booted yet. Always
use `$app['config']->get(...)` if you must read config in `register()`,
and prefer to defer config-dependent work to `boot()`.

### Deferred providers

For packages whose bindings are rarely accessed:

```php
final class DevkitServiceProvider extends ServiceProvider implements DeferrableProvider
{
    public function provides(): array
    {
        return [Gateway::class, FileUploader::class];
    }
    // ... register() only — boot() doesn't run for deferred providers.
}
```

The container only instantiates the provider when one of the `provides()`
classes is resolved. Useful for packages with expensive `register()`
(reading large config files, opening connections).

> **Laravel 11 note**: `DeferrableProvider` still exists and is
> documented in 11.x — deferral remains valid for packages with an
> expensive `register()`. (Laravel 11's default skeleton ships fewer
> providers, but the deferral mechanism itself is unchanged.)

---

## Version-conditional binding

For packages spanning Laravel majors (`^6.0 || ^7.0 || ^8.0 || ^9.0 || ^10.0 || ^11.0`),
some APIs change between versions. Branch in `register()`:

```php
public function register(): void
{
    $this->app->singleton(MailQueue::class, function ($app) {
        $version = (int) explode('.', $app->version())[0];
        return $version >= 8
            ? new MailQueueLaravel8Plus($app['queue'])
            : new MailQueueLaravel67($app['queue']);
    });
}
```

Anti-pattern: branching on `class_exists()` of a Laravel internal class.
Laravel's internals move freely between minors; rely on the framework
version string, not the existence of a specific class.

Pair each branch with a test cell in the Orchestra Testbench matrix
(see below) — without per-cell tests, one branch silently rots.

---

## Facade design

```php
// src/Facades/Trail.php
namespace Devkit\Laravel\Ui\Facades;

use Illuminate\Support\Facades\Facade;

final class Trail extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'devkit.trail';  // must match service provider binding key
    }
}
```

Registered in `composer.json`:

```json
{
  "extra": {
    "laravel": {
      "providers": ["Devkit\\Laravel\\DevkitServiceProvider"],
      "aliases":   { "Trail": "Devkit\\Laravel\\Ui\\Facades\\Trail" }
    }
  }
}
```

Three failure modes:

1. **Accessor mismatch** — facade returns `devkit.trail`, provider binds
   `devkit-trail`. Symptom: "Class 'devkit.trail' not found" at runtime,
   invisible until someone calls `Trail::method()`. CI test should call
   one method through the facade.
2. **Provider FQCN wrong** in composer.json — `composer install` errors
   on package discovery. Catch with `php artisan package:discover` on a
   fresh install in CI.
3. **Alias clashes with userland** — user's own `App\Facades\Trail`
   collides with your `Trail` alias. There's no fix at package side;
   document that consumers can disable the alias via
   `'aliases' => [ 'Trail' => null ]` in `app.php`.

### IDE helper generation

For packages that want IDE autocomplete on the facade:

```php
/**
 * @method static string current()
 * @method static void clear()
 * @see \Devkit\Laravel\Ui\Trail
 */
final class Trail extends Facade { /* ... */ }
```

The `@method` tags drive PhpStorm / VSCode autocomplete. Keep them in
sync with the underlying class's public methods — add a CI check that
greps for missing/extra `@method` entries.

---

## Orchestra Testbench matrix

For a package spanning Laravel majors, you need one test cell per
major × per PHP cell. Minimal setup:

```yaml
# .github/workflows/tests.yml
strategy:
  fail-fast: false
  matrix:
    php:        ['7.4', '8.0', '8.1', '8.2']
    laravel:    [6, 7, 8, 9, 10, 11]
    exclude:
      - { php: '7.4', laravel: 9  }   # Laravel 9 requires PHP 8.0+
      - { php: '7.4', laravel: 10 }
      - { php: '7.4', laravel: 11 }
      - { php: '8.0', laravel: 10 }   # Laravel 10 requires PHP 8.1+
      - { php: '8.0', laravel: 11 }
      - { php: '8.1', laravel: 11 }   # Laravel 11 requires PHP 8.2+
```

Test setup uses Testbench's `TestCase`:

```php
abstract class TestCase extends \Orchestra\Testbench\TestCase
{
    protected function getPackageProviders($app): array
    {
        return [DevkitServiceProvider::class];
    }

    protected function getPackageAliases($app): array
    {
        return ['Trail' => Trail::class];
    }
}
```

Pin Testbench per Laravel cell via composer:

```bash
composer require --dev "orchestra/testbench:${TESTBENCH_VERSION}"
```

Testbench → Laravel mapping (rough): 4.x → L6, 5.x → L7, 6.x → L8, 7.x → L9, 8.x → L10, 9.x → L11.

---

## Publishing recipes

Each `publishes()` call needs a unique tag so consumers can publish
selectively:

```php
public function boot(): void
{
    $this->publishes([
        __DIR__ . '/../config/devkit.php' => config_path('devkit.php'),
    ], 'devkit-config');

    $this->publishes([
        __DIR__ . '/../resources/views' => resource_path('views/vendor/devkit'),
    ], 'devkit-views');

    $this->publishes([
        __DIR__ . '/../public' => public_path('vendor/devkit'),
    ], 'devkit-assets');

    $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
}
```

Consumers run:

```bash
php artisan vendor:publish --provider="Devkit\\Laravel\\DevkitServiceProvider"
# or selectively:
php artisan vendor:publish --tag=devkit-config
```

**Migrations trap**: `loadMigrationsFrom` auto-runs the migrations on
`migrate`. If the package needs a migration but you don't want
auto-run, use `publishes(['migrations'])` and let the consumer copy
them into their own migrations dir. Auto-run is convenient but
violates the consumer's expectation of seeing every migration in
their repo.

---

## Package discovery validation (CI must check)

```bash
# 1. Validate composer.json declares the provider correctly
composer validate --strict

# 2. Install the package as a real consumer would and ensure discovery runs
cd /tmp && composer create-project laravel/laravel test-app
cd test-app && composer config repositories.dev path /path/to/your/package
composer require your-vendor/your-package:dev-main

# 3. The next line is where bad providers/aliases fail
php artisan package:discover --ansi

# 4. Smoke-test facade
php artisan tinker --execute="echo Trail::class;"
```

Add a CI job that runs steps 1–4. Many packages ship broken auto-discovery
for months because the maintainer always tests via `composer install` in
the package's own dir, never as a real consumer.

---

## Laravel-specific BC sensitivities

Things that count as breaking for a Laravel package even though they'd be
fine in a plain PHP package:

| Change | Why breaking |
|---|---|
| Rename a route name | `route('my.route')` calls in consumer code break |
| Rename a config key | `config('package.key')` calls break |
| Change a migration file name (after release) | Consumers who ran the old name get duplicate-migration errors |
| Rename a model class | Eloquent relationship strings (`hasMany('Pkg\\Model')`) break |
| Rename a published view path | Consumer overrides in `views/vendor/pkg/` break |
| Change a facade alias name | `Trail::method()` calls break |
| Change service-provider FQCN | `--provider=` flags in consumer scripts break |
| Add a required argument to a published config file | Consumer's old config file lacks the key |

For each of these, treat the change as major. For published artifacts
specifically, prefer **adding new** (new config key, new migration) over
**modifying existing**.

---

## When NOT to Use

- Application code — controllers, jobs, Eloquent models that live in one
  app and ship to no one. Service-provider and facade discipline here is
  about *distributing* code, not consuming Laravel.
- Version-specific deprecations or new APIs for a single Laravel major —
  use the matching `laravel-N` module (`laravel-6` → `laravel-11`).
- The publish-side release flow (semver, tag/changelog sync, autoload
  hygiene) — that is `composer-package-hygiene`.
- Deep testbench-matrix mechanics (per-cell Testbench pins, sqlite vs
  MySQL provisioning, `--prefer-lowest`) — drill into the
  `laravel-testbench-matrix` sub-skill.

## Output

Consulting this skill should yield one of:

- A **service provider** with the register/boot split correct, deferral
  decided per Laravel major, and version-conditional bindings each paired
  with a test cell.
- A **facade** whose accessor matches the provider binding, registered in
  `extra.laravel.aliases`, with `@method` IDE hints in sync.
- A **publishing setup** with per-artifact tags and a deliberate
  auto-run-vs-publish decision for migrations.
- A **discovery-validated** package — `package:discover` proven green
  against a real consumer install, not just the package's own dir.

## Verification

- [ ] `composer validate --strict` passes.
- [ ] `php artisan package:discover --ansi` succeeds on a fresh consumer
      install (not just inside the package repo).
- [ ] Facade smoke test — one method called through the alias, no
      `Class '...' not found`.
- [ ] Each version-conditional branch has a Testbench cell that enters it.
- [ ] Every published artifact (config, views, assets, migrations) has a
      unique `--tag` and publishes cleanly.

---

## Cross-references

- `modules/laravel-N/skills/laravel-N-notes/SKILL.md` — version-specific
  deprecations and signature additions for each major
- `skills/composer-package-hygiene/SKILL.md` — semver bumps, release
  flow, public API surface tools
- `modules/php-7.4/skills/php-modern-pro/SKILL.md` — dual-version-floor
  PHP idiom guidance (relevant when the package also spans PHP majors)
