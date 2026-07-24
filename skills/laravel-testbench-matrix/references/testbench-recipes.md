# Testbench matrix recipes

Load the recipe needed for the current matrix branch. The parent skill keeps the
per-cell workflow and verification gate.

## Mapping and per-cell install

| Laravel | Testbench | Laravel PHP floor |
|---|---|---|
| 6.x | 4.x | 7.2 |
| 7.x | 5.x | 7.2.5 |
| 8.x | 6.x | 7.3 |
| 9.x | 7.x | 8.0 |
| 10.x | 8.x | 8.1 |
| 11.x | 9.x | 8.2 |

Pin each cell independently; never use one shared lock graph for all Laravel majors:

```yaml
strategy:
  fail-fast: false
  matrix:
    php: ['7.4', '8.0', '8.1', '8.2', '8.3']
    laravel: [6, 7, 8, 9, 10, 11]
    include:
      - { laravel: 6, testbench: '^4.0' }
      - { laravel: 7, testbench: '^5.0' }
      - { laravel: 8, testbench: '^6.0' }
      - { laravel: 9, testbench: '^7.0' }
      - { laravel: 10, testbench: '^8.0' }
      - { laravel: 11, testbench: '^9.0' }
```

Exclude PHP × Laravel combinations below the Laravel floor, then run:

```bash
composer require \
  "laravel/framework:^${LARAVEL_MAJOR}" \
  "orchestra/testbench:${TESTBENCH_VERSION}" \
  --no-interaction --no-update
composer update --prefer-dist --no-interaction
vendor/bin/phpunit
```

`composer require --no-update` creates the cell-specific manifest before the resolver
runs, so another matrix cell cannot leak lock state into this one.

## Abstract TestCase

Register the package provider and facade in the shared base class, and put per-cell
configuration in `defineEnvironment()`:

```php
abstract class TestCase extends OrchestraTestCase
{
    protected function getPackageProviders($app): array
    {
        return [DevkitServiceProvider::class];
    }

    protected function getPackageAliases($app): array
    {
        return ['Trail' => Trail::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
        ]);
    }
}
```

For Laravel 6/7, `defineDatabaseMigrations()` is not available in the same way as
newer Testbench versions. Override `setUp()` and call `loadMigrationsFrom()` directly,
or guard the method with `method_exists()`.

## Database choices

- SQLite in-memory is the default: fast, isolated, and infrastructure-free; it does
  not reproduce every MySQL/PostgreSQL feature.
- A MySQL service catches production-specific query and migration behavior but costs a
  service per job.
- A split suite runs SQLite on every cell and a MySQL suite on one representative cell.

## Floor and discovery cells

Add a `--prefer-lowest --prefer-stable` cell to catch methods newer than declared
constraints. Also run a real-consumer `package:discover` job; Testbench alone does not
validate `extra.laravel.providers` and `extra.laravel.aliases`:

```bash
cd /tmp
composer create-project laravel/laravel test-app --no-interaction
cd test-app
composer config repositories.dev path "$PACKAGE_ROOT"
composer require your-vendor/your-package:dev-main --no-interaction
php artisan package:discover --ansi
```

## Failure map

| Symptom | Likely cause | Check |
|---|---|---|
| Resolver conflict | Testbench major mismatches Laravel | Re-check the mapping |
| Laravel 6/7 cell fails on migration setup | Newer `defineDatabaseMigrations()` API used | Use the compatibility shim |
| Only floor cell fails | Method exceeds a declared dependency floor | Tighten the constraint or branch |
| No table exists | Migrations not loaded | Add the base TestCase migration hook |
| Discovery fails but tests pass | Provider/alias metadata is wrong | Run the consumer discovery job |
