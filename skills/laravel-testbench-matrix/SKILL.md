---
name: laravel-testbench-matrix
description: Orchestra Testbench matrix mechanics for Laravel packages spanning multiple majors. Use when: choosing Testbench pins, defining PHP × Laravel cells, building the shared TestCase, provisioning per-cell databases, running prefer-lowest, or validating package discovery. Not for: single-major packages, application test suites, Laravel package authoring outside the matrix, or semver decisions. Output: a per-cell CI matrix, TestCase design, and evidence-backed test gate.
---

# Orchestra Testbench matrix

Use this skill when a package supports more than one Laravel major. Testbench boots a
Laravel application inside the package suite, but each Testbench major is tied to one
Laravel major; each cell needs its own dependency graph.

## Working sequence

1. Load `references/testbench-recipes.md` and confirm the Laravel/Testbench mapping
   against the cell's package metadata.
2. Build one matrix cell per supported Laravel major and exclude PHP versions below
   each framework floor.
3. Pin Laravel and Testbench with `composer require --no-update`, resolve a fresh
   cell graph, and run the suite.
4. Add the lowest-floor cell and a real-consumer package-discovery job.

## Branches

- Mapping or Composer install → `testbench-recipes.md` §Mapping and per-cell install.
- Shared provider/facade setup → §Abstract TestCase.
- SQLite/MySQL choice → §Database choices.
- Floor or discovery validation → §Floor and discovery cells.
- Failure triage → §Failure map.

## When NOT to Use

- A package targets a single Laravel major and needs no matrix.
- An application test suite that boots the real application instead of Testbench.
- Service-provider, facade, publishing, or discovery design outside Testbench setup;
  use `laravel-package-author`.
- Semver or dependency-floor decisions; use `composer-package-hygiene`.

## Output

Return a CI matrix with one supported Laravel cell, correct Testbench pins and PHP
excludes, a shared provider/facade-aware TestCase, a deliberate database strategy, a
`--prefer-lowest --prefer-stable` cell, and a consumer discovery job.

## Verification

- [ ] Every Laravel major has the Testbench version confirmed from package metadata.
- [ ] `composer require --no-update` and `composer update` resolve each cell without
  lock-state leakage.
- [ ] PHP × Laravel exclusions match framework minimums.
- [ ] The base TestCase registers provider, facade, environment, and migrations.
- [ ] Laravel 6/7 compatibility for `defineDatabaseMigrations()` is handled.
- [ ] SQLite/MySQL coverage matches the package's query and migration needs.
- [ ] A lowest-floor cell and a fresh-consumer `package:discover` job pass.

## References

- `references/testbench-recipes.md` — mapping, CI, TestCase, database, floor, discovery,
  and failure recipes; load only the branch being used.
- `skills/laravel-package-author/SKILL.md` — provider, facade, publishing, and package
  discovery design outside matrix mechanics.
- `skills/composer-package-hygiene/SKILL.md` — dependency and constraint hygiene.
