# Laravel 10 Version Notes

## Scope

Load this reference only after `references/laravel-version-checks.md` confirms Laravel 10.x.

Use it for version-sensitive work on:

- `bootstrap/app.php`
- `config/app.php`
- `app/Http/Kernel.php`
- `app/Exceptions/Handler.php`
- auth / queue / mail / broadcast package wiring
- PHPUnit / Pest bootstrap and framework testing helpers

## Expected Skeleton

- `bootstrap/app.php` creates the application instance; do not assume fluent `Application::configure(...)`.
- Service providers are typically registered in `config/app.php`.
- Middleware aliases, groups, and global middleware are typically managed in `app/Http/Kernel.php`.
- Route loading commonly flows through `routes/*.php` and `RouteServiceProvider`.
- Exception handling commonly lives in `app/Exceptions/Handler.php`.

## Load First

1. `composer.json` and `composer.lock`
2. `bootstrap/app.php`
3. `config/app.php`
4. `app/Http/Kernel.php`
5. `app/Exceptions/Handler.php`
6. `tests/TestCase.php`, `tests/Pest.php`, and `phpunit.xml*` when the task touches testing

## Editing Rules

- Do not propose Laravel 11-12 style `withMiddleware(...)` or `withExceptions(...)` unless the repository already added a custom fluent bootstrap layer.
- Do not move service-provider registration to `bootstrap/providers.php` in a Laravel 10 app.
- When package setup examples differ from the repository, prefer the repository's installed package version over generic examples.

## Official Basis

Based on official Laravel 10 documentation queried through Context7.
