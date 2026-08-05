# code-reviewer — Laravel traps

- Eloquent: prefer `Model::query()->...` over the raw `DB` facade for type safety.
- Validation: form requests over inline `$request->validate()` for complex rules.
- Mass assignment: confirm `$fillable` / `$guarded` is set on every model touched.
- Migrations: every `up()` has a matching `down()` (irreversible migrations need an explicit comment).
- **N+1**: a relationship accessed inside a loop / Blade `@foreach` without `with()` eager-loading. Flag `->get()` then `$row->relation` in a loop → `Model::with('relation')`. (Latency lane → `performance-analyzer`.)
- **`$casts`**: dates / json / bool / enum columns must be declared in `$casts` (or `casts()` on L11) — a raw string compared as a date/bool is a silent bug.
- **Fat controller**: business logic (multi-step writes, external calls, money math) in a controller action → extract to a service / action / job; the controller orchestrates only.
- **`strict_types`**: new `.php` files declare `declare(strict_types=1);` and type-hint params + returns where the floor allows (see `code-reviewer/php.md` for the version floor).
- Security lanes (mass-assignment escalation of privileged columns, SQLi via `DB::raw`, unvalidated file upload) → `security-reviewer/php.md`.
