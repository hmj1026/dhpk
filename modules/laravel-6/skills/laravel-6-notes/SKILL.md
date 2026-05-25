---
name: laravel-6-notes
description: Laravel 6.x (LTS, Sep 2019) signature features and the breaking-change traps from 5.8 → 6.0. Use when writing or reviewing code in a Laravel 6 project, or in a package whose composer constraint includes ^6.0. Covers job middleware, lazy collections, the Str/Arr helper migration, the strict-semver shift, and the deprecations Laravel 6 removed from 5.x. Not for application business logic — load when working on framework-touching code (service providers, jobs, model attributes) or planning a 5.8 → 6 upgrade.
---

# Laravel 6 — LTS baseline

Released September 2019. **First Laravel version on strict semver** —
prior majors used a 5.x rolling number that did not signal breaking
changes meaningfully.

> PHP floor: 7.2 (use `php-7.4` module — there is no `php-7.2` module
> shipped). LTS support ran through 2022.

---

## Signature features

### Job middleware

```php
final class ThrottlesByCustomer
{
    public function handle($job, callable $next): void
    {
        Redis::funnel('customer:' . $job->customerId)
            ->limit(1)
            ->then(fn () => $next($job), fn () => $job->release(5));
    }
}

// In the Job class:
public function middleware(): array
{
    return [new ThrottlesByCustomer];
}
```

Wraps `Job::handle()` execution with composable middleware. Replaces
ad-hoc rate-limit / dedup logic that previously had to live inside
`handle()` itself.

### Lazy collections

```php
LazyCollection::make(function () {
    $handle = fopen('huge.csv', 'r');
    while (($row = fgetcsv($handle)) !== false) {
        yield $row;
    }
})->filter(fn ($r) => $r[3] === 'active')
  ->each(fn ($r) => Order::create([...]));
```

Memory-bounded iteration over arbitrarily large datasets. Eloquent
gained `cursor()` and `lazy()` methods that return `LazyCollection`.
Use anywhere a regular `Collection` would `OOM` on a multi-GB
dataset.

### Eloquent subquery selects

```php
$users = User::addSelect(['last_login_at' => Login::select('created_at')
    ->whereColumn('user_id', 'users.id')
    ->latest()
    ->take(1)
])->get();
```

One query instead of N+1. The subquery becomes a column in the
parent select.

### Extracted packages

These moved out of laravel/framework into separate packages requiring
explicit `composer require`:

- `laravel/cashier`
- `laravel/passport`
- `laravel/nova` (commercial)
- `facade/ignition` (error page — used to be the default in dev)

---

## Migration traps from 5.8

### `str_*` and `array_*` global helpers

These deprecated in 5.8 and were **removed by default** in 6.0:

```php
// 5.8 and earlier — works
str_slug('My Title');
array_pluck($items, 'name');

// 6.0 and later — must use the namespaced version
Str::slug('My Title');
Arr::pluck($items, 'name');
```

Quick fix: `composer require laravel/helpers` restores the global
functions, but treat that as a temporary bridge — do a follow-up PR
to migrate to `Str::` / `Arr::`.

Symbols affected: `array_*` (16 helpers), `str_*` (24 helpers). The
upgrade guide lists each.

### Auto-resolved auth model

Before 6.0: `Auth::user()` could return `null` mid-request silently.
After: same behaviour, but `RetrievedUser` event removed — code that
hooked it must move to `Authenticated`.

### Email verification interface signature changed

`MustVerifyEmail` interface gained `sendEmailVerificationNotification()`.
Custom user models that implemented it manually must add the method.

---

## What's *missing* compared to 7.x+

If reviewing a 6.x codebase, these are the features people commonly
miss and shim:

- **No HTTP client wrapper** (added in 7) — use `guzzlehttp/guzzle`
  directly
- **No custom Eloquent casts** (added in 7) — use accessors/mutators
  for transformation, or store JSON-encoded
- **No Blade `x-` components** (added in 7) — use `@include` or
  manual View Composers

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — service provider /
  facade / publishing patterns that apply across Laravel versions
- `modules/laravel-7/skills/laravel-7-notes/SKILL.md` — the next
  version's signature additions (HTTP client, custom casts)
- `modules/php-7.4/skills/php-modern-pro/SKILL.md` — PHP idioms valid
  for Laravel 6's PHP 7.2+ floor
