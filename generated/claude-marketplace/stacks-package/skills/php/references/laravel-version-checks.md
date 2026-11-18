# Laravel Version Routing Reference

## Contents

- Scope
- Version Gate
- Routing Decision
- Version-Specific Risk Map
- Repository Checks Before Editing
- Skip Rule
- Official Basis

## Scope

Load this reference only after Laravel is positively detected. Skip it entirely for non-Laravel projects.

Use it when the task touches version-sensitive areas such as:

- `bootstrap/app.php` or application bootstrapping
- service-provider registration or container wiring
- middleware or exception registration
- auth, mail, queue, broadcasting, or scheduling wiring
- PHPUnit/Pest setup, framework testing helpers, or parallel testing
- package compatibility for Laravel-coupled packages

## Version Gate

Confirm the actual runtime before proposing version-sensitive code:

1. Read `composer.json` for `php`, `laravel/framework`, and `illuminate/*` constraints.
2. If the constraint is broad or indirect, read `composer.lock` for the resolved version.
3. Record the detected Laravel major version and PHP version in your reasoning before suggesting changes.
4. Inspect Laravel-coupled packages in `require` and `require-dev` when the task touches package behavior.

## Routing Decision

- If the task is ordinary controller, request, action, service, model, resource, or CRUD work, use `references/laravel-projects.md` and follow repository conventions.
- If the task touches bootstrapping, middleware, auth, testing infrastructure, providers, or package wiring, treat version confirmation as mandatory.
- If the resolved major version is `10.x`, load `references/laravel-v10.md`.
- If the resolved major version is `11.x` or `12.x`, load `references/laravel-v11-v12.md`.
- If the version cannot be confirmed, stay inside repository-proven patterns instead of inventing upgrade-specific code.

## Version-Specific Risk Map

| Concern | Laravel 10.x | Laravel 11-12 |
|---------|--------------|---------------|
| Application bootstrap | `bootstrap/app.php` creates the app; do not assume fluent `Application::configure(...)` | `bootstrap/app.php` usually uses `Application::configure(...)` |
| Service providers | Check `config/app.php` provider registration | Check `bootstrap/providers.php` first |
| Middleware aliases / groups | Check `app/Http/Kernel.php` | Check `bootstrap/app.php` via `withMiddleware(...)` |
| Exception handling | Check `app/Exceptions/Handler.php` and local overrides | Check `bootstrap/app.php` via `withExceptions(...)` plus local handlers |
| Routes / health | Check `routes/*.php` and `RouteServiceProvider` | Check `bootstrap/app.php` `withRouting(...)` and `routes/*.php` |

## Repository Checks Before Editing

Read the repository files that match the resolved version before proposing code:

1. `bootstrap/app.php`
2. `config/app.php` for Laravel 10.x, or `bootstrap/providers.php` for Laravel 11-12
3. `app/Http/Kernel.php` for Laravel 10.x middleware work
4. `app/Exceptions/Handler.php` or equivalent exception path
5. `tests/TestCase.php`, `phpunit.xml*`, and `tests/Pest.php` when the task touches testing
6. Relevant package config files when the task involves auth, queue, broadcast, or mail wiring

## Skip Rule

If the project is not Laravel, do not load this reference and do not spend tokens validating Laravel versions.

## Official Basis

- Laravel 10 guidance above is based on official Laravel 10 documentation queried through Context7.
- Laravel 11-12 guidance above is based on official Laravel 12 documentation queried through Context7.
- Applying the Laravel 12 default skeleton notes to Laravel 11 is an inference; confirm against repository files before editing.
