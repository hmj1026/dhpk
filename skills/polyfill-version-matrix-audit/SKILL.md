---
name: polyfill-version-matrix-audit
description: Audit multi-major-version polyfill code for branch coverage and test-matrix gaps. Use when a library spans multiple major versions of a dependency (Monolog 2/3, Laravel 6 vs 7+, PHPUnit 8/9/10/11, Yii 1.1 vs 2.x), uses `version_compare` / `class_exists` / `method_exists` / `Composer\InstalledVersions` guards to switch behaviour at runtime, and ships a CI matrix that should exercise every branch. Symptoms that trigger this skill: a recent commit named like "fix: polyfill <feature> for <old-version>", asymmetric polyfill (one branch is rich, the fallback branch is a stub), CI matrix has cells that have never failed because no test enters that branch, composer constraint says `^6.0 || ^7.0 || ^8.0` but the polyfill only has 2 branches not 3. Counterpart to `legacy-code-characterization` (single-version legacy code) and `composer-package-hygiene` (semver / public API). Framework-agnostic — applies to any PHP package whose `require.<dep>` spans multiple major versions.
---

# Polyfill version matrix audit

For libraries whose value proposition is "works on framework X versions A–Z."
The risk is silent: a polyfill branch fires only when a specific
PHP × framework × dep cell of the CI matrix runs that exact code path,
and most matrix cells share most test bodies. A regression in the rarely
visited branch can ship for months before someone files an issue.

> Mental model: every `if (version_compare(...))` / `if (class_exists(...))` is
> a fork in the execution tree. The CI matrix is the **set of starting
> points**. A branch with no starting point that reaches it is dead code
> — until a user enters from outside (production) and trips it.

---

## When to run

- Editing any file under `src/` that contains a runtime version guard
  (`version_compare`, `PHP_VERSION_ID`, `class_exists`, `method_exists`,
  `interface_exists`, `is_a`, `Composer\InstalledVersions::*`)
- Reviewing a PR that touches a polyfill class
- Before tagging a minor/patch release
- After a "fix: polyfill ..." commit, audit the symmetric branch
  (it likely needs the same fix or the same test)

## When NOT to run

- Single-version libraries (composer `require.<dep>` pins one major)
- Application code (not a published package)
- Pure version-detection helpers with no behavioural branching

---

## Inputs

Given one of:
- a file path (e.g. `src/Logging/GoogleChatHandler.php`)
- a symbol (`cx definition --name GoogleChatHandler`)
- the keyword "all" — scan `src/` for any file with a version guard

Read:
- `composer.json` → `require` constraint for the polyfilled dep (the **declared matrix**)
- `.github/workflows/*.yml` → `strategy.matrix` (the **executed matrix**)
- `phpunit.xml` → `testsuites` (which cells exercise which dirs)
- `git log --follow <file>` → recent asymmetric edits

---

## Procedure

### Step 1 — Enumerate branches

For each version guard in the target file, classify it:

| Guard | Pattern | Branch meaning |
|---|---|---|
| `class_exists(\Foo\Bar::class)` | new-API present | uses upstream class directly |
| `method_exists($x, 'foo')` | new method added | calls new API |
| `version_compare($ver, '7.0', '>=')` | new major | uses new-major idiom |
| `is_a($x, NewInterface::class)` | interface widened | adapts to new contract |
| `Composer\InstalledVersions::satisfies(...)` | constraint match | branches by dep version |

Output an enumeration table:

```
Guard L42  | class_exists(\Monolog\Formatter\NormalizerFormatter::class) | Monolog 3
Fallback   | (else)                                                      | Monolog 2
Guard L88  | version_compare(PHP_VERSION, '7.4', '>=')                   | PHP 7.4+
Fallback   | (else)                                                      | PHP 7.3
```

### Step 2 — Map branches to matrix cells

For each branch, list which CI matrix cells **could** enter it. A cell can
enter branch B if and only if the cell's pinned dep versions satisfy the
guard. Use the declared composer constraint as the upper bound.

