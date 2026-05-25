---
name: phpunit-10-notes
description: PHPUnit 10.x (February 2023) signature features and the breaking-change traps from 9 → 10. Use when writing or reviewing tests in a PHPUnit 10 project, or when migrating a PHPUnit 9 suite to 10. Covers PHP 8.1 floor, the attribute-style annotation system (#[DataProvider] / #[CoversClass] / #[Group] / #[Test]) that replaces (but does not yet remove) doc-comment annotations, the test runner CLI rewrite, TestListener removal, and the static-data-provider requirement. Pair with phpunit-9-modern for the API conventions that carry forward unchanged.
---

# PHPUnit 10 — attributes, PHP 8.1 floor, test runner rewrite

Released February 2023. **PHP 8.1+ floor** (not 8.0; this is a hard
install requirement). The big API shift is **PHP 8 attributes** for test
metadata.

> If you're on PHP 7.x or 8.0, PHPUnit 10 won't install. Stay on
> PHPUnit 9 until you can bump PHP. See the `phpunit-9-modern` skill
> for the latest version that works on 7.3+.

---

## Attribute-style annotations (the headline change)

Doc-comment annotations still work in 10 — but they're deprecated and
removed in 11. New tests should use attributes.

### Before (PHPUnit 9, still works in 10)

```php
/**
 * @dataProvider priceCases
 * @covers \App\Pricing\Calculator
 * @group pricing
 */
public function testWithTax(int $cents, int $expected): void
{
    self::assertSame($expected, (new Calculator)->withTax($cents));
}
```

### After (PHPUnit 10 preferred, mandatory in 11)

```php
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;

#[CoversClass(\App\Pricing\Calculator::class)]
final class CalculatorTest extends TestCase
{
    #[DataProvider('priceCases')]
    #[Group('pricing')]
    public function testWithTax(int $cents, int $expected): void
    {
        self::assertSame($expected, (new Calculator)->withTax($cents));
    }

    public static function priceCases(): \Generator
    {
        yield 'free'    => [0,    0];
        yield 'taxable' => [1000, 1100];
    }
}
```

### Full attribute set (most common)

| Attribute | Replaces |
|---|---|
| `#[Test]` | `@test` (test-method marker without `test*` prefix) |
| `#[DataProvider('method')]` | `@dataProvider method` |
| `#[DataProviderExternal(Class::class, 'method')]` | (new — cross-class provider) |
| `#[CoversClass(Foo::class)]` | `@covers \Foo` (CovesClass enforces class-level only) |
| `#[CoversNothing]` | `@coversNothing` |
| `#[UsesClass(Foo::class)]` | `@uses \Foo` |
| `#[Group('slow')]` | `@group slow` |
| `#[TestDox('Calculates tax for $cents cents')]` | `@testdox …` |
| `#[Depends('testFoo')]` | `@depends testFoo` |
| `#[DependsExternal(Class::class, 'testFoo')]` | (new) |
| `#[BackupGlobals(true)]` | `@backupGlobals` |
| `#[RunInSeparateProcess]` | `@runInSeparateProcess` |
| `#[RunTestsInSeparateProcesses]` | `@runTestsInSeparateProcesses` |
| `#[PreserveGlobalState(false)]` | `@preserveGlobalState false` |
| `#[RequiresPhp('>= 8.1')]` | `@requires PHP >= 8.1` |
| `#[RequiresPhpunit('>= 10')]` | `@requires PHPUnit >= 10` |
| `#[RequiresOperatingSystem('Linux')]` | `@requires OS Linux` |

`use PHPUnit\Framework\Attributes\…` — each attribute has its own FQCN
under `PHPUnit\Framework\Attributes`.

---

## Data providers must be `static` (warning in 10, error in 11)

```php
// 10: warning if non-static
public function priceCases(): array { /* ... */ }   // ⚠ DeprecationWarning

// 10/11: static required
public static function priceCases(): array { /* ... */ }
```

PHPUnit no longer instantiates the test class to call the data provider
when it's static (significant memory savings on large suites). Make
providers static when migrating.

---

## Test runner CLI rewrite

The CLI was rewritten in 10 for performance + extensibility. User-facing
changes:

- **`--testdox-html` / `--testdox-text` removed** — use `--log-junit`
  or new `--log-events-text` instead
- **`--testdox` flag works differently** — now controls only the
  formatter, not output destination
- **Custom printers** (`--printer ClassName`) removed entirely — use
  the new "Event subscriber" extension API instead

If your `phpunit.xml` uses `<printerClass>` or `<testdoxHtml*>`, those
config elements no longer exist in 10. Migration: remove them; if you
need TestDox HTML output, install `phpunit/phpunit-testdox-html` (a
separate package now).

---

## TestListener removed

The `TestListener` interface was deprecated in PHPUnit 8, marked for
removal in 9, and **fully removed in 10**. The replacement (since
PHPUnit 8 / 9) is the hooks API:

```xml
<extensions>
    <bootstrap class="MyExtension" />
</extensions>
```

…with the class implementing `\PHPUnit\Runner\Extension\Extension` and
subscribing to events. See PHPUnit 10 docs for the event types.

If you have a 9.x project using `TestListener`, port to the hooks API
before bumping to 10.

---

## phpunit.xml schema changes

PHPUnit 10's `phpunit.xml` schema dropped several attributes and added
new ones:

| Removed | Replacement |
|---|---|
| `convertDeprecationsToExceptions` | (always true now — no opt-out) |
| `convertNoticesToExceptions` | (always true now) |
| `convertWarningsToExceptions` | (always true now) |
| `forceCoversAnnotation` | `requireCoverageMetadata` (and use `#[CoversClass]`) |
| `<testsuites>` `printerClass` attribute | removed |
| `cacheTokens` | removed |

Run `vendor/bin/phpunit --migrate-configuration` to auto-port an old
`phpunit.xml`. Verify the result by eye — the migration tool is
conservative but not exhaustive.

---

## Migration checklist (9 → 10)

- [ ] PHP floor bumped to 8.1+ in `composer.json` (`"php": "^8.1"`)
- [ ] PHPUnit constraint `"phpunit/phpunit": "^10.0"`
- [ ] Data providers made `static`
- [ ] `vendor/bin/phpunit --migrate-configuration` run; `phpunit.xml.bak`
      reviewed and deleted
- [ ] `TestListener` implementations ported to event subscribers
- [ ] Custom `Printer` classes removed (or use event subscribers)
- [ ] Optional: start migrating annotations → attributes (mandatory in 11)

---

## Cross-references

- `modules/phpunit-9/skills/phpunit-9-modern/SKILL.md` — what's
  unchanged (assertion API, expectException* method, mock idioms)
- `modules/phpunit-11/skills/phpunit-11-notes/SKILL.md` — the next
  version completes the doc-comment annotation removal
- `modules/php-8.x/skills/php-8x-features/SKILL.md` — attributes
  syntax + 8.1 features that PHPUnit 10's floor unlocks
- `skills/laravel-testbench-matrix/SKILL.md` — testbench cells for
  PHPUnit 10 require Orchestra Testbench 8.x or later
