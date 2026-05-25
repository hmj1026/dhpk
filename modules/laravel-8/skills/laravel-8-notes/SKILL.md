---
name: laravel-8-notes
description: Laravel 8.x (September 2020) signature features and the breaking-change traps from 7 → 8. Use when writing or reviewing code in a Laravel 8 project, or in a package whose composer constraint includes ^8.0. Covers the factory class rewrite (HasFactory trait), Jetstream/Fortify scaffolding split, job batching, queueable closures, the app/Models/ relocation, dynamic Blade components, migration squashing, and the Tailwind-by-default switch.
---

# Laravel 8 — factories rewritten, job batching, models relocated

Released September 2020. PHP 7.3+ floor. Lots of structural change in
this release — the biggest since 5.0.

---

## Signature features

### Factory class rewrite (the big one)

Before 8.0:

```php
// database/factories/UserFactory.php — closure-based
$factory->define(User::class, function (Faker $faker) {
    return [
        'name'  => $faker->name,
        'email' => $faker->unique()->safeEmail,
    ];
});

// Usage
factory(User::class)->create();
factory(User::class, 3)->create();
```

After 8.0:

```php
// database/factories/UserFactory.php — class-based
final class UserFactory extends Factory
{
    protected $model = User::class;

    public function definition(): array
    {
        return [
            'name'  => $this->faker->name,
            'email' => $this->faker->unique()->safeEmail,
        ];
    }

    public function suspended(): self
    {
        return $this->state(fn () => ['status' => 'suspended']);
    }
}

// In the User model:
use Illuminate\Database\Eloquent\Factories\HasFactory;
final class User extends Authenticatable { use HasFactory; }

// Usage
User::factory()->create();
User::factory()->count(3)->suspended()->create();
```

Class-based factories enable **states** (named variants like
`suspended()`), **relationship sequences**, and inheritance. They're
also more discoverable in IDEs.

> **Upgrade trap**: the global `factory()` helper still exists via
> `laravel/legacy-factories` package but should be treated as a
> migration bridge, not a permanent dep.

### Job batching

```php
$batch = Bus::batch([
    new ProcessOrder(1),
    new ProcessOrder(2),
    new ProcessOrder(3),
])->then(function (Batch $batch) {
    // All jobs succeeded.
})->catch(function (Batch $batch, Throwable $e) {
    // First failure — Laravel auto-stops the batch.
})->finally(function (Batch $batch) {
    // Always runs.
})->dispatch();
```

Requires a `job_batches` table (Laravel ships the migration). Tracks
progress, failures, and aggregated state in the database — useful for
long-running data processing pipelines.

### Queueable closures

```php
dispatch(function () {
    Mail::to('admin@example.com')->send(new ReportReady);
});
```

For one-off background work too small to justify a Job class. Backed
by serializing the closure (requires `laravel/serializable-closure`
since 9.0; bundled before).

### `app/Models/` default location

The default scaffold now puts models under `app/Models/User.php`
instead of `app/User.php`. **Existing 7.x projects don't need to move
their models** — both layouts work — but new generated artifacts
default to `app/Models/`. Eloquent doesn't care about the directory.

---

## Other notable additions

- **Dynamic Blade components**: `<x-dynamic-component :component="$type" />`
- **Migration squashing**: `php artisan schema:dump` snapshots the
  schema; new environments skip the early migration files and apply
  the snapshot
- **Time helpers**: `Carbon` integration deepens; `now()` mockable via
  `Carbon::setTestNow()` (works in earlier versions but documented
  prominently here)
- **Improved rate limiting**: named limiters via
  `RateLimiter::for('api', ...)` instead of inline throttle middleware
  args
- **Tailwind in default scaffolds** (replacing Bootstrap)

---

## Migration traps from 7

### Factory rewrite (see above)

The most disruptive change. Old factories still work via
`laravel/legacy-factories`, but new factories should use the class
form. Mixing both in one project is supported.

### Jetstream / Fortify replace `laravel/ui`

For new auth scaffolding, prefer Jetstream (with Livewire or Inertia)
or Breeze. The `laravel/ui` package still works but is in maintenance
mode.

### Model directory move

If you generate models with `php artisan make:model`, they go to
`app/Models/` by default. Update any IDE templates / code generators
that assumed `app/`.

### Queue retries respect `retryUntil()`

If a job defines `retryUntil()`, the queue worker respects it as the
ultimate retry cutoff regardless of `tries`. Previously these could
contradict each other quietly.

---

## What changes compared to 9.x+

- **No anonymous migrations** (added in 9) — every migration is a
  named class, which causes name collisions when squashing
- **Swift Mailer** (replaced by Symfony Mailer in 9) — Mailables work
  but the underlying mailer differs
- **Flysystem 1** (Flysystem 3 in 9) — visibility and exception API
  differs

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — testbench cells for 8.x
- `modules/laravel-7/skills/laravel-7-notes/SKILL.md` — prior version
- `modules/laravel-9/skills/laravel-9-notes/SKILL.md` — next version
