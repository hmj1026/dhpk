---
name: php-pro
description: "PHP runtime router and implementation guardrail for mixed repositories. Use when building, debugging, refactoring, testing, or reviewing PHP code and you must first determine whether the active stack is Laravel, Symfony, generic modern PHP, async/event-loop PHP, or legacy PHP 5.6 + Yii 1.1. Especially use this when repository signals are mixed, when Laravel version-sensitive files such as `bootstrap/app.php`, providers, middleware, exceptions, auth, or testing infrastructure are involved, or when you need to decide which PHP references to load and which to skip before proposing changes. Output: detected runtime, references to load and skip, framework-safe implementation direction, and testing expectations. Not for frontend-only work, architecture-only discussion, or clearly scoped Yii 1.1 backend tasks that should go straight to `php56-yii-dev`."
---

# PHP Pro

Use this skill as the first-pass PHP runtime router. Its job is not to reteach PHP. Its job is to stop the wrong framework, version, or testing advice from leaking into the task before implementation starts.

## Core Principle

Trust runtime evidence over directory aesthetics. In mixed or upgraded repositories, the most expensive failure mode is confidently applying the wrong framework defaults.

## Critical Never List

Never do these, because they create the highest-cost PHP guidance failures:

- Never infer Laravel major version from memory, blog posts, or starter-kit assumptions. `composer.json`, `composer.lock`, and the repository bootstrap files win because skeletons drift over time.
- Never load both legacy Yii references and modern Laravel/Symfony/PHP 8.x references for the same task path unless the change truly spans runtimes. Mixed guidance is how PHP 7+ syntax leaks into PHP 5.6 code.
- Never treat `declare(strict_types=1);`, native types, attributes, or enum-based examples as harmless defaults. In established codebases they can change boundary behavior, dependency expectations, and deployment compatibility.
- Never let package docs outrank the repository's actual bootstrapping and tests. Local `bootstrap/app.php`, `config/`, `tests/`, and executable entrypoints are a stronger source of truth than generic examples.
- Never widen a scoped bugfix into a framework-wide refactor just to make the code look more modern. Broad rewrites hide the original task and increase regression surface.

## When NOT to Use

Do not use this skill when:

- The task is frontend-only or otherwise not about PHP code.
- The request is architecture brainstorming, documentation editing, or other work that does not need implementation-level PHP guidance. Use `software-architecture` for design-only decisions.
- The root cause is unknown and the task still needs investigation before implementation guidance. Use `bug-investigation` first.
- The task is already confirmed as Yii 1.1 backend implementation on PHP 5.6 and needs deeper execution guidance, TDD flow, or DDD placement. Use `php56-yii-dev`.

## Runtime Detection Order

Classify the runtime before recommending patterns:

1. Start from the touched path and executable entrypoint, not from repo-root aesthetics.
2. Confirm runtime with `composer.json`, `composer.lock`, bootstrap files, framework base classes, and test suite layout.
3. If multiple apps live in one repository, route by the touched subtree rather than forcing one repo-wide answer.
4. If signals conflict, trust the code that actually executes first: entrypoint, container/bootstrap wiring, then tests.
5. If the runtime still cannot be confirmed, stay inside repository-proven patterns and avoid version-coupled advice.

## Routing Matrix

Load only the smallest matching set. Record both what you load and what you intentionally skip.

