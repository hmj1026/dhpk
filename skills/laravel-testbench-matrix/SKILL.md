---
name: laravel-testbench-matrix
description: Orchestra Testbench setup for packages that span multiple Laravel majors. Use when designing a CI matrix for a Laravel package, picking Testbench versions per Laravel cell, troubleshooting "wrong testbench version" install errors, setting up the abstract TestCase base class, registering the package's service provider / facade in tests, provisioning per-cell databases (sqlite memory vs MySQL service), or running --prefer-lowest to catch constraint floor bugs. Sub-skill of laravel-package-author — that skill covers the rest of Laravel package authoring (service providers, facades, publishing, discovery). Load this when the question is specifically about the testbench matrix mechanics.
---

# Orchestra Testbench matrix — per-Laravel-major test cells

A package that supports `^6.0 || ^7.0 || ^8.0 || ^9.0 || ^10.0 || ^11.0`
must prove each cell works. Orchestra Testbench is the framework that
boots a Laravel app inside your package's test suite — but Testbench
itself is version-locked to a specific Laravel major. Picking the wrong
Testbench → install conflict.

> Pair with `skills/laravel-package-author/SKILL.md` for the rest of
> Laravel package authoring (service providers, facades, publishing).

---

## Testbench ↔ Laravel mapping

| Laravel | Testbench | PHP min (Laravel) | Notes |
|---|---|---|---|
| 6.x | 4.x | 7.2 | LTS — supported through 2022 |
| 7.x | 5.x | 7.2.5 | 6-month support |
| 8.x | 6.x | 7.3 | factory class rewrite cell |
| 9.x | 7.x | 8.0 | first PHP-8-required Laravel |
| 10.x | 8.x | 8.1 | typed app skeleton |
| 11.x | 9.x | 8.2 | streamlined structure |

> Rule of thumb: Testbench major = Laravel major − 2 (until Laravel 9
> where they re-aligned). Always confirm via Testbench's `composer.json`
> for the cell — the mapping above is current as of dhpk 0.2.

---

## Per-cell composer install

The CI matrix shouldn't try to satisfy *every* Testbench + Laravel
constraint simultaneously in one `composer.lock`. Install per-cell:

```yaml
# .github/workflows/tests.yml
name: tests
on: [push, pull_request]
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        php:     ['7.4', '8.0', '8.1', '8.2', '8.3']
        laravel: [6, 7, 8, 9, 10, 11]
        include:
          - { laravel: 6,  testbench: '^4.0' }
          - { laravel: 7,  testbench: '^5.0' }
          - { laravel: 8,  testbench: '^6.0' }
          - { laravel: 9,  testbench: '^7.0' }
          - { laravel: 10, testbench: '^8.0' }
          - { laravel: 11, testbench: '^9.0' }
        exclude:
          # PHP version × Laravel min-PHP excludes (see table above)
          - { php: '7.4', laravel: 9 }
          - { php: '7.4', laravel: 10 }
          - { php: '7.4', laravel: 11 }
          - { php: '8.0', laravel: 10 }
          - { php: '8.0', laravel: 11 }
          - { php: '8.1', laravel: 11 }
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php }}
          coverage: none
      - name: Pin Laravel + Testbench
        run: |
          composer require \
            "laravel/framework:^${{ matrix.laravel }}" \
            "orchestra/testbench:${{ matrix.testbench }}" \
            --no-interaction --no-update
      - name: Install
        run: composer update --prefer-dist --no-interaction
      - name: Test
        run: vendor/bin/phpunit
```

**Key technique**: `composer require --no-update` pins the cell-specific
versions in `composer.json`, then `composer update` resolves a fresh
dependency graph for *that cell only*. No leftover lock-file state from
other cells leaks in.

---

## Abstract TestCase base class

```php
// tests/TestCase.php
namespace Devkit\Tests;

use Orchestra\Testbench\TestCase as OrchestraTestCase;
use Devkit\Laravel\DevkitServiceProvider;
use Devkit\Laravel\Ui\Facades\Trail;

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
        // Per-cell config overrides go here — DB driver, mail driver, etc.
        $app['config']->set('database.default', 'testing');
        $app['config']->set('database.connections.testing', [
            'driver'   => 'sqlite',
            'database' => ':memory:',
            'prefix'   => '',
        ]);
    }

    protected function defineDatabaseMigrations(): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
    }
}
```

Every test class extends this — `extends \Devkit\Tests\TestCase`. The
abstract base captures every Laravel-version-stable bit so cell-specific
divergence stays in the test methods.

> **Laravel 6/7 trap**: `defineDatabaseMigrations()` was added in
> Testbench 6.x (Laravel 8). For Laravel 6/7 cells, override `setUp()`
> and run `$this->loadMigrationsFrom(...)` directly. Or use a
> conditional shim:
> ```php
> protected function setUp(): void {
>     parent::setUp();
>     if (! method_exists($this, 'defineDatabaseMigrations')) {
>         $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');
>     }
> }
> ```

