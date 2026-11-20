# Composer package contracts

Load the section that matches the decision being made. The parent skill keeps the
decision flow, output, and verification gate; this file holds the detailed contract
rules and examples.

## Semver — what counts as breaking

| Change | Bump |
|---|---|
| Remove or rename a public class, method, or function | major |
| Add a required parameter or tighten a public parameter type | major |
| Loosen a public return type or raise the PHP/dependency floor | major |
| Add a new public class, method, or optional parameter | minor |
| Tighten a return type or add an optional `suggest` dependency | minor |
| Bug fix without documented behavior change | patch |
| Documentation, internal refactor, or test-only change | patch |

If a `public` symbol has no `@internal` PHPDoc, downstream code may already depend on
it. Intent is not a compatibility guarantee; reclassifying an adopted public symbol
requires a major release.

## Public API surface

Use `@api` for the documented surface and `@internal` for implementation details:

```php
/** @api */
final class Gateway { /* ... */ }

/** @internal */
final class GatewayRequestBuilder { /* ... */ }
```

Default new classes to `@internal` when their extension contract is not deliberate.
Use `final` for classes not designed for extension; adding `final` is breaking, while
removing it is compatible. Treat every type in a public parameter or return value as
part of the package contract. Prefer PSR interfaces or package-owned value objects
over concrete dependency classes, and put optional runtime dependencies behind a
guarded facade with a `suggest` entry.

## composer.json hygiene

| Section | Contract |
|---|---|
| `require` | Only dependencies every consumer needs |
| `require-dev` | Test and development tooling only |
| `suggest` | Optional features with a runtime `class_exists` / `function_exists` guard |
| `autoload.psr-4` | One namespace per production root; exclude generated/vendor trees |
| `autoload.files` | Minimal polyfills or global helpers; every entry runs on every request |
| `autoload.classmap` | Legacy non-PSR code, accepting dump-time scan cost |
| `autoload-dev` | Test classes, never production test namespace pollution |
| `config.allow-plugins` | Explicitly allow only the Composer plugins actually used |
| `minimum-stability` | `stable` for libraries, usually with `prefer-stable: true` |

Use caret unions for supported majors (`^7.4 || ^8.0`). Avoid bare `>=`, `*`, and
`dev-main` in stable releases because they admit unverified future or floating graphs.
For a cross-major library, declare every supported major explicitly and test its floor.

## Laravel package discovery

When `extra.laravel.providers` or `extra.laravel.aliases` is present, validate the
package as a consumer would:

```bash
composer validate --strict
composer install --no-dev
php artisan package:discover --ansi
```

The provider FQCN must exist at the declared autoload path. Every facade alias must
resolve to a facade whose accessor matches the service-provider binding key; call one
facade method in CI to catch an accessor mismatch. A provider or alias that works only
inside the package repository is not discovery proof.

## Release flow

A release keeps these three artifacts on the same SHA:

1. The versioned CHANGELOG entry.
2. The matching `vX.Y.Z` git tag.
3. The GitHub release containing the changelog excerpt.

Before tagging, run:

- `composer validate --strict`.
- `composer install --prefer-lowest --prefer-stable`.
- The full PHP/framework test matrix.
- A public API diff against the previous tag.
- A check for `dev-main` / `@dev` constraints and inaccurate `@api` / `@internal`
  annotations.

After the tag, verify the package registry exposes the version with
`composer show <vendor>/<package> --available`. If a GitHub webhook is absent, the
registry may require a manual update; do not report publication from the tag alone.
