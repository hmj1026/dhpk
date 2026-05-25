---
name: matrix-cell-onboard
description: Checklist + procedure for adding a new PHP/Laravel/PHPUnit/Monolog cell to a multi-major library's CI matrix. Use when extending support to a new runtime version (e.g. "add PHP 8.3 + Laravel 12 to the matrix"), bumping a dep major (e.g. "Monolog 4 came out, plan the cell"), or restoring a previously dropped cell. Cross-checks `composer.json` constraints, `.github/workflows/*.yml` matrix rows, Testbench mapping for Laravel, and triggers a polyfill-coverage check for the new cell's dep versions. Pairs with the `laravel-testbench-matrix` skill (which covers per-cell Testbench install logic) and `composer-package-hygiene` (which covers the semver implication of raising the floor).
---

# Matrix cell onboard

Adding a new cell to a multi-major test matrix is more than appending one
YAML row. The cell only earns its keep when (1) `composer.json` can resolve
it, (2) every polyfill branch in `src/` that could fire for this cell has a
test, and (3) the Testbench / phpunit / monolog / meta-tags versions in the
new cell are mutually compatible.

This skill is a procedure, not an agent. Run it as a checklist.

---

## When to run

- Adding a new `php × <framework>` combination (e.g. PHP 8.3 + Laravel 12)
- Restoring a cell that was previously excluded (e.g. PHP 7.3 dropped, now
  needs to come back for a customer)
- A dep ships a new major (Monolog 4, Flysystem 4, PHPUnit 12) and you want
  to start exercising it before raising the floor

## When NOT to run

- Just bumping the patch version inside an existing cell (no matrix change)
- Adding a test file that runs on all existing cells (no matrix change)
- Removing a cell — use the symmetric "matrix cell retire" procedure
  (informal: same checklist in reverse)

---

## Inputs

You need the **proposed cell** as a tuple of pinned versions:

```yaml
php: "8.3"
laravel: "^12.0"
phpunit: "^11.0"
monolog: "^3.0"        # or ^4.0 if testing pre-release
meta-tags: "^4.0"      # if applicable
testbench: "^10.0"     # auto-derived from laravel, see step 3
```

If the user hands you only `php: 8.3, laravel: 12`, fill the rest from the
existing cell adjacency rules below before asking them.

---

## Procedure

### Step 1 — Verify composer.json can resolve the cell

For each dep in the proposed cell, check `composer.json`'s `require` (and
`require-dev`) constraint.

```bash
grep -E '"(php|laravel/framework|monolog/monolog|butschster/meta-tags|orchestra/testbench|phpunit/phpunit)"' composer.json
```

A constraint like `"php": "^7.3 || ^8.0"` admits 8.3. A constraint like
`"laravel/framework": "^6.0 || ... || ^11.0"` does NOT admit 12.0 — you
must extend it first.

**Output of step 1:** a per-dep list of `composer OK` or `composer NEEDS
EXTENSION: <current> → <proposed>`.

### Step 2 — Map the cell to the workflow YAML

```bash
ls .github/workflows/
# typically tests.yml or ci.yml
```

Read `strategy.matrix`. The matrix is either:

- **Cross-product style**: `matrix.php: [...]` × `matrix.laravel: [...]` with
  `exclude:` and `include:` modifiers.
- **Per-cell include style**: each cell is a fully-specified row under
  `include:`.

Devkit uses **per-cell include style** (every row pins all deps explicitly).
This is the safer style for multi-major libraries — there's no chance of an
accidental cross-product producing an impossible combination.

**Output of step 2:** the exact YAML block to append (one new entry under
`include:`), with all dep version pins filled.

### Step 3 — Derive the Testbench version (Laravel only)

Laravel and Testbench have a fixed mapping:

| Laravel | Testbench | PHPUnit min |
|---------|-----------|-------------|
| 6.x | 4.x | 8.x |
| 7.x | 5.x | 8.x |
| 8.x | 6.x | 9.x |
| 9.x | 7.x | 9.x |
| 10.x | 8.x | 10.x |
| 11.x | 9.x | 10.x / 11.x |
| 12.x | 10.x | 11.x |