| Runtime / Task | Load Now | Add Only If Needed | Do NOT Load |
|-------|-----------|--------------------|-------------|
| Laravel ordinary app code | `references/laravel-projects.md` | `references/laravel-patterns.md` for framework-native examples | Skip `references/laravel-version-checks.md`, `references/laravel-v10.md`, and `references/laravel-v11-v12.md` unless the task is version-sensitive |
| Laravel version-sensitive code | `references/laravel-version-checks.md` first | Then exactly one of `references/laravel-v10.md` or `references/laravel-v11-v12.md`; add `references/laravel-projects.md` if app structure matters | Never load both version files together |
| Yii 1.1 + PHP 5.6 | `references/php56-legacy.md` and `references/yii1-1.md` together | `references/phpunit57-<your-project>.md` when tests or test review are in scope | Skip `references/modern-php-features.md`, `references/laravel-projects.md`, `references/laravel-patterns.md`, `references/laravel-version-checks.md`, `references/laravel-v10.md`, `references/laravel-v11-v12.md`, and `references/symfony-patterns.md` |
| Symfony application | `references/symfony-patterns.md` | `references/testing-quality.md` when testing strategy or quality gates matter | Skip Laravel and Yii references unless the repository proves a mixed-runtime boundary |
| Generic modern PHP or library code | `references/modern-php-features.md` | `references/testing-quality.md` when tests, static analysis, or coverage are part of the task | Skip framework references until the repository proves framework coupling |
| Async or event-loop PHP | `references/async-patterns.md` plus the stack base reference above | none by default | Do not treat async patterns as defaults for normal FPM or CLI code |

## Legacy Constraints (PHP 5.6 + Yii 1.1 only)

### MUST DO
- Use PHPDoc-only typing: `@param int $id`, `@return Order[]`
- Use PDO prepared statements for all DAO / SQL queries with named bindings
- Use `Yii::app()->request->getPost()`, not `$_POST`
- Validate user inputs and safe attributes before persistence or mass assignment
- Write PHPDoc on public methods that expose business or persistence contracts
- Keep Controllers thin; move business rules into services, repositories, or model/domain methods
- Run PHPUnit 5.7 tests before delivery when tests exist for the path
- Follow PHP 5.6 hard limits and repository-specific rules from `CLAUDE.md`

### MUST NOT DO
- Introduce PHP 7+ syntax or PHPUnit 6+ APIs
- Use `??`, named arguments, attributes, union/intersection types, `match`, `readonly`, or return types
- Direct `$_POST` / `$_GET` access
- SQL queries without parameter binding
- Hardcoded secrets (use environment variables)
- Assume modern Laravel/Symfony conventions apply to Yii 1.1 code
- Skip test execution without calling out the gap explicitly

## Modern Runtime Decision Rules

For Laravel, Symfony, and generic modern PHP, prefer decisions over slogans:

- If the repository already has strong local conventions, copy those before importing framework-default examples from references.
- Only recommend `declare(strict_types=1);`, native types, attributes, or enums when the runtime supports them and the touched boundary can absorb the behavioral change safely.
- Keep framework-native boundaries native. Do not import Laravel conveniences into Symfony, or Symfony structure into a plain library, unless the repository already did so.
- If the task is a narrow bugfix, prefer a surgical change and matching tests over an opportunistic service-layer rewrite.
- If static analysis or coverage tooling is absent, do not silently expand the task into a tooling migration. Call the gap out explicitly instead.

## Conflict Resolution

Use these tie-breakers when the repository sends mixed signals:

1. `bootstrap/app.php`, `yii.php`, framework base classes, and executable entrypoints outrank folder naming.
2. `composer.lock` outranks broad version constraints in `composer.json` when Laravel version matters.
3. The touched subtree outranks the repo root in monorepos or transitional repositories.
4. Existing tests outrank examples from memory or from generic docs.
5. If the task crosses two runtimes for real, split the guidance by boundary instead of forcing one framework model onto both sides.

## Output

Always report:

1. Detected runtime and the evidence used to reach that conclusion
2. References loaded
3. References intentionally skipped
4. Highest-risk compatibility boundary
5. Testing layer or test gap
6. Recommended next skill when rerouting is safer than implementing inline

## Verification

- [ ] Project type is identified before applying framework-specific rules
- [ ] Only the matching reference set is loaded for the detected stack
- [ ] At least one intentional skip decision is recorded to prevent over-loading
- [ ] Laravel version-sensitive tasks route through `references/laravel-version-checks.md` and then exactly one version file
- [ ] Yii 1.1 tasks load both `references/php56-legacy.md` and `references/yii1-1.md`, and add `references/phpunit57-<your-project>.md` only when tests matter
- [ ] Recommended approach matches target PHP version, framework, and repository conventions
- [ ] Security, input-validation, and testing expectations are covered at the correct runtime layer
