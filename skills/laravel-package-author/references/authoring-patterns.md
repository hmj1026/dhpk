# Laravel package authoring patterns

Load only the branch needed for the package decision. The parent skill owns the
workflow and verification gate; this reference contains the framework-specific
recipes.

## Service provider design

Keep `register()` for container bindings and configuration merging. Keep `boot()` for
work that depends on other providers: publishing, migrations, routes, views, and
assets.

```php
final class DevkitServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(Gateway::class, function ($app) {
            return new Gateway($app['config']->get('devkit.timeout', 30));
        });
        $this->mergeConfigFrom(__DIR__ . '/../config/devkit.php', 'devkit');
    }

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

Do not call `config()` or touch the database in `register()` before the relevant
provider has booted. Use `$app['config']->get()` for a binding-time default or defer
the work to `boot()`.

For rarely used bindings, implement `DeferrableProvider`, keep the provider limited to
`register()`, and list every lazily provided class in `provides()`. Pair each deferred
binding with a test that resolves it.

## Version-conditional bindings

For a package spanning Laravel majors, branch on the framework major version and pair
each branch with a Testbench cell:

```php
$version = (int) explode('.', $app->version())[0];
return $version >= 8
    ? new MailQueueLaravel8Plus($app['queue'])
    : new MailQueueLaravel67($app['queue']);
```

Do not branch on `class_exists()` for Laravel internals; classes move between minors.

## Facades and discovery metadata

The facade accessor must equal the service-provider binding key:

```php
final class Trail extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'devkit.trail';
    }
}
```

Register the provider and alias in `composer.json`:

```json
{
  "extra": {
    "laravel": {
      "providers": ["Devkit\\Laravel\\DevkitServiceProvider"],
      "aliases": { "Trail": "Devkit\\Laravel\\Ui\\Facades\\Trail" }
    }
  }
}
```

Call one method through the facade in CI. Add `@method` IDE annotations only when
they are kept in sync with the underlying public methods. Document alias collisions;
consumers may disable an alias in their application configuration.

## Testbench matrix boundary

For a multi-major package, use one Testbench cell per Laravel major and exclude PHP
versions below each Laravel floor. The current rough mapping is Laravel 6→Testbench
4, 7→5, 8→6, 9→7, 10→8, and 11→9. Confirm the exact cell constraint from the
Testbench package metadata; the matrix mechanics live in
`skills/laravel-testbench-matrix/SKILL.md`.

## Publishing recipes

Give each published artifact a unique tag:

```php
$this->publishes([
    __DIR__ . '/../config/devkit.php' => config_path('devkit.php'),
], 'devkit-config');
```

Use separate tags for config, views, assets, and migrations. Choose deliberately
between `loadMigrationsFrom()` (automatic execution on migrate) and publishing
migrations for consumers to inspect and own. Test both the provider path and the
selected publish tags.

## Consumer discovery

Validate the package as a real consumer, not only from its own repository:

```bash
composer validate --strict
cd /tmp && composer create-project laravel/laravel test-app
cd test-app
composer config repositories.dev path /path/to/package
composer require your-vendor/your-package:dev-main
php artisan package:discover --ansi
php artisan tinker --execute="echo Trail::class;"
```

This catches provider FQCN, alias, autoload, and facade-accessor drift.

## Laravel-specific compatibility surface

Treat these published names as breaking when changed: route names, config keys,
migration filenames, model FQCNs, published view paths, facade aliases, provider FQCNs,
and required keys in published config. Prefer adding new artifacts over mutating old
ones after release.
