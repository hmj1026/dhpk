# Polyfill patterns reference

Catalogue of common multi-major polyfill shapes seen in PHP libraries. Each
entry shows the **detection idiom**, the **branch shape**, and the **typical
test gap** that the polyfill-reviewer should flag.

The reviewer references this file when explaining *why* a flagged branch is
risky — descriptions here should match the real-world breakage that triggered
the entry. If a pattern is purely defensive (no observed regression), document
it but mark `severity: low`.

---

## 1. Eloquent CastsAttributes contract (Laravel 6 vs 7+)

**Detection:**
```php
interface_exists(\Illuminate\Contracts\Database\Eloquent\CastsAttributes::class)
```

**Branch shape:**
- L7+ branch: implement the contract directly (`set($model, $key, $value, $attributes)`)
- L6 fallback: alternate trait-based hook (no contract exists upstream)

**Test gap:** the L6 fallback path requires either Testbench 4 in the matrix
OR a runtime-detection test that mocks `interface_exists()`. Pure unit tests
running on PHP 7.4 + Testbench 4 against the L6 cell often skip because
fixtures assume L7+ container bindings.

**Reference incident:** devkit's `fix: polyfill laravel 6 class casts` (commit
59f0705) — the L6 branch shipped without an exercising matrix cell because the
core testsuite didn't enter the Laravel container, and the Laravel testsuite
defaulted to the highest installed major.

---

## 2. Monolog Record vs array (v2 vs v3)

**Detection:**
```php
class_exists(\Monolog\LogRecord::class)
```
or signature check on the handler's `handle` method via reflection.

**Branch shape:**
- v3 branch: `public function handle(LogRecord $record): bool`
- v2 fallback: `public function handle(array $record): bool`

**Test gap:** asymmetric `setFormatter()` / `setProcessor()` returns — v2 may
return `void`, v3 returns `self`. A test asserting fluent chaining passes on
v3 and silently fails on v2. The reviewer must check **every method the
branch overrides** for signature parity, not just `handle()`.

**Reference incident:** devkit's GoogleChat handler — Monolog 2→3 simulation
required a half-migration window where reflection-based dispatch routed to
the wrong subclass. Symmetric edit needed on both `*V2.php` and `*V3.php`
files; one was forgotten.

---

## 3. Flysystem path API (v1 vs v2/v3)

**Detection:**
```php
class_exists(\League\Flysystem\Filesystem::class)
  && method_exists(\League\Flysystem\Filesystem::class, 'writeStream')
```

**Branch shape:**
- v2/v3 branch: PSR-7-style write methods, `FilesystemReader` / `FilesystemWriter` split
- v1 fallback: legacy `getAdapter()->...` calls, manual stream handling

**Test gap:** v1 throws on missing files, v2+ returns `false` from `has()`.
A test asserting "throws on missing" passes on v1 + skip-on-v2; the v2 branch
silently never asserts. Reviewer should flag any branch whose tests use
`expectException` but the symmetric branch returns instead of throws.

---

## 4. PHPUnit `void` return on `setUp()` (8+ vs <8)

**Detection:** implicit — the version is locked by `composer require-dev`,
no runtime guard.

**Branch shape:** N/A — this is *upstream* polyfill, not library polyfill.
Listed here because reviewers occasionally mistake an LSP-required `void` for
a polyfill branch and flag it. **It is not** — see `code-reviewer.md` LSP
exceptions section.

**Action when seen:** confirm `phpunit.xml` version and proceed; do not flag.

---

## 5. Composer InstalledVersions (Composer 2.0+)

**Detection:**
```php
class_exists(\Composer\InstalledVersions::class)
  && \Composer\InstalledVersions::satisfies(new VersionParser, 'monolog/monolog', '^3.0')
```

**Branch shape:** uses `InstalledVersions::satisfies()` to detect dep version
without instantiating the dep itself (cheaper, no autoload trigger).

**Test gap:** the polyfill works only on Composer 2.0+. PHP 7.3 cells on
older CI runners may have Composer 1.x and silently fall through to the
`class_exists` returning false. Reviewer must check `.github/workflows/*.yml`
for explicit `composer --version` steps when this idiom is used on a PHP 7.3
matrix cell.

---

## Severity rubric

| Level | Meaning |
|-------|---------|
| `critical` | branch will throw / segfault on a covered matrix cell with no test |
| `high` | branch returns wrong shape (different exception class, different return type) but matrix has a cell that enters it |
| `medium` | branch divergence not exercised by any cell (works, but undocumented divergence) |
| `low` | defensive guard, no observed regression, listed for completeness |

---

## How polyfill-reviewer uses this file

When the agent identifies a guard pattern in the diff, it should:
1. Look up the matching entry here (by detection idiom)
2. Quote the **test gap** description in its finding
3. Cite the **reference incident** if one exists
4. Apply the **severity rubric**

If the guard doesn't match any entry, the reviewer should NOT invent severity
— flag as `unclassified` and recommend adding an entry to this file.
