# PHP testing quality

Use this reference after the PHP runtime and framework route has been selected. It covers test quality; it does not select or broaden a framework route or replace the dedicated legacy PHP 5.6 Yii route. Keep each recommendation within the actual PHP runtime, framework, test runner, and configured test command.

## Confirm the runtime and test runner

**Trigger:** A test recommendation depends on PHP syntax, framework behavior, a PHPUnit API, a static-analysis tool, or an extension.

**Check and act:** Inspect the PHP executable used by the project test command and CI, the declared PHP floor, Composer constraints and lockfile, the installed framework and test-runner versions, runner configuration, and required extensions. A Composer lockfile records resolved package versions, while Composer’s platform setting can emulate a PHP or extension version; verify the actual runtime separately before relying on either value. [Composer lockfiles](https://getcomposer.org/doc/01-basic-usage.md#installing-dependencies), [Composer platform configuration](https://getcomposer.org/doc/06-config.md#platform)

**Do not apply when:** The change does not depend on runtime, framework, runner, or extension behavior. When evidence conflicts or a version cannot be confirmed, mark it NOT VERIFIED and avoid version-specific advice.

## Test observable behavior

**Trigger:** A change affects a caller-visible result, validation outcome, exception, persistence effect, route response, or resource access.

**Check and act:** Derive expected outcomes from the established contract. Cover representative success and rejection or error cases; use separate tests when setup or expected behavior differs, and a data provider when the same assertion should run over distinct inputs. Assert values and effects callers can observe, not only a helper call or implementation detail.

**Do not apply when:** The change is non-behavioral or an existing contract already proves the affected outcome. Do not invent requirements or a universal test-count or coverage target.

## Use a dependency seam for isolated unit tests

**Trigger:** A unit under test depends on a repository, gateway, clock, transport, or other replaceable collaborator.

**Check and act:** Inject the dependency through a small interface or constructor seam and supply a deterministic fake with controlled success and failure values. The complete example below uses PHPUnit 5.7-era APIs and PHP 5.6 syntax: public test methods, expectException(), and a public @dataProvider method are documented in the official 5.7 manual. Use this example only on a confirmed compatible legacy path; it does not identify the runner configured by another project. [PHPUnit 5.7: writing tests](https://phpunit.de/manual/5.7/en/writing-tests-for-phpunit.html#writing-tests-for-phpunit.data-providers), [PHPUnit 5.7: testing exceptions](https://phpunit.de/manual/5.7/en/writing-tests-for-phpunit.html#writing-tests-for-phpunit.exceptions)

```php
<?php
use PHPUnit\Framework\TestCase;

interface PriceCatalog
{
    public function priceFor($sku);
}

class QuoteService
{
    private $catalog;

    public function __construct(PriceCatalog $catalog)
    {
        $this->catalog = $catalog;
    }

    public function quote($sku)
    {
        if (!is_string($sku) || trim($sku) === '') {
            throw new InvalidArgumentException('SKU must not be empty');
        }

        $price = $this->catalog->priceFor($sku);
        if (!is_int($price) || $price < 0) {
            throw new UnexpectedValueException('Catalog returned an invalid price');
        }

        return $price;
    }
}

class FakePriceCatalog implements PriceCatalog
{
    private $price;
    private $failure;
    private $lastSku;

    public function __construct($price, $failure = null)
    {
        $this->price = $price;
        $this->failure = $failure;
        $this->lastSku = null;
    }

    public function priceFor($sku)
    {
        $this->lastSku = $sku;
        if ($this->failure !== null) {
            throw $this->failure;
        }

        return $this->price;
    }

    public function lastSku()
    {
        return $this->lastSku;
    }
}

class QuoteServiceTest extends TestCase
{
    public function testReturnsCatalogPrice()
    {
        $catalog = new FakePriceCatalog(499);
        $service = new QuoteService($catalog);

        $this->assertSame(499, $service->quote('SKU-1'));
        $this->assertSame('SKU-1', $catalog->lastSku());
    }

    public function testRejectsEmptySku()
    {
        $service = new QuoteService(new FakePriceCatalog(499));

        $this->expectException(InvalidArgumentException::class);
        $service->quote('');
    }

    /**
     * @dataProvider invalidPrices
     */
    public function testRejectsInvalidCatalogPrice($price)
    {
        $service = new QuoteService(new FakePriceCatalog($price));

        $this->expectException(UnexpectedValueException::class);
        $service->quote('SKU-1');
    }

    public function invalidPrices()
    {
        return array(
            array(-1),
            array('499'),
            array(null)
        );
    }

    public function testPropagatesCatalogFailure()
    {
        $catalog = new FakePriceCatalog(0, new RuntimeException('catalog unavailable'));
        $service = new QuoteService($catalog);

        $this->expectException(RuntimeException::class);
        $service->quote('SKU-1');
    }
}
?>
```

The PHPUnit 5.7 command-line runner accepts a test class and optional source file, but a project may require its configured bootstrap, XML settings, or wrapper command. Run this example through the project’s actual runner invocation after confirming that runner version; do not copy the command for a different repository. [PHPUnit 5.7: command-line runner](https://phpunit.de/manual/5.7/en/textui.html)

**Do not apply when:** The code under test has no collaborator boundary or the real behavior requires a framework or external system. Do not install Mockery, Pest, or another test dependency just for this example; use one only when the project already configures it.

## Exercise HTTP and framework behavior in its real test context

**Trigger:** A changed route or controller relies on HTTP authentication, resource ownership, request validation, middleware, or framework response handling.

**Check and act:** Confirm the installed framework and its test harness, then test through that configured application path. Assert the contract for authorized and unauthorized callers, owned and unowned resources, valid and rejected inputs, responses, and relevant persisted effects. Consult official documentation for the confirmed framework version when framework-specific test APIs are needed.

**Do not apply when:** The changed code is a standalone service or value transformation with no route or framework lifecycle. Do not scaffold a Laravel application or assume Laravel, Yii, or modern framework APIs for a PHP file.

## Isolate database state and writes

**Trigger:** A test reads or changes database state, including setup, cleanup, fixtures, or rollback behavior.

**Check and act:** Use an owned disposable database or isolated test schema with credentials authorized for that target. Make setup and cleanup safe for that resource, and verify both successful and failed state transitions. Stop before any shared-database write unless the user has explicitly authorized the target and write operation. PHPUnit’s database-testing guidance calls for per-test cleanup and fixtures and describes how shared mutable database state can make tests interfere with one another. [PHPUnit 5.7: database testing](https://phpunit.de/manual/5.7/en/database.html)

**Do not apply when:** The test is database-free, or the operation is read-only and uses a verified isolated snapshot. A transaction alone does not establish that the target database is safe to mutate.

## Match static analysis and coverage to project configuration

**Trigger:** A change adds or adjusts a static-analysis, coding-standard, coverage, or extension check.

**Check and act:** Confirm the installed tool version, its configuration, required PHP extensions, supported PHP floor, and the exact invocation used in CI. Run the configured tool against the affected scope and record unavailable extensions or unsupported syntax as NOT RUN or NOT VERIFIED. Apply only the coverage threshold configured by the project or task; if none exists, report coverage evidence without introducing an 80% default. Composer treats PHP and extensions as platform packages, and PHPUnit 5.7 documents its own coverage configuration and requirements; verify these against the actual CLI environment. [Composer platform packages](https://getcomposer.org/doc/01-basic-usage.md#platform-packages), [PHPUnit 5.7: code coverage](https://phpunit.de/manual/5.7/en/code-coverage-analysis.html)

**Do not apply when:** The change neither affects these tools nor claims coverage or static-analysis evidence. Do not invent analyzer commands, extension requirements, or thresholds.

## Report the verification boundary

**Trigger:** Test, lint, static-analysis, framework, database, or coverage evidence is reported.

**Check and act:** Record the exact configured command, PHP/runtime and runner versions, affected test scope, and observed result. Distinguish a passed test from a skipped test, an unavailable tool, a syntax-only check, or an unverified environment. The PHPUnit 5.7 runner documents separate failure, error, skipped, and incomplete outcomes; report the outcome actually produced. [PHPUnit 5.7: command-line runner](https://phpunit.de/manual/5.7/en/textui.html)

**Do not apply when:** No verification claim is made. Do not promote a local syntax check or an unrun suite to a test pass.
