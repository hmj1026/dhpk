# Library dual-testsuite map

A library that supports multiple framework majors typically splits its
source into:

```
src/
├── Core/             # framework-agnostic — no Illuminate / Symfony imports
└── <Framework>/      # glue layer — pulls in container, facades, etc.
```

And mirrors the split in tests:

```
tests/
├── Core/             # boots no container
└── <Framework>/      # boots Testbench / Symfony Kernel / etc.
```

The phpunit.xml declares both as testsuites:

```xml
<testsuites>
  <testsuite name="core"><directory>tests/Core</directory></testsuite>
  <testsuite name="laravel"><directory>tests/Laravel</directory></testsuite>
</testsuites>
```

And composer.json exposes them as scripts:

```json
"scripts": {
  "test:core":    "phpunit --testsuite=core",
  "test:laravel": "phpunit --testsuite=laravel",
  "test:unit":    ["@test:core", "@test:laravel"]
}
```

**The skill:** given an edited file path, tell the developer which
testsuite to run (or both).

---

## When to run

- After editing any `src/**` file
- After editing any `tests/**` file
- When the user asks "which tests should I run?"

## When NOT to Use

- Projects with a single testsuite — this skill has nothing to do
- E2E / integration tests in a separate dir (e.g. `tests/Integration/`)
  that runs in CI but not locally

---

## Decision rules

Read `phpunit.xml` for the testsuite-to-directory mapping. Then apply:

| Edit location | Run |
|---------------|-----|
| `src/Core/**` only | `composer test:core` |
| `src/Laravel/**` (or other framework dir) only | `composer test:laravel` |
| Both Core and framework dirs | `composer test:unit` (= both suites) |
| `tests/Core/**` only | `composer test:core` |
| `tests/Laravel/**` only | `composer test:laravel` |
| `src/Core/<X>` + `tests/Laravel/<X>` (cross-layer) | `composer test:unit` — and ask why a Core class needs a Laravel-only test (smell) |
| `phpunit.xml` or `composer.json` | `composer test:unit` (config touched, run everything) |

---

## Cross-layer smell rules

The Core layer must NOT import Illuminate / Symfony classes. If a Core
file's `use` statements include framework-namespace symbols, that's a
**boundary violation**, not just a testsuite question. Flag it
separately:

```bash
grep -E '^use\s+Illuminate\\\\|^use\s+Symfony\\\\' src/Core/**/*.php
```

Symmetric: framework glue can freely import from Core. That's the intent.

---

## Output

```
Edit: <path>
Suite: composer test:core   |   composer test:laravel   |   composer test:unit
Reason: <one-liner>

Cross-layer flag (if applicable):
  WARN: src/Core/<X> imports Illuminate\<Y> — Core must not depend on framework
```

When the answer is `test:unit`, prefer running both suites separately in
sequence rather than `test:unit` as one shot — the failure attribution is
clearer.

---

## Verification

- [ ] Read `phpunit.xml` for the actual testsuite→directory mapping (don't assume).
- [ ] Suite choice matches the edit location per the decision table.
- [ ] `test:unit` edits run each suite separately for clear failure attribution.
- [ ] Core files import no `Illuminate\` / `Symfony\` symbols (boundary grep ran).

---

## Examples

**Edited file:** `src/Core/Storage/LocalDriver.php`
**Suite:** `composer test:core`
**Reason:** Core-only edit; Laravel suite would test the same logic
indirectly through the glue layer but the failure would be misattributed.

**Edited files:** `src/Core/Search/Index.php` + `src/Laravel/Search/IndexFacade.php`
**Suite:** `composer test:unit` (= both)
**Reason:** Core change may flow through to the facade. Run both to
attribute any failure to the correct layer.

**Edited file:** `phpunit.xml`
**Suite:** `composer test:unit`
**Reason:** Config change affects every suite; full run is the only safe
baseline.

---

## Related skills

- `$library-author polyfill-audit` — version-branch-level coverage (this
  skill is directory-level)
- `$library-author testbench` — per-cell Testbench install (cross-skill
  with this one when adding a new cell)
