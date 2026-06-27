---
name: laravel-9-notes
description: Laravel 9.x (February 2022) signature features and the breaking-change traps from 8 → 9. Use when writing or reviewing code in a Laravel 9 project, or in a package whose composer constraint includes ^9.0. Covers anonymous migrations, the Symfony 6 upgrade, Symfony Mailer replacing Swift Mailer, Flysystem 3 breaking changes (visibility / exception API), PHP 8.0 floor, query builder improvements, enum casts, and the new Ignition error page. Not for application business logic — load when touching migrations, mail, storage, or casts, or planning an 8 → 9 upgrade.
---

# Laravel 9 — PHP 8 floor, Symfony 6, Flysystem 3

Released **February 2022** (Laravel skipped September 2021 to align
with Symfony 6's release). PHP 8.0+ floor — the major PHP bump.

---

## Signature features

### Anonymous migrations

```php
// database/migrations/2022_01_01_000000_add_status_to_orders.php
return new class extends Migration {
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('status')->default('pending');
        });
    }
};
```

**Why this matters**: pre-9.0 migrations were named classes
(`AddStatusToOrders`). Re-running `make:migration` for the same column
in a different version produced class-name collisions, especially when
squashing schemas. Anonymous classes side-step the entire collision
class.

New migrations should use this form. Old named-class migrations still
work; no need to rewrite them.

### Symfony Mailer (Swift Mailer removed)

```php
// Same Mailable API as before
Mail::to($user)->send(new OrderShipped($order));
```

Underneath, Swift Mailer was replaced by Symfony Mailer. User-facing
API is mostly identical, but **custom transports** must be reimplemented
against `Symfony\Component\Mailer\Transport\TransportInterface`.

### Flysystem 3 (breaking changes)

Storage facade still works, but underneath:

- **Visibility constants** moved:
  `AdapterInterface::VISIBILITY_PUBLIC` → `Visibility::PUBLIC`
- **Exceptions** changed: `FileNotFoundException` is gone; catch
  `UnableToReadFile` etc.
- **`readStream` / `writeStream`** signatures slightly differ

If your code calls Flysystem APIs directly (not via Laravel's
`Storage::` facade) you'll need to update.

### Query builder improvements

```php
// whereBelongsTo() — inverse of whereHas
$posts = Post::whereBelongsTo($user)->get();

// Full-text where (MySQL / PostgreSQL)
Post::whereFullText(['title', 'body'], 'search terms')->get();
```

### Enum casts

```php
enum Status: string {
    case Active   = 'active';
    case Disabled = 'disabled';
}

final class User extends Model {
    protected $casts = ['status' => Status::class];  // PHP 8.1 enum
}

// Implicit route binding
Route::get('/users/{user}/{status}', function (User $user, Status $status) {
    // $status is the enum instance, not the string
});
```

Requires PHP 8.1 for the enum itself (Laravel 9 floor is 8.0; 8.1+ is
needed for this feature).

---

## Migration traps from 8

### PHP 8.0 floor (the big one)

Laravel 9 won't install on PHP 7.x. CI matrix changes:

```yaml
matrix:
  php: ['8.0', '8.1']    # drop 7.4
  laravel: [9]
```

If your *package* still needs to support both 8.x and 9.x of Laravel,
the PHP constraint matrix forks — `^7.4 || ^8.0` for Laravel 8 cells,
`^8.0 || ^8.1` for Laravel 9 cells. Use composer `--prefer-lowest` in
CI to verify the lowest cell works.

### Swift Mailer → Symfony Mailer

Mailable user-code mostly identical, but:

- **Custom transports** must be reimplemented
- **`Swift_Message` access in tests** — `$mail->getSymfonyMessage()` is
  the new path; `getSwiftMessage()` no longer exists
- **Inline image headers** subtly differ — visual test if you generate
  HTML mails with embedded images

### Flysystem 3 (see above)

If your code does `Storage::disk('s3')->getAdapter()->...` and uses
adapter-level APIs, expect breakage. Stick to Laravel's `Storage::`
facade methods for forward-compatibility.

### `laravel/legacy-factories` removed

The 8.x-vintage closure-based factories are no longer supported.
Every factory must be a class extending `Factory`.

---

## What changes compared to 10.x+

- **No native return-type declarations** in the default app skeleton
  (added in 10) — generators don't add them
- **No invokable validation rules** (added in 10) — use `ValidationRule`
  with `Rule::class` invocation
- **No Process facade** (added in 10) — use `symfony/process` directly

---

## When NOT to Use

Not for application business logic, and not for a project on a different
Laravel major — use the matching `laravel-N-notes`. Package-authoring
concerns (service providers, facades, testbench) live in
`laravel-package-author`.

## Output

Framework-touching code or review notes that match Laravel 9's APIs
(PHP 8.0 floor) — flag any direct Flysystem 1 / Swift Mailer call that
actually belongs to a different major.

## Verification

- Confirm the project runs Laravel 9 (`composer show laravel/framework`).
- Check the PHP 8.0 floor (8.1 for enum casts) before version-gated syntax.
- Cross-check cited APIs against the 8 → 9 upgrade guide.

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — package author concerns
- `modules/php-8.x/skills/php-8x-features/SKILL.md` — language additions
  L9 enables
- `modules/laravel-10/skills/laravel-10-notes/SKILL.md` — next version
