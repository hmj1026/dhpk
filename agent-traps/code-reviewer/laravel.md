# code-reviewer — Laravel traps

- Eloquent: prefer `Model::query()->...` over the raw `DB` facade for type safety.
- Validation: form requests over inline `$request->validate()` for complex rules.
- Mass assignment: confirm `$fillable` / `$guarded` is set on every model touched.
- Migrations: every `up()` has a matching `down()` (irreversible migrations need an explicit comment).
