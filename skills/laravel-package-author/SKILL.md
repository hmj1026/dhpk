---
name: laravel-package-author
description: Cross-version Laravel package authoring. Use when: designing a service provider, facade, version-conditional binding, publishable artifact, discovery contract, or package compatibility surface. Not for: application code, one-major API details, Composer release hygiene, or deep Testbench matrix mechanics. Output: an authoring decision or package design with provider, facade, publishing, discovery, and compatibility gates.
---

# Laravel package author

Use this skill for code distributed as a Laravel package. A package ships more than
classes: service providers, facades, configuration, migrations, routes, views, and
assets are separate consumer contracts.

## Working sequence

1. Identify the supported Laravel and PHP range and every published surface.
2. Load `references/authoring-patterns.md` for the provider, binding, facade, matrix,
   publishing, discovery, or compatibility branch being changed.
3. Keep provider registration, public aliases, version branches, and published names
   explicit; pair each conditional branch with a test cell.
4. Validate the package as a real consumer, not only from its own repository.

## Contract branches

- Provider lifecycle or deferred binding → `authoring-patterns.md` §Service provider.
- Multi-major behavior → §Version-conditional bindings and the Testbench skill.
- Facade or auto-discovery → §Facades and discovery metadata.
- Config, views, assets, routes, or migrations → §Publishing recipes.
- Released names or artifact compatibility → §Laravel-specific compatibility surface.

## When NOT to Use

- Application controllers, jobs, or models that are not distributed to consumers.
- Version-specific Laravel deprecations or new APIs; use the matching `laravel-N` module.
- Semver, Composer manifest, or registry publication decisions; use
  `composer-package-hygiene`.
- Detailed per-cell Testbench setup; use `laravel-testbench-matrix`.

## Output

Return an authoring decision or implementation checklist covering the register/boot
split, deferral choice, version branches and test cells, facade/accessor contract,
publish tags and migration ownership, discovery proof, and compatibility impact.

## Verification

- [ ] `register()` contains bindings/config merges; boot-time work is in `boot()`.
- [ ] Every deferred or version-conditional binding has a resolution test.
- [ ] Facade accessor, provider binding, Composer alias, and IDE hints agree.
- [ ] Published artifacts have deliberate tags and migration ownership.
- [ ] `composer validate --strict` and a fresh-consumer `package:discover` pass.
- [ ] The compatibility review covers route/config/migration/view/alias/provider names.

## References

- `references/authoring-patterns.md` — detailed provider, facade, matrix, publishing,
  discovery, and compatibility recipes; load only the relevant branch.
- `skills/composer-package-hygiene/SKILL.md` — package-level semver and manifest rules.
- `skills/laravel-testbench-matrix/SKILL.md` — per-major Testbench mechanics.
- `modules/laravel-N/skills/laravel-N-notes/SKILL.md` — version-specific framework facts.
