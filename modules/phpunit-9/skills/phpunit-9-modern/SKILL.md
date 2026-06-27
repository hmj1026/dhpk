---
name: phpunit-9-modern
description: PHPUnit 8.5 → 9.x modern test patterns. Use when writing or reviewing tests on PHPUnit 8.5+ or 9.x, migrating tests from PHPUnit 5/6/7 conventions, adding type declarations to test methods, picking between assertSame / assertEquals / assertIsXxx, designing data providers, or removing deprecated APIs (ProphecyTestCase, TestListener, @expectedException). Counterpart to the phpunit-5.7 module (older API). Not for everyday assertion writing — load when reviewing test discipline, planning a PHPUnit upgrade, designing per-test fixtures, or picking a mock style.
---

# PHPUnit 8.5 / 9.x — modern API

This skill covers the API consolidation that landed in PHPUnit 8.0 +
9.0. If you're upgrading from PHPUnit 5/6/7 conventions, also consult
the `phpunit-5.7` module's skill for what's being left behind.

> Version target: 8.5 (the LTS-style 8-line release) → 9.6 (final 9.x
> minor). Both versions support PHP 7.3+. PHPUnit 10 requires PHP 8.1+
> and PHPUnit 11 requires 8.2+ — separate future modules.

---

## `void` return type on test methods (PHPUnit 8.0+)

```php
final class OrderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->order = new Order(/* ... */);
    }

    public function testTotalIncludesTax(): void
    {
        self::assertSame(110, $this->order->totalWithTax());
    }
}
```

PHPUnit 8.0 added `void` return types to *all* template methods —
`setUp()`, `tearDown()`, `setUpBeforeClass()`, `tearDownAfterClass()`.
**A class extending TestCase without `void` on these methods produces a
deprecation warning in 8.x and an error in 9.x.**

