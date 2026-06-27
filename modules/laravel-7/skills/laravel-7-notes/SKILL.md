---
name: laravel-7-notes
description: Laravel 7.x (March 2020) signature features and the breaking-change traps from 6 → 7. Use when writing or reviewing code in a Laravel 7 project, or in a package whose composer constraint includes ^7.0. Covers the new HTTP client facade, custom Eloquent casts via the CastsAttributes interface, the Blade x-component overhaul, Symfony 5 upgrade implications, and route-model-binding-by-key. Not for application business logic — load when touching framework code (HTTP calls, casts, Blade components) or planning a 6 → 7 upgrade.
---

# Laravel 7 — HTTP client, custom casts, blade components

Released March 2020. **6-month support cycle** (not LTS). PHP 7.2.5+
floor.

---

## Signature features

### HTTP client wrapper (Http facade)

```php
$response = Http::withHeaders(['X-Trace' => $traceId])
    ->retry(3, 100)
    ->timeout(5)
    ->post('https://api.example.com/orders', ['sku' => $sku]);

if ($response->successful()) {
    $order = $response->json('data');
}
```

Wraps Guzzle with a fluent Laravel API. Notable: built-in retry,
timeout, response mocking via `Http::fake()`. Strongly preferred over
direct Guzzle in new Laravel 7+ code — it integrates with Laravel's
logging, dump-and-die helpers, and test fakes.

### Custom Eloquent casts

```php
final class MoneyCast implements CastsAttributes
{
    public function get($model, string $key, $value, array $attributes): Money
    {
        return Money::fromCents((int) $value);
    }

    public function set($model, string $key, $value, array $attributes): array
    {
        return [$key => $value instanceof Money ? $value->cents() : (int) $value];
    }
}

// In the model:
protected $casts = ['price' => MoneyCast::class];
```

Before 7.0: accessor/mutator methods (`getPriceAttribute`,
`setPriceAttribute`) were the only path. CastsAttributes is cleaner
for value-object wrapping — reusable across models, testable in
isolation.

### Blade `x-component` syntax

```blade
{{-- resources/views/components/alert.blade.php --}}
<div class="alert alert-{{ $type }}">
    {{ $slot }}
</div>

{{-- Usage --}}
<x-alert type="danger">Order failed</x-alert>
```

First-class components with slot semantics. Replaces the older
`@component` directive (still works but deprecated for new code).

### Route model binding by custom key

```php
Route::get('/users/{user:username}', UserController::class);
```

Binds by the named column instead of the model's primary key. Before
7.0: required overriding `getRouteKeyName()` per model.

---

## Migration traps from 6

### Symfony 5 upgrade

Dependencies bumped to Symfony 5.x components. Effects:

- Any code using `Symfony\Component\Console\*` directly may break
- Custom commands extending Symfony classes need signature audits
- Mail dependencies (Swift Mailer for now; Symfony Mailer comes in L9)

### Authentication scaffolding extracted

The `auth` scaffolding (login, register, password reset routes) moved
from the framework into `laravel/ui` (and later `laravel/breeze`,
`laravel/jetstream`). Upgrading from 6 requires:

```bash
composer require laravel/ui
php artisan ui vue --auth
```

For headless / API-only projects you don't need this at all.

### `laravel/helpers` package no longer auto-suggested

Following the 5.8 → 6.0 helper deprecation, by 7.0 the
`composer require laravel/helpers` bridge is fully optional and the
upgrade guide stops suggesting it. Code should be fully migrated to
`Str::` / `Arr::` by now.

---

## What changes compared to 8.x+

If reviewing a 7.x codebase mid-upgrade:

- **No `app/Models/` directory** (added in 8) — models live in `app/`
  by default
- **Old factory syntax** (rewritten in 8) — `$factory->define()`
  closures instead of factory classes
- **No job batching** (added in 8) — implement manually with
  `Bus::chain()`

---

## When NOT to Use

Not for application business logic, and not for a project on a different
Laravel major — use the matching `laravel-N-notes`. Package-authoring
concerns (service providers, facades, testbench) live in
`laravel-package-author`.

## Output

Framework-touching code or review notes that match Laravel 7's APIs
(PHP 7.2.5 floor) — flag any call that actually belongs to a different
major.

## Verification

- Confirm the project runs Laravel 7 (`composer show laravel/framework`).
- Check the PHP 7.2.5 floor before using version-gated syntax.
- Cross-check cited APIs against the 6 → 7 upgrade guide.

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — testbench setup that
  covers 7.x cells in a package matrix
- `modules/laravel-6/skills/laravel-6-notes/SKILL.md` — the previous
  version's baseline
- `modules/laravel-8/skills/laravel-8-notes/SKILL.md` — the next
  version's signature additions
