# code-reviewer — Laravel traps

PHP language floor → `code-reviewer/php.md` (and the PHP coding-style
reference that sheet points at). Security lanes (privileged
`$fillable`, `DB::raw` SQLi, unvalidated upload) → `security-reviewer/php.md`.
N+1 latency / query-count → `database-reviewer` (this sheet only flags the
Eloquent shape).

| Trigger | Action | Non-apply |
|---|---|---|
| Raw `DB::` facade in an application service for a typed Eloquent model | prefer `Model::query()->…` | migrations, seeders, and artisan commands that are intentionally table-level |
| Complex validation rules inline in a controller (`$request->validate([...])` spanning many fields) | extract a Form Request | one- or two-field checks that already live next to the action |
| Model touched by mass assignment without `$fillable` / `$guarded` | set one of them explicitly | `$guarded = []` is not an auto-PASS — still review privileged columns with security-reviewer |
| Migration `up()` without a matching `down()` | add `down()` or an explicit irreversible comment | data backfills documented as one-way |
| `$row->relation` inside a loop / Blade `@foreach` after `->get()` without `with()` | `Model::with('relation')` | the relation was already eager-loaded on that query |
| Date / json / bool / enum column compared as a raw string | declare `$casts` (or `casts()` on L11) | a column that is stored and compared as a string by design |
| Multi-step writes, money math, or external calls inside a controller action | extract a service / action / job; controller orchestrates | a thin action that only calls one service method |
| New `.php` file missing `declare(strict_types=1)` where the PHP floor allows typed params/returns | add the declare and type hints | PHP 5.6 floor projects — follow `code-reviewer/php.md` instead |