---

## Database provisioning per cell

Three common patterns, picked by package needs:

### Pattern 1 — SQLite in-memory (recommended default)

Fast, isolated, zero infrastructure. The `defineEnvironment` shown
above is the setup. **Limitation**: SQLite lacks some MySQL/PostgreSQL
features (full-text search, JSON column ops on older SQLite, fancy
constraints). If your package uses those, this won't catch
production-only bugs.

### Pattern 2 — MySQL service container (production-realistic)

```yaml
services:
  mysql:
    image: mysql:8
    env:
      MYSQL_ALLOW_EMPTY_PASSWORD: 'yes'
      MYSQL_DATABASE: testing
    ports: ['3306:3306']
    options: >-
      --health-cmd="mysqladmin ping"
      --health-interval=10s
      --health-timeout=5s
      --health-retries=3
```

`defineEnvironment` switches to:

```php
$app['config']->set('database.connections.testing', [
    'driver'   => 'mysql',
    'host'     => '127.0.0.1',
    'port'     => 3306,
    'database' => 'testing',
    'username' => 'root',
    'password' => '',
    'charset'  => 'utf8mb4',
]);
```

CI matrix balloons (MySQL service per job), but you catch real DB
bugs. Use for packages with non-trivial migration / query code.

### Pattern 3 — Both — split test suites

```xml
<!-- phpunit.xml -->
<testsuites>
    <testsuite name="unit">      <directory>tests/Unit</directory></testsuite>
    <testsuite name="sqlite">    <directory>tests/Integration/Sqlite</directory></testsuite>
    <testsuite name="mysql">     <directory>tests/Integration/Mysql</directory></testsuite>
</testsuites>
```

CI runs sqlite suite on every cell, mysql suite on a representative
cell (e.g. PHP 8.2 × Laravel 11) only. Catches portability bugs
without N×M cell cost.

---

## `--prefer-lowest` cell — catch constraint floor bugs

Add one extra matrix cell that uses the **lowest** version of every
constraint:

```yaml
- { php: '7.4', laravel: 6, testbench: '^4.0', composer-flags: '--prefer-lowest --prefer-stable' }
```

`composer update --prefer-lowest --prefer-stable` installs the floor
of every constraint in `composer.json` and `require-dev`. This catches:

- "I wrote `^2.0` but accidentally used a method only available in
  2.5+"
- "My constraint says `^9.0` but I'm calling a Laravel 9.40+ method"
- Dependency conflicts that only manifest at the floor

Without this cell, you only test against whatever the resolver picked
at the time of `composer install` — usually the latest of every
constraint.

---

## Package discovery in test bootstrap

Orchestra Testbench handles service provider registration via
`getPackageProviders()`. But `composer install` in CI doesn't trigger
Laravel's `package:discover` for your local package — so
`extra.laravel.providers` and `extra.laravel.aliases` from your
package's `composer.json` are **not validated** by `vendor/bin/phpunit`
alone.

The honest validation requires installing the package as a real
consumer would (see `skills/laravel-package-author/SKILL.md` §
"Package discovery validation"). Add a separate CI job for this:

```yaml
discovery-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: |
        cd /tmp
        composer create-project laravel/laravel test-app --no-interaction
        cd test-app
        composer config repositories.dev path "$GITHUB_WORKSPACE"
        composer require your-vendor/your-package:dev-main \
          --no-interaction
        php artisan package:discover --ansi
```

A red here means your `composer.json`'s `extra.laravel` block is
malformed — invisible until a consumer installs.

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| "Your requirements could not be resolved" on `composer update` | Testbench major doesn't match Laravel major | Re-check the mapping table |
| Tests pass locally but fail in CI on Laravel 6 cell | Used Testbench 6.x feature (`defineDatabaseMigrations`) | Shim with `method_exists` check (see above) |
| `Class 'X' not found` only on prefer-lowest cell | Used a method/class added in a later minor | Tighten constraint floor in `composer.json` |
| `SQLSTATE[HY000]: General error: 1 no such table` | Migration not loaded; `defineDatabaseMigrations` not overridden | Add the override in base TestCase |
| Tests work in `vendor/bin/phpunit` but `package:discover` errors | Provider FQCN typo in `composer.json:extra.laravel.providers` | Run discovery-check job locally |

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — service provider design,
  facade patterns, publishing, package discovery
- `modules/laravel-N/skills/laravel-N-notes/SKILL.md` (each major) —
  per-version Testbench feature availability
- `skills/composer-package-hygiene/SKILL.md` — constraint hygiene that
  the prefer-lowest cell exercises
