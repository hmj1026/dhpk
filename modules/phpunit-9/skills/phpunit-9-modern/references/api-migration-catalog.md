# PHPUnit 8.5 / 9.x API migration catalog

This catalog is the detailed reference for
`modules/phpunit-9/skills/phpunit-9-modern/SKILL.md`. It covers the API
consolidation from PHPUnit 5/6/7 conventions through PHPUnit 8.5 and 9.6.
Both target versions support PHP 7.3+. PHPUnit 10 requires PHP 8.1+ and
PHPUnit 11 requires PHP 8.2+; use their dedicated modules for those upgrades.

## `void` lifecycle and test methods

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

PHPUnit 8 added `void` to `setUp()`, `tearDown()`,
`setUpBeforeClass()`, and `tearDownAfterClass()`. Missing `void` produces a
deprecation in 8.x and an error in 9.x. Static lifecycle methods must also
retain `static` and match the inherited signature.

## `expectException*()` and the assertion-before-throw trap

```php
public function testRejectsInvalidId(): void
{
    $this->expectException(\InvalidArgumentException::class);
    $this->expectExceptionMessage('Invalid customer ID');
    $this->expectExceptionCode(42);

    $this->service->resolve('bad-id');
}
```

`@expectedException`, `@expectedExceptionMessage`, and
`@expectedExceptionCode` were deprecated in 8 and removed in 9. Before the
bump, scan with:

```bash
grep -rn '@expectedException' tests/
```

Register the exception immediately before the call expected to throw. Code
after that call is unreachable, so split a test when it also needs to assert
the setup or returned value.

## `assertIsXxx()` family

```php
self::assertIsArray($result);
self::assertIsString($name);
self::assertIsInt($count);
```

Replace the removed `assertInternalType('array', $result)` family with
`assertIsArray`, `assertIsBool`, `assertIsFloat`, `assertIsInt`,
`assertIsNumeric`, `assertIsObject`, `assertIsResource`, `assertIsString`,
`assertIsScalar`, `assertIsCallable`, or `assertIsIterable`, including the
corresponding `assertIsNot...` variants.

## Data providers

```php
public static function priceCases(): \Generator
{
    yield 'free' => [0, 0];
    yield 'one_dollar' => [100, 110];
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

Generator providers are supported from PHPUnit 6; PHPUnit 9's convention is
to make providers static so the test class is not constructed just to call
the provider. Named dataset keys make failure output readable. PHPUnit 10+
warns about non-static providers.

## Mocking and Prophecy

```php
$gateway = $this->createMock(Gateway::class);
$gateway->method('send')
    ->willReturn(new Response(200, 'OK'));
```

Prefer `createMock()` for simple cases. Use `getMockBuilder()` only for
specific options such as constructor arguments; prefer `onlyMethods()` and
`addMethods()` over the deprecated `setMethods()`.

The built-in `$this->prophesize()` is deprecated in PHPUnit 9 and removed in
10. Migrate to built-in mocks or install `phpspec/prophecy-phpunit` and use
its `ProphecyTrait` while the project remains on PHPUnit 9.

## TestListener to hooks

```xml
<!-- Old -->
<listeners>
    <listener class="MyTestListener" />
</listeners>

<!-- New -->
<extensions>
    <extension class="MyHook" />
</extensions>
```

`TestListener` was deprecated in 7.3 and removed in 10. The hooks API uses
focused interfaces such as `BeforeFirstTestHook`, `AfterLastTestHook`,
`BeforeTestHook`, `AfterTestHook`, `BeforeTestSuiteHook`,
`AfterTestSuiteHook`, `BeforeRiskyTestHook`, `BeforeIncompleteTestHook`, and
`BeforeSkippedTestHook`.

## Risky-test detection

| Risky pattern | Why | Fix |
|---|---|---|
| No assertion | Silent green | Add a meaningful assertion or remove the test |
| Global state changed | State bleeds into later tests | Restore it or use `@backupGlobals enabled` |
| `print` / `echo` | Pollutes output | Use expected-output assertions or capture output |
| Incorrect `@covers` | Coverage claim is false | Remove or correct the target |

```xml
<phpunit
    beStrictAboutOutputDuringTests="true"
    beStrictAboutTestsThatDoNotTestAnything="true"
    beStrictAboutChangesToGlobalState="true"
    failOnRisky="true"
    failOnWarning="true">
</phpunit>
```

Enable strictness per suite when introducing the module; an existing untyped
suite may expose a backlog rather than a clean first run.

## Pre-bump migration scan

```bash
# Removed annotations
grep -rn '@expectedException' tests/
grep -rn '@expectedExceptionMessage' tests/
grep -rn '@expectedExceptionCode' tests/

# Removed methods
grep -rn 'assertInternalType' tests/
grep -rn 'assertAttributeEquals\|assertAttributeSame\|assertAttribute' tests/
grep -rn '::readAttribute\|getObjectAttribute\|getStaticAttribute' tests/

# Removed base classes and deprecated XML config
grep -rn 'ProphecyTestCase' tests/
grep -n 'TestListener\|<listener ' phpunit.xml*
```

Every non-empty result is a migration TODO before tagging PHPUnit 9.