Your own test methods don't strictly need `void`, but the convention
since 8.0 is to add it (test methods don't return anything meaningful).

### Static lifecycle methods

```php
public static function setUpBeforeClass(): void { /* ... */ }
public static function tearDownAfterClass(): void { /* ... */ }
```

These were re-typed in PHPUnit 8 with explicit `static` + `void`.
Inherited classes need to match the signature exactly.

---

## `expectException*()` API (PHPUnit 8.0+, mandatory in 9.0+)

```php
// Old (PHPUnit ≤7, removed in 9.0):
/**
 * @expectedException InvalidArgumentException
 * @expectedExceptionMessage Invalid customer ID
 * @expectedExceptionCode 42
 */
public function testRejectsInvalidId() { /* ... */ }

// New (PHPUnit 8.0+, only path in 9.0+):
public function testRejectsInvalidId(): void
{
    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Invalid customer ID');
    $this->expectExceptionCode(42);

    $this->service->resolve('bad-id');
}
```

The `@expected*` annotations were deprecated in PHPUnit 8 and **removed
in PHPUnit 9**. A migration grep:

```bash
grep -rn '@expectedException' tests/
```

…should be empty before bumping to 9.0.

### Trap: assertion-before-throw

```php
// WRONG — assertions before the throw don't run
public function testThrows(): void
{
    $this->expectException(\RuntimeException::class);
    self::assertSame('expected', $this->subject->setup());  // runs
    $this->subject->trigger();                              // throws
    self::assertTrue($somethingAfter);                      // NEVER RUNS
}
```

Anything after the throwing call is unreachable. Split into two tests if
you need both the assertion *and* the throw verification.

---

## `assertIsXxx()` family (PHPUnit 8.0+)

```php
// Old (deprecated in 8, removed in 9):
self::assertInternalType('array',  $result);
self::assertInternalType('string', $name);
self::assertInternalType('int',    $count);

// New:
self::assertIsArray($result);
self::assertIsString($name);
self::assertIsInt($count);
```

Full set: `assertIs{Array,Bool,Float,Int,Numeric,Object,Resource,String,Scalar,Callable,Iterable}`
plus the negated `assertIsNot{...}` variants.

The migration is purely mechanical — `assertInternalType('TYPE', $x)`
becomes `assertIs<Camel(TYPE)>($x)`. Many IDEs can autofix.

---

## Data providers (PHPUnit 9.0+ refinements)

### Generator-style data providers

```php
public static function priceCases(): \Generator
{
    yield 'free'    => [0,    0];
    yield 'one_dollar' => [100,  110];
    yield 'taxable' => [1000, 1100];
}

/**
 * @dataProvider priceCases
 */
public function testWithTax(int $cents, int $expected): void
{
    self::assertSame($expected, (new Price($cents))->withTax());
}
```

`@dataProvider` accepts a generator-returning method since PHPUnit 6;
the convention since 9 is to **make the provider static** (avoids
constructing the test class just to call the data provider). PHPUnit 10+
warns when provider is not static.

### Named datasets

The `'free' => [...]` keys above become the test name suffix in output:
`testWithTax with data set "free"`. Named datasets make failure output
readable — prefer them over numeric indices.

---

## Mocking — `createMock()` is the way

```php
// Preferred (since PHPUnit 5, still preferred in 8/9):
$gateway = $this->createMock(Gateway::class);
$gateway->method('send')
    ->willReturn(new Response(200, 'OK'));

// Avoid: getMockBuilder() — verbose for simple cases
$gateway = $this->getMockBuilder(Gateway::class)
    ->disableOriginalConstructor()
    ->getMock();
```

Use `getMockBuilder()` only when you need its specific options
(`->setConstructorArgs()`, `->setMethods()` — the latter is itself
deprecated in 8 in favor of `onlyMethods()` + `addMethods()`).

### Built-in Prophecy deprecated in 9.x, removed in 10.0

The built-in `$this->prophesize()` on `TestCase` is deprecated in
PHPUnit 9.x and removed in 10.0. Migrate before upgrading to 10:

```php
// Old (Prophecy):
$gateway = $this->prophesize(Gateway::class);
$gateway->send(Argument::any())->willReturn(new Response);

// New (built-in mocks):
$gateway = $this->createMock(Gateway::class);
$gateway->method('send')
    ->with($this->anything())
    ->willReturn(new Response);
```

Or install `phpspec/prophecy-phpunit` to keep using Prophecy alongside
PHPUnit 9 (it provides a `ProphecyTrait` you `use` in your test class).

---

## TestListener → hooks API (PHPUnit 9.0+)

```xml
<!-- Old phpunit.xml (PHPUnit ≤8) -->
<listeners>
    <listener class="MyTestListener" />
</listeners>
```

`TestListener` interface was deprecated in 7.3 (superseded by the hooks API) and removed in 10. The
replacement is the hooks API in `phpunit.xml`:

```xml
<extensions>
    <extension class="MyHook" />
</extensions>
```

…with the class implementing one or more of:

- `BeforeFirstTestHook`, `AfterLastTestHook`
- `BeforeTestHook`, `AfterTestHook`
- `BeforeTestSuiteHook`, `AfterTestSuiteHook`
- `TestHook` (catch-all)
- `BeforeRiskyTestHook`, `BeforeIncompleteTestHook`, `BeforeSkippedTestHook`

Each hook receives a single argument describing what happened. Smaller,
typed, easier to test than the legacy listener.

---

## Risky test detection

PHPUnit 8/9 strict-mode flags various "risky" patterns. Common ones:

| Risky pattern | Why | Fix |
|---|---|---|
| Test doesn't assert anything | Silent green — bug becomes test infra problem | Add at least `self::assertTrue(true)` (last resort), or remove |
| Test changes global state without restoring | Bleeds into next test | Use `@backupGlobals enabled` or restore in `tearDown()` |
| Test calls `print` / `echo` | Pollutes output | Use `$this->expectOutputString()` / capture instead |
| Test uses `@covers` annotation but no `@covers` target | Annotation lies | Remove or fix |

Enable in `phpunit.xml`:

```xml
<phpunit
    beStrictAboutOutputDuringTests="true"
    beStrictAboutTestsThatDoNotTestAnything="true"
    beStrictAboutChangesToGlobalState="true"
    failOnRisky="true"
    failOnWarning="true">
```

Worth turning on per-suite when introducing the module to a new
project; existing untyped suites will surface a backlog.

---

## Common 5/6/7 → 8/9 migration grep

Before bumping to 9.0, scan for removed APIs:

```bash
# Removed annotations
grep -rn '@expectedException' tests/
grep -rn '@expectedExceptionMessage' tests/
grep -rn '@expectedExceptionCode' tests/

# Removed methods
grep -rn 'assertInternalType' tests/
grep -rn 'assertAttributeEquals\|assertAttributeSame\|assertAttribute' tests/
grep -rn '::readAttribute\|getObjectAttribute\|getStaticAttribute' tests/

# Removed base classes
grep -rn 'ProphecyTestCase' tests/

# Deprecated XML config
grep -n 'TestListener\|<listener ' phpunit.xml*
```

Each non-empty result is a TODO before the bump.

---

## When NOT to Use

- Everyday assertion writing — load only when reviewing test discipline, planning an upgrade, or picking a mock/provider style.
- A PHPUnit 5/6/7 codebase you can't bump — use the `phpunit-5.7` module instead.
- A PHPUnit 10 or 11 project — use `phpunit-10-notes` / `phpunit-11-notes` for the attribute system and later removals.

## Output

- Tests using `void` template-method signatures, `expectException*()` methods, the `assertIsXxx()` family, and static named data providers.
- A pre-bump migration report: every `grep` in the migration section that returns matches is a TODO before tagging 9.0.

## Verification

- [ ] `grep -rn '@expectedException' tests/` is empty
- [ ] `grep -rn 'assertInternalType\|ProphecyTestCase' tests/` is empty
- [ ] `setUp()` / `tearDown()` / static lifecycle methods declare `: void`
- [ ] Data providers are `static` and use named datasets
- [ ] No `TestListener` in `phpunit.xml` (ported to the hooks API)

## When to load related material

| When… | Where |
|---|---|
| Working on a PHPUnit 5/6/7 codebase you can't bump | `modules/phpunit-5.7/skills/legacy-code-characterization/SKILL.md` |
| Writing a Laravel package's test suite spanning multiple Laravel versions | `skills/laravel-package-author/SKILL.md` (Orchestra Testbench setup section) |
| Picking between `assertSame` and `assertEquals` — and why strict-equals matters | use `assertSame` for scalars/identity to avoid type-juggling false passes; reserve `assertEquals` for intentional loose value comparison |
| Coverage requirements + FIRST principles + bad-test patterns | `~/.claude/rules/common/testing.md` (project-level rule shared across stacks) |
