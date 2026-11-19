# Laravel 11-12 Version Notes

## Scope

Load this reference only after `references/laravel-version-checks.md` routes the task to Laravel 11 or 12, or when the repository clearly uses the streamlined Laravel 11+ skeleton.

Use it for version-sensitive work on:

- `bootstrap/app.php`
- `bootstrap/providers.php`
- middleware aliases / groups
- exception reporting / rendering hooks
- route bootstrap and health route wiring
- PHPUnit / Pest bootstrap and framework testing helpers

## Expected Skeleton

- `bootstrap/app.php` commonly uses `Application::configure(...)` to build the app.
- Route wiring is typically declared via `withRouting(...)`.
- Middleware aliases / groups are commonly configured via `withMiddleware(...)` in `bootstrap/app.php`.
- Exception reporting and rendering hooks are commonly configured via `withExceptions(...)` in `bootstrap/app.php`.
- User-defined service providers are commonly registered in `bootstrap/providers.php`.

## Load First

1. `composer.json` and `composer.lock`
2. `bootstrap/app.php`
3. `bootstrap/providers.php`
4. `routes/*.php`
5. `tests/TestCase.php`, `tests/Pest.php`, and `phpunit.xml*` when the task touches testing

## Editing Rules

- Do not fall back to Laravel 10 guidance such as editing `app/Http/Kernel.php` or `config/app.php` for provider registration unless the repository still carries those legacy structures.
- Confirm the actual repository skeleton before proposing health-route, middleware-alias, or exception-hook changes.
- Treat Laravel 11 as close to Laravel 12 for the areas above, but verify against the repository when a package or starter kit overrides the default skeleton.

## Official Basis

- Based on official Laravel 12 documentation queried through Context7.
- Applying the same routing here to Laravel 11 is an inference; confirm against repository files before editing.
