---
name: laravel-5.4-notes
description: Laravel 5.4 (February 2017) signature features and the breaking-change traps from 5.3 → 5.4. Use when writing or reviewing code in a Laravel 5.4 project, or in a package whose composer constraint includes 5.4.*. Covers Blade components & slots, route model binding, middleware groups, realtime facades, markdown mailables, higher-order messages, and the Elixir → Mix frontend transition. Not for application business logic — load when working on framework-touching code (Blade templates, routing, mailables, service providers, Mix config) or planning a 5.3 → 5.4 upgrade.
---

# Laravel 5.4 — LTS baseline

Released February 2017. Last of the 5.x line still running on the
PHP 5.6 floor, and a heavy refactor of the frontend tooling story.

> PHP floor: 5.6.4 (use the `php-5.6` module for the language
> baseline). This is the era before strict semver — the 5.x rolling
> number did not signal breaking changes meaningfully.

---

## Signature features

### Blade components & slots

```blade
{{-- resources/views/components/alert.blade.php --}}
<div class="alert alert-{{ $type }}">
    <div class="alert-title">{{ $title }}</div>
    {{ $slot }}
</div>

{{-- consuming view --}}
@component('components.alert', ['type' => 'danger'])
    @slot('title') Heads up @endslot
    The payment could not be processed.
@endcomponent
```

First introduced in 5.4. `@component` / `@slot` replace the older
pattern of `@include` plus a pile of passed variables. Named slots
become variables inside the component; the body becomes `$slot`.

### Route model binding

```php
// Implicit — type-hint the model, Laravel resolves by id
Route::get('orders/{order}', function (Order $order) {
    return $order;
});

// Explicit — custom key or scoping, in RouteServiceProvider::boot()
Route::bind('order', function ($value) {
    return Order::where('public_token', $value)->firstOrFail();
});
```

Override `getRouteKeyName()` on the model to bind by a column other
than the primary key.

### Middleware groups (web / api)

```php
// app/Http/Kernel.php
protected $middlewareGroups = [
    'web' => [/* sessions, csrf, cookies, ... */],
    'api' => ['throttle:60,1', 'bindings'],
];
```

The `api` group ships throttled and stateless; the `web` group
carries session + CSRF. Route files (`routes/web.php`,
`routes/api.php`) are auto-assigned their matching group.

### Realtime facades

```php
use Facades\App\Services\PaymentGateway;

PaymentGateway::charge($order); // resolves the bound instance
```

Prefix any class with `Facades\` to call it statically without
authoring a facade class. Useful for testability without boilerplate.

### Markdown mailables

```php
public function build()
{
    return $this->markdown('emails.orders.shipped')
        ->with(['url' => $this->order->trackingUrl()]);
}
```

```blade
@component('mail::message')
# Order Shipped
@component('mail::button', ['url' => $url]) Track @endcomponent
@endcomponent
```

Pre-styled, responsive email components rendered from Markdown +
Blade. Publish and theme via `vendor:publish --tag=laravel-mail`.

### Collection higher-order messages

```php
$users->each->markAsActive();
$orders->sum->total;
$invoices->reject->isPaid();
```

Shortcut proxies for `each`, `map`, `filter`, `reject`, `sum`, etc.
that call a method or read a property on each element.

### Laravel Dusk

Introduced in 5.4 as a separate package (`laravel/dusk`) — real
browser (ChromeDriver) end-to-end testing with an expressive API,
no Selenium standalone server required.

### Resource routes

```php
Route::resource('photos', 'PhotoController');
// index/create/store/show/edit/update/destroy in one line
```

Use `->only([...])` / `->except([...])` to trim the generated set.

---

## Migration traps from 5.3

### The `Input` facade is gone

```php
// 5.3 and earlier
$name = Input::get('name');

// 5.4 and later — inject the request
public function store(Request $request)
{
    $name = $request->input('name');
}
```

The `Input` facade was removed. Use the injected `Request` (or the
`request()` helper). This is the single most common upgrade break.

### Frontend: Elixir → Laravel Mix (webpack)

```js
// webpack.mix.js — replaces gulpfile.js / elixir(...)
const mix = require('laravel-mix');
mix.js('resources/assets/js/app.js', 'public/js')
   .sass('resources/assets/sass/app.scss', 'public/css');
```

`laravel/elixir` (gulp-based) was deprecated in favour of
`laravel-mix` (webpack-based). The default `package.json` scripts
become `npm run dev` / `npm run watch` / `npm run production`. Old
`gulpfile.js` projects keep working only if you stay on the elixir
package, but new scaffolding ships Mix.

### Blade CSRF / method spoofing directives

```blade
{{-- 5.4 directives --}}
<form method="POST">
    {{ csrf_field() }}
    {{ method_field('PUT') }}
</form>
```

`csrf_field()` and `method_field()` helpers are the supported way to
emit hidden tokens. (The `@csrf` / `@method` Blade directives are a
later addition — see "What's missing" below.)

### `$dates` and attribute casting

```php
protected $dates = ['published_at'];
protected $casts = ['options' => 'array', 'active' => 'boolean'];
```

Date and cast handling tightened in this era; columns listed in
`$dates` become `Carbon` instances. Verify serialization after
upgrade — silently-untyped attributes that were strings may now be
objects.

### Route caching changes

`php artisan route:cache` is stricter about closures — routes with
closures cannot be cached. Move closure routes to controllers before
caching in production.

---

## What's *missing* compared to 5.5+

If reviewing a 5.4 codebase, these are the features people commonly
miss and shim:

- **No package auto-discovery** (added in 5.5) — every package's
  service provider and facade must be registered by hand in
  `config/app.php`. Workaround: just register them manually; that is
  the expected 5.4 workflow.
- **No `apiResource()`** (added in 5.5) — use
  `Route::resource('x', 'XController', ['only' => ['index','store','show','update','destroy']])`
  to get the API-only subset.
- **No `@csrf` / `@method` Blade directives** (added in 5.6) — use
  the `csrf_field()` / `method_field()` helper calls shown above.
- **No exception `render()` / `report()` per-exception convention**
  (standardized in 5.5) — centralize handling in
  `App\Exceptions\Handler` instead.
- **No `whenLoaded()` on API resources** (resources themselves
  arrived 5.5) — guard relation access manually with
  `$this->relationLoaded('x')`.

---

## Cross-references

- `skills/php56-yii-dev/SKILL.md` and `skills/php-pro/SKILL.md` —
  PHP 5.6 idioms valid for Laravel 5.4's PHP 5.6.4+ floor (use the
  `php-5.6` module for the language baseline)
- `modules/phpunit-5.7/skills/...` — the PHPUnit major that ships
  with the Laravel 5.4 testing baseline
- `modules/laravel-6/skills/laravel-6-notes/SKILL.md` — the next
  major (strict semver, helper migration, lazy collections)
