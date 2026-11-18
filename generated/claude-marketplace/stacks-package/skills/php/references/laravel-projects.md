# Laravel Project Reference

## Contents

- Scope
- Project Detection
- First Pass Checklist
- Version Validation
- Architecture Defaults
- Preferred Flow
- Eloquent and Data Rules
- Queues, Events, and Side Effects
- Testing Defaults
- Red Flags
- References

## Scope

Use this reference for modern Laravel applications and APIs. Prefer framework-native patterns first, then add extra abstraction only when the repository already uses it or the change clearly justifies it.

## Project Detection

Treat the codebase as Laravel-oriented when most of these are present:

- `artisan`
- `bootstrap/app.php`
- `config/*.php`
- `routes/web.php`, `routes/api.php`, or `routes/console.php`
- `app/Http/Controllers`, `app/Http/Requests`, `app/Models`
- `database/migrations`, `database/factories`, `database/seeders`
- `tests/Feature`, `tests/Unit`, or Pest files under `tests/`

## First Pass Checklist

Inspect these files before proposing structure changes:

1. `composer.json` for PHP/Laravel versions and installed packages
2. `bootstrap/app.php` plus `config/app.php` or `bootstrap/providers.php` as applicable for application wiring
3. `routes/*.php` for route style, middleware, and controller conventions
4. `app/Http`, `app/Models`, and any `app/Actions`, `app/Services`, or `app/Domain` folders
5. `database/migrations` and `database/factories` for persistence patterns
6. `tests/TestCase.php`, `tests/Feature`, and `tests/Unit` for testing style

## Version Validation

After Laravel is confirmed, load `references/laravel-version-checks.md` only for version-sensitive work. Let that file route you to `references/laravel-v10.md` or `references/laravel-v11-v12.md`. Skip version routing for routine Laravel CRUD work that stays within established repository patterns.

## Architecture Defaults

- Keep controllers thin. They should coordinate the request, call one use-case/action/service, and return a resource or response.
- Use `FormRequest` classes for validation and request authorization when the route accepts non-trivial input.
- Keep orchestration and transaction boundaries in services/actions, not in Eloquent models.
- Use Eloquent models for persistence concerns, relationships, casts, scopes, and small invariants close to the data.
- Use API resources or dedicated DTO transformers for response shaping when the endpoint is public or reused.
- Use policies/gates for authorization decisions instead of ad hoc checks in controllers.
- Push slow or retryable side effects into jobs, events, or listeners when latency and coupling justify it.

## Preferred Flow

```php
<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Actions\PlaceOrder;
use App\Http\Requests\StoreOrderRequest;
use App\Http\Resources\OrderResource;
use Illuminate\Http\JsonResponse;

final class StoreOrderController
{
    public function __invoke(
        StoreOrderRequest $request,
        PlaceOrder $action
    ): JsonResponse {
        $order = $action->handle(
            $request->validated(),
            $request->user()
        );

        return OrderResource::make($order)
            ->response()
            ->setStatusCode(201);
    }
}
```

## Eloquent and Data Rules

- Prefer eager loading for known relations to avoid N+1 queries.
- Use casts, value objects, and accessors/mutators for attribute normalization close to the model.
- Use query scopes or dedicated query objects for reused query logic.
- Introduce repositories only when storage abstraction or complex query composition is a real need; do not add them as ceremony.
- Wrap multi-row writes or state transitions in `DB::transaction()`.
- Keep heavy domain workflows out of model observers unless the project already centralizes behavior there.

## Queues, Events, and Side Effects

- Queue email, notifications, exports, and external API retries when the request does not need an immediate result.
- Use `ShouldQueue` listeners or jobs for side effects that can fail independently from the main write.
- Make queued jobs idempotent when retries are possible.
- Fake queues, mail, notifications, events, and storage in tests instead of hitting real integrations.

## Testing Defaults

- Use feature tests for routes, middleware, policies, validation, response payloads, and persistence side effects.
- Use unit tests for services, actions, value objects, custom rules, and pure domain logic.
- Prefer `RefreshDatabase` or the repository's existing transaction strategy for database isolation.
- Use factories and states for setup instead of manual inserts.
- Assert framework-visible behavior with helpers such as `assertJsonValidationErrors`, `assertForbidden`, `assertDispatched`, and `assertQueued`.

## Red Flags

- Validation arrays embedded directly in controllers for complex endpoints
- Business workflows hidden in controllers, observers, or route closures
- `env()` calls outside config files
- Raw arrays or models returned from public APIs when resources/DTOs are already the project norm
- Unbounded lazy loading in loops
- Service container lookups inside core domain logic

## References

- Laravel application structure, HTTP layer, queues, authorization, and testing docs
- Laravel 10 and Laravel 12 official docs queried through Context7 for version-sensitive routing
