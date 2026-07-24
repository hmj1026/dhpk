---
name: laravel-10-notes
description: Laravel 10.x (February 2023) signature features and the breaking-change traps from 9 → 10. Use when writing or reviewing code in a Laravel 10 project, or in a package whose composer constraint includes ^10.0. Covers native return types throughout the app skeleton, invokable validation rules via the ValidationRule contract, the Process facade for shell invocation, the Pest-as-default test option, and the Predis 2.x default. Not for application business logic — load when touching the app skeleton, validation rules, or shell calls, or planning a 9 → 10 upgrade. Output: version-specific guidance, migration traps, and verification gates.
---

# Laravel 10 — native types, invokable rules, Process facade

Released February 2023. PHP 8.1+ floor.

---

## Signature features

### Native return types in app skeleton

Generated artifacts now include native PHP type declarations
everywhere:

```php
// Before (Laravel 9 generator)
public function index() {
    return view('users.index');
}

// After (Laravel 10 generator)
public function index(): View {
    return view('users.index');
}
```

The framework itself also typed previously-untyped public methods. Most
of these don't break user code, but **strict child classes** that
override framework methods may now produce LSP errors.

Audit point: a Laravel 9 → 10 upgrade should run static analysis
(PHPStan / Psalm) to catch override signature drift.

### Invokable validation rules

```php
final class OrderHasStockRule implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! Stock::availableFor($value)) {
            $fail('The :attribute references an out-of-stock SKU.');
        }
    }
}

// Usage
$request->validate(['sku' => ['required', new OrderHasStockRule]]);
```

Replaces the older `Rule` interface (still works, deprecated). Cleaner
signature; closure-based failure reporting; testable in isolation.

### Process facade

```php
$result = Process::run('ls -la');

if ($result->successful()) {
    echo $result->output();
} else {
    Log::error('ls failed', ['code' => $result->exitCode(), 'err' => $result->errorOutput()]);
}

// Async
$invocation = Process::start('long-running-task');
$invocation->wait();
```

Wraps `symfony/process` with Laravel ergonomics. Prefer this over PHP's
raw shell-invocation functions or direct Symfony Process construction
in new code — it integrates with `Process::fake()` for testing and uses
the safer argument-array form by default.

### Pest as test default option

`composer create-project laravel/laravel` now prompts whether to install
Pest as the test runner. PHPUnit remains the default; Pest is an
opt-in alternative.

---

## Migration traps from 9

### PHP 8.1 floor

CI matrix drops 8.0:

```yaml
matrix:
  php:     ['8.1', '8.2']
  laravel: [10]
```

### Predis 2.x default

`predis/predis: ^2.0` is the default Redis client. If you were on
predis 1.x:

- API mostly compatible
- **Pipeline / transaction return types** changed
- **Connection error exception names** changed

If you've been using phpredis (the C extension), this doesn't affect
you.

### `dispatchNow` removed

Synchronous job dispatch via `dispatch_sync()` or `Bus::dispatchSync()`
is now the only path. `dispatchNow()` was deprecated in 9 and removed.

### Test factory `make()` vs `create()`

No change in 10, but **deprecation warnings** are louder if you call
`->make()` on a factory that has DB-dependent state. Audit factories
that mix `make()` (no DB) with `create()` semantics.

---

## What changes compared to 11

- **Standard app skeleton** (not streamlined) — Laravel 11 strips
  `app/Http/Middleware/`, `app/Console/Kernel`, `app/Exceptions/Handler`
- **`$casts` property on models** (Laravel 11 prefers `casts()` method)
- **Per-minute rate limiting only** (Laravel 11 adds per-second)
- **No `/up` health endpoint** (added in 11)

---

## When NOT to Use

Not for application business logic, and not for a project on a different
Laravel major — use the matching `laravel-N-notes`. Package-authoring
concerns (service providers, facades, testbench) live in
`laravel-package-author`.

## Output

Framework-touching code or review notes that match Laravel 10's APIs
(PHP 8.1 floor) — flag any call that actually belongs to a different
major.

## Verification

- Confirm the project runs Laravel 10 (`composer show laravel/framework`).
- Check the PHP 8.1 floor before using version-gated syntax.
- Cross-check cited APIs against the 9 → 10 upgrade guide.

---

## Cross-references

- `skills/laravel-package-author/SKILL.md` — package author concerns
- `modules/php-8.x/skills/php-8x-features/SKILL.md` — readonly / enums
  / intersection types that pair well with L10's type-everywhere stance
- `modules/laravel-11/skills/laravel-11-notes/SKILL.md` — next version
