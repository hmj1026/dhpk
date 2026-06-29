---
name: phpunit-11-notes
description: PHPUnit 11.x (February 2024) signature features and the breaking-change traps from 10 → 11. Use when writing or reviewing tests in a PHPUnit 11 project, or when migrating a PHPUnit 10 suite to 11. Covers PHP 8.2 floor, the deprecation of doc-comment annotations (removed in 12; PHP 8 attributes are the recommended path), assertObjectHasProperty replacing assertObjectHasAttribute, the static-data-provider hard requirement, and the test-name discovery changes. Not for everyday assertion writing or PHP < 8.2 projects (stay on phpunit-10-notes). Output: a 10 → 11 migration plan.
---

# PHPUnit 11 — annotations deprecated (removed in 12), PHP 8.2 floor

Released February 2024. **PHP 8.2+ floor**. The big change from 10:
**doc-comment annotations are deprecated** — they still work in 11 but
emit a deprecation warning, and support will be **removed in PHPUnit
12**, where PHP 8 attributes become the only path.

> If you're on PHPUnit 10/11 with doc-comment annotations, migrate to
> attributes *before* bumping to 12. The migration is mechanical and
> can be automated; doing it during 11 silences the deprecation
> warnings. Skipping it until 12 produces silent test loss
> (annotations are removed → ignored → providers don't run → "0 tests").

---

## Doc-comment annotations: deprecated in 11, removed in 12

Every annotation listed in the phpunit-10-notes skill's attribute
table is **deprecated** in 11. The `@dataProvider`, `@covers`,
`@group`, `@depends`, `@requires` and friends still work in 11 but
emit a deprecation warning; support is **removed in 12**, after which
they do nothing.

```php
// 10 (deprecated): annotation works
/** @dataProvider priceCases */
public function testWithTax($cents, $expected) { /* ... */ }

// 11 (still works, emits a deprecation warning)
/** @dataProvider priceCases */
public function testWithTax($cents, $expected) { /* ... */ }

// 11+ recommended (12 only): attribute, no deprecation warning
#[DataProvider('priceCases')]
public function testWithTax(int $cents, int $expected): void { /* ... */ }
```

Migrating to attributes during 11 silences the deprecation warnings;
do it **before** PHPUnit 12, where the annotations stop working and a
missing provider means the test silently runs with no data.

### Migration grep

Before bumping:

```bash
grep -rEn '@(dataProvider|covers|coversNothing|uses|group|depends|requires|testdox|backupGlobals|runInSeparateProcess|preserveGlobalState)' tests/
```

Each match needs an attribute conversion. PHPUnit's official
`vendor/bin/phpunit --migrate-configuration` doesn't touch test source
code — only `phpunit.xml`. For test source migration, use either:

- The `rector/rector` ruleset `PHPUnitLevelSetList::UP_TO_PHPUNIT_100`
  (yes, the rule is named for 10, but it covers the same annotations →
  attribute conversion 11 needs)
- A hand-edited search-and-replace using the table from
  `phpunit-10-notes` skill

---

## `assertObjectHasAttribute` removed → `assertObjectHasProperty`

```php
// 10 (deprecated): worked but already misnamed
self::assertObjectHasAttribute('id', $user);

// 11 (only path): renamed
self::assertObjectHasProperty('id', $user);
```

The old name was confusing because "attribute" now also refers to PHP
8 attributes (`#[…]`). The rename clarifies that this assertion checks
for an object **property**.

Similarly: `assertObjectNotHasAttribute` → `assertObjectNotHasProperty`.

---

## Data providers: static is mandatory

In PHPUnit 10 non-static providers produced a deprecation warning. In
11 they're an error:

```php
// 11: this fails the test
public function priceCases(): array { /* ... */ }

// 11: required
public static function priceCases(): array { /* ... */ }
```

---

## Test discovery: attribute-driven recommended

```php
// 11: this is NOT discovered as a test (no `test` prefix, no @test, no #[Test])
public function calculatesWithTax(): void { /* ... */ }   // ❌

// 11: discovered (test* prefix)
public function testCalculatesWithTax(): void { /* ... */ }   // ✓

// 11: discovered (attribute — recommended, no deprecation warning)
#[Test]
public function calculatesWithTax(): void { /* ... */ }   // ✓
```

In 11 the `@test` annotation still triggers discovery, but it is
deprecated and emits a warning; discovery via the `#[Test]` attribute
is recommended. `@test` stops working in PHPUnit 12. If your project
preferred annotation-driven naming (`calculatesWithTax()` with
`/** @test */`), add `#[Test]` everywhere before bumping to 12.

---

## Return type declarations everywhere

PHPUnit 11's own framework code added return type declarations to
every public method. If your test classes override or extend framework
classes (custom `TestCase` base classes, custom assertion traits),
your overrides must match the new signatures or PHP throws a fatal
`ReturnTypeWillChange` error.

Audit:

```bash
grep -rEn 'extends (TestCase|.*PHPUnit)' tests/ src/
```

Each match should have its public method signatures cross-checked
against PHPUnit 11's source.

---

## phpunit.xml changes

Run the migration tool:

```bash
vendor/bin/phpunit --migrate-configuration
```

Notable removals in 11:

- `<coverage processUncoveredFiles="true">` removed — always behaves
  as if true (with new opt-out semantics)
- `cacheResultFile` attribute moved to `<source>` element
- `<extensions>` schema tightened — extension class must implement
  the new `Extension` interface (introduced in 10, enforced in 11)

---

## Migration checklist (10 → 11)

- [ ] PHP floor bumped to 8.2+ in `composer.json` (`"php": "^8.2"`)
- [ ] PHPUnit constraint `"phpunit/phpunit": "^11.0"`
- [ ] All doc-comment annotations converted to attributes (rector
      ruleset or hand-edit; verify with the migration grep above)
- [ ] Test classes without `test*` prefix on method names: add
      `#[Test]` attribute
- [ ] Data providers all `static`
- [ ] `assertObjectHasAttribute` → `assertObjectHasProperty`
- [ ] Custom `TestCase` base classes: signatures match 11's typed
      methods
- [ ] `phpunit.xml` migrated; review the diff

---

## When NOT to Use

- PHP 8.0 / 8.1 projects — PHPUnit 11 requires 8.2; use `phpunit-10-notes`.
- Suites still relying on doc-comment annotations you can't yet convert — finish the attribute migration first.
- Everyday assertion writing — load only when migrating 10 → 11.

## Output

- A 10 → 11 migration plan: all doc-comment annotations converted to attributes, `assertObjectHasAttribute` → `assertObjectHasProperty`, `#[Test]` added where the `test*` prefix is absent, and `static` data providers.
- Per the migration checklist above, each unchecked box is a TODO before bumping the PHPUnit constraint to `^11.0`.

## Cross-references

- `modules/phpunit-10/skills/phpunit-10-notes/SKILL.md` — the
  attribute table that this version makes mandatory
- `modules/phpunit-9/skills/phpunit-9-modern/SKILL.md` — assertion API
  - mock idioms that carry forward unchanged
- `modules/php-8.x/skills/php-8x-features/SKILL.md` — `readonly`
  classes + DNF types that PHPUnit 11's 8.2 floor unlocks
- `skills/laravel-testbench-matrix/SKILL.md` — testbench cells for
  PHPUnit 11 require Orchestra Testbench 9.x+