If the user's proposed PHPUnit version is below the Laravel minimum, flag
the conflict before continuing. Defer to `laravel-testbench-matrix` skill
for per-cell Testbench install / boot scaffolding.

### Step 4 — Polyfill branch coverage for the new cell

For each runtime version guard in `src/`, ask: **does the new cell satisfy
the guard's condition or the fallback's?**

```bash
grep -rEn '(version_compare|class_exists|interface_exists|method_exists|InstalledVersions::satisfies|PHP_VERSION_ID)' src/
```

For each match:
- Identify the branch condition (e.g. "Monolog ≥ 3", "PHP ≥ 7.4").
- Check whether the new cell satisfies it.
- Confirm there's a test that exercises the **same** branch on a similar cell.

If the new cell would be the first to enter a branch that no other cell
enters, **add a test** before adding the cell. Otherwise the cell silently
documents-but-doesn't-prove the branch.

This step deliberately overlaps with the `polyfill-version-matrix-audit`
skill — call that skill if more than 3 guards need analysis.

### Step 5 — phpunit.xml testsuite gating

If the project has `testsuites: core + laravel` shape, confirm the new cell
runs **both** testsuites. Some CI setups gate `test:laravel` on `matrix.laravel
!= ''`, which would skip the new cell if `laravel` was passed as `null` or
omitted.

```bash
grep -A 5 'testsuites' phpunit.xml
```

### Step 6 — Dry-run locally if possible

```bash
composer require --dev "orchestra/testbench:<derived-version>" --no-update
composer update --prefer-lowest
composer test:unit
```

Roll back the composer.json change after the dry-run unless the cell is
being adopted permanently in the same PR.

---

## Output

A single onboarding report:

```markdown
## Matrix cell onboard: php=<v> laravel=<v> phpunit=<v>

### composer.json
- [x] php: <current> admits <new>  (no change)
- [ ] laravel/framework: <current> → needs `|| ^<new>`
- [x] monolog/monolog: <current> admits <new>
...

### .github/workflows/<file>.yml
Append to `strategy.matrix.include`:
```yaml
- php: '8.3'
  laravel: '^12.0'
  testbench: '^10.0'
  phpunit: '^11.0'
  monolog: '^3.0'
```

### Polyfill branches relevant to this cell
- Guard L42 `class_exists(\Monolog\LogRecord::class)` → cell enters
  Monolog 3 branch → test at `tests/Logging/MonologV3Test.php` covers it
- Guard L88 `version_compare(PHP_VERSION, '8.0', '>=')` → cell enters
  PHP 8.x branch → covered by existing PHP 8.0/8.1/8.2 cells
- NEW UNCOVERED BRANCH: none

### Testbench
Mapping table says Laravel 12 → Testbench 10. Add the cell with
`testbench: '^10.0'`.

### Open questions
- Is PHPUnit 12 desired? (Mapping admits ^11 or ^12 on Laravel 12)
```

---

## Common traps

- **Floor-raising disguised as cell add**: if adding the new cell requires
  bumping `"php": "^7.3 || ..."` to `"^7.4 || ..."`, that's a **major**
  semver bump for the library itself. Surface this loudly — see
  `composer-package-hygiene` skill for the decision tree.
- **Testbench in `require` instead of `require-dev`**: orchestra/testbench
  must be in `require-dev`. Some templates accidentally float it to require
  and break consumers' production installs.
- **Monolog auto-bump**: Laravel 10+ requires Monolog ^3. Adding a Laravel
  10+ cell with `monolog: ^2` will resolve to an empty intersection. The
  cell will fail at composer install, not at test time.
- **Meta-tags coupling**: `butschster/meta-tags ^3.0` is required on
  Laravel 11; older Laravels can run ^2.1. Check this dep specifically.

---

## Related skills

- `laravel-testbench-matrix` — per-cell Testbench install + DB config
- `composer-package-hygiene` — semver decision when raising the floor
- `polyfill-version-matrix-audit` — deep audit when step 4 surfaces gaps
