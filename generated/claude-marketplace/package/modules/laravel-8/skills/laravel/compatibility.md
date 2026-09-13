# Laravel family compatibility

> Source boundary: These notes summarize locked framework docs; they are not application-policy SSOT.

Use this matrix after resolving a selector. It is a quick boundary check, not
a replacement for the complete version reference.

| Selector | Framework/runtime floor | Distinct compatibility boundary |
| --- | --- | --- |
| `5.4` | PHP 5.6.4 | Pre-strict-semver 5.x baseline; manual package registration; helper-based CSRF/method spoofing |
| `6` | PHP 7.2 | Strict semver; global `str_*` and `array_*` helpers removed by default; `laravel/ui` owns auth scaffolding |
| `7` | PHP 7.2.5 | HTTP client facade, custom casts, and keyed route binding; Symfony 5 dependency upgrade |
| `8` | PHP 7.3 | Class-based factories, job batching, queueable closures, and the default `app/Models/` location |
| `9` | PHP 8.0 | Anonymous migrations, Symfony Mailer, Flysystem 3; enum casts require PHP 8.1 |
| `10` | PHP 8.1 | Native skeleton return types, `ValidationRule`, Process facade, and the optional Pest scaffold |
| `11` | PHP 8.2 | Streamlined bootstrap structure, `casts()`, per-second limits, `/up`, and SQLite default scaffolding |
| `mix` | Node/npm project tooling | Optional Mix 5 webpack 4 pipeline; independent from the framework selector and not Vite/webpack 5 |

## Repeated traps across the family

- **PHP floors are real gates.** Choose syntax and dependency constraints from
  the selected floor, not from the host PHP version. Laravel 6 examples use
  PHP 7.2-compatible closures; Laravel 8's class-based factory example is
  likewise safe for its PHP 7.3 floor.
- **Scaffolding layout is not domain behavior.** Laravel 8's `app/Models/`
  default and Laravel 11's streamlined bootstrap are generator choices; old
  layouts remain supported where the version reference says so.
- **Abstraction boundaries move.** Helpers, factories, mailers, filesystem
  adapters, validation rules, and process invocation need direct API audits
  during upgrades. Prefer Laravel facades/contracts over reaching into an
  underlying package adapter.
- **Optional tooling stays optional.** Mix 5 is selected only for the legacy
  asset pipeline. It does not imply a Laravel framework version, and a Laravel
  selector does not imply Mix.

## Feature boundary reminders

- `@component` / `@slot`, `csrf_field()`, and `method_field()` are the Laravel
  5.4 baseline. `@csrf`, `@method`, package auto-discovery, and API resource
  helpers arrive later.
- Laravel 6's `laravel/helpers` package is a temporary bridge; migrate to
  `Str::` and `Arr::` rather than making global helpers a new dependency.
- Laravel 7's `Http` facade and `CastsAttributes` contract are not Laravel 6
  APIs. Laravel 8's factory class form and `HasFactory` are not the old
  closure factory contract.
- Laravel 9's Flysystem 3 and Symfony Mailer changes are adapter-level
  migration work even when the `Storage` and Mailable facades remain stable.
- Laravel 10's PHP 8.1 floor and Laravel 11's PHP 8.2 floor are separate
  constraints; do not collapse them into one modern-PHP assumption.

For complete examples and per-release verification, follow the links in
[`SKILL.md`](SKILL.md) and the selector references in `references/`.