```
Branch "Monolog 3"   ← cells where monolog/monolog resolves ^3.x
Branch "Monolog 2"   ← cells where monolog/monolog resolves ^2.x
Branch "PHP 7.4+"    ← cells with matrix.php ≥ 7.4
Branch "PHP 7.3"     ← cells with matrix.php = 7.3
```

### Step 3 — Cross with test coverage

For each branch, find a test that demonstrably exercises it. Acceptable
evidence:
- An assertion specific to the branch's output (different message format,
  different class name in output, etc.)
- A test method whose `@requires` annotation matches the branch
- A `setUp` that skips the test when the wrong dep version is installed

**Reject** as evidence: a test that calls into the file but asserts only
that no exception was thrown. That's a smoke test — both branches pass it
trivially.

### Step 4 — Output the gap table

```
Branch              | Matrix cells that enter | Tests that prove it | Gap?
--------------------|-------------------------|---------------------|-----
Monolog 3 path      | PHP 8.1/8.2 × any L    | tests/MonologV3Test | ✓
Monolog 2 path      | PHP 7.3/7.4/8.0 × any  | (none)              | ✗ ADD TEST
PHP 7.4+ path       | matrix.php ≥ 7.4       | tests/Modern*Test   | ✓
PHP 7.3 path        | matrix.php = 7.3       | (none)              | ✗ ADD TEST
```

### Step 5 — Asymmetric-edit detection

`git log --oneline --follow <file>` — for the last 10 commits, check
whether each one touched both branches or only one. If a commit modified
the new-major branch but not the fallback, flag it: the fallback is now
N commits behind in semantics, which usually means a bug.

> Common pattern in devkit's polyfill churn:
> `fix: polyfill laravel 6 class casts` patched the L6 fallback;
> the L7+ branch already worked. Symmetric audit would have asked
> "what does L7+ do that L6 didn't, and is the L6 branch now equivalent
> or a different shape entirely?"

---

## Output format

A single audit report with three sections:

1. **Enumeration** — the table from Step 1
2. **Matrix gap** — the table from Step 4 with one row per branch, ✓ / ✗ in the Gap column
3. **Asymmetric edits** — bullet list of commits that touched one branch only, with a one-line "what to verify on the other branch" prompt each

If all branches are covered and no asymmetric edits exist, say so in one
line and exit — don't pad. The report's value is in the **gaps**, not in
the confirmations.

---

## Common traps

- **Stub fallback**: the else-branch returns `null` or throws "not supported on this version." That can be valid (`@deprecated since 2.0, use X`), but the audit must verify the stub matches the docs. A silent `return null;` that callers don't expect is a runtime NPE waiting to happen.
- **Polyfill drift**: the new-major branch evolves, the old-major branch is frozen. Over N releases, the two branches diverge in subtle ways (different default options, different exception types). The matrix audit shouldn't enforce identical behaviour, but should flag divergence so the doc can say so.
- **Hidden version coupling**: a branch guards on `class_exists(\Foo\Bar::class)` but the rest of the method body assumes another class from the same major version, without a second guard. If a transitive dep changes when `\Foo\Bar` exists vs doesn't, the assumption breaks. Audit each method body for **all** version-sensitive symbols, not just the guarded ones.
- **PHPUnit version skipping**: `@requires PHP 7.4` is honoured by PHPUnit 8+, but the marker syntax changed in 10. A test annotated for PHPUnit 9 syntax might silently always-run on PHPUnit 10 if the matrix has a cell pinning PHPUnit 10. The audit must read the actual PHPUnit version that runs the cell.

---

## Related skills

- `composer-package-hygiene` — semver decisions when adding/removing a polyfill branch (raising the floor is a major bump)
- `legacy-code-characterization` — for the single-version case where the polyfill branch IS the legacy code
- `phpunit-batch-refactor` — when fixture changes are needed to add the missing tests Step 4 surfaces
