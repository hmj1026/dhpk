# Laravel family migration guide

> Source boundary: These upgrade notes summarize locked framework docs; they are not application-policy SSOT.

Resolve both the source and target selectors before changing code. Make each
hop independently green when a project spans several majors; do not apply a
later-major example to an earlier cell.

## Upgrade sequence

### Laravel 5.4 to 6

- Replace `Input`-era request access and audit the 5.8-deprecated global
  `str_*` / `array_*` helpers; migrate to `Str::` / `Arr::` or use
  `laravel/helpers` only as a short-lived bridge.
- Confirm PHP 7.2 and Carbon 2 constraints. Install `laravel/ui` explicitly
  when the application still needs the extracted auth scaffolding.
- Keep Mix separate: a Laravel 5.4 upgrade can retain its optional Mix
  pipeline, but framework migration does not require adopting Mix.

### Laravel 6 to 7

- Audit Symfony 5 direct integrations and command signatures.
- Replace accessor/mutator-only value-object transformations with reusable
  `CastsAttributes` classes where appropriate.
- Use the HTTP client facade for new calls and keyed route binding when the
  route contract calls for a non-primary key.

### Laravel 7 to 8

- Convert closure factories to `Factory` classes with `HasFactory`; retain
  `laravel/legacy-factories` only as a temporary bridge.
- Review model-generation paths (`app/` versus `app/Models/`), queue retry
  cutoffs, job batches, dynamic components, migration squashing, and the
  Tailwind scaffold switch.
- Do not move existing models merely because generators now prefer
  `app/Models/`; update namespaces and consumers together if you do move them.

### Laravel 8 to 9

- Move CI to PHP 8.0 and check PHP 8.1 separately for enum casts.
- Convert named migrations only when useful; anonymous migrations remove
  future class-name collisions while old named classes continue to work.
- Rework custom Swift transports and direct Flysystem 1 adapter calls for
  Symfony Mailer and Flysystem 3. Prefer Laravel's stable facades.

### Laravel 9 to 10

- Move CI to PHP 8.1 and audit child classes for native return-type/LSP drift.
- Replace `dispatchNow()` with `dispatch_sync()` or `Bus::dispatchSync()`.
- Adopt `ValidationRule` and `Process` incrementally; verify Predis 2 pipeline,
  transaction, and exception behavior when using Predis.

### Laravel 10 to 11

- Move CI to PHP 8.2 and review Sanctum 4 migrations/configuration.
- The old `app/Http/Kernel.php`, `app/Console/Kernel.php`, and
  `app/Exceptions/Handler.php` layout remains compatible. Retain it for a
  low-risk upgrade and migrate to `bootstrap/app.php` separately if useful.
- Prefer `casts()` for new model code while recognizing that `$casts` still
  works. Audit middleware group declarations, console scheduling, health
  probes, and relationship loading.

### Mix 5 to Mix 6 (optional tooling path)

- Treat this as a separate npm/webpack migration, not a Laravel framework
  upgrade. Mix 5 is webpack 4; Mix 6 is webpack 5 with different Vue defaults
  and PostCSS 8 configuration.
- Resolve legacy OpenSSL failures on newer Node with the documented temporary
  flag, then plan a supported Node/toolchain upgrade. Verify `dev`, `watch`,
  and production builds independently.

## Verification order

1. Resolve the source selector and record the PHP/tooling floor.
2. Run the source version's tests and its verification commands.
3. Apply one migration hop and update dependency/CI constraints.
4. Run static analysis plus framework-specific tests, then inspect generated
   routes, migrations, factories, mail, storage, and bootstrap files.
5. Resolve the target selector and run its verification gates before shipping.

If a project cannot be mapped to one supported selector, ask for the exact
framework or Mix version and keep the migration unresolved rather than
assuming the nearest reference.

See [`compatibility.md`](compatibility.md) for the cross-version matrix and
[`SKILL.md`](SKILL.md) for the family resolver contract.
