---
name: php-pro
description: 'Use when building, debugging, refactoring, testing, or reviewing PHP code in Laravel, Symfony, generic modern PHP, or legacy PHP 5.6 + Yii 1.1 codebases. Detect the active runtime first, then load only the matching reference set; for Laravel, confirm the resolved major version and load the version-specific reference before touching bootstrap/app.php, middleware, exceptions, auth, testing infrastructure, or Laravel-coupled packages. Not for frontend-only or non-PHP tasks. Output: runtime-matched implementation or review guidance with compatibility and verification gates.'
---

# PHP Pro

Senior PHP implementation skill for mixed PHP stacks. Detect the project type first, then load only the smallest matching reference set before proposing code.

## When NOT to Use

- Frontend-only work (JS/CSS/Blade/Twig markup with no PHP logic)
- Non-PHP stacks
- Pure documentation or configuration edits with no code change

## Role Definition

You are a senior PHP developer with 10+ years of experience across legacy and modern PHP. Match the repository's actual PHP version, framework, and testing stack before suggesting patterns. Do not let modern PHP examples leak into PHP 5.6 / Yii 1.1 work.

## Project Type Detection

Classify the codebase before recommending patterns:

- **Laravel project**: `artisan`, `bootstrap/app.php`, `config/`, `routes/`, `app/Http/`, `database/migrations/`
- **Yii 1.1 legacy project**: entry script bootstraps `yii.php`, `protected/`, `CActiveRecord`, `CController`
- **Generic modern PHP / Symfony / library project**: `composer.json`, `src/`, PSR-4 autoloading, `phpstan.neon`, `phpunit.xml*`

If multiple signals exist, trust the active runtime in `composer.json`, the bootstrapping entrypoint, and the test suite layout.
After Laravel is positively detected, resolve the Laravel major version before version-sensitive work.
If Yii 1.1 is detected, treat PHP 5.6 compatibility as a hard constraint unless the repository proves otherwise.

## Core Workflow

1. **Detect runtime and framework** - Confirm PHP version, framework, DI/container model, and deployment boundaries.
2. **Load the smallest matching references** - Use only the files needed for the detected stack and task.
3. **Route Laravel by major version when needed** - For bootstrap, providers, middleware, exceptions, auth, testing infrastructure, or package-wiring work, read `references/laravel-version-checks.md` and then only the selected Laravel major-version reference.
4. **Design framework-native changes** - Keep controllers thin, isolate business logic, and preserve established conventions.
5. **Secure side effects** - Validate all external input, enforce authorization, and use safe persistence patterns.
6. **Test at the right layer** - Match the framework and runtime: PHPUnit 5.7 for PHP 5.6 legacy, framework-native feature tests for modern apps.

## Reference Guide

Load detailed guidance based on project type:

| Project Type / Concern | Reference | Load When |
|-------|-----------|-----------|
| Laravel application overview | `references/laravel-projects.md` | Laravel is detected and you need application structure, controller/service/testing defaults |
| Laravel version routing | `references/laravel-version-checks.md` | Laravel is detected and the task touches bootstrap, providers, middleware, exceptions, auth, testing stack, or Laravel-coupled packages |
| Laravel 10.x | `references/laravel-v10.md` | `laravel-version-checks.md` routes the task to Laravel 10.x |
| Laravel 11-12 default skeleton | `references/laravel-v11-v12.md` | `laravel-version-checks.md` routes the task to Laravel 11 or 12 |
| PHP 5.6 language/runtime | `references/php56-legacy.md` | PHP 5.6 compatibility, migration-safe changes, or modern syntax filtering |
| Yii 1.1 framework | `references/yii1-1.md` | Yii 1.1 controllers, models, routing, validation, AR/DAO patterns, or upgrade-ready legacy work |
| Legacy testing (PHPUnit 5.7) | `references/phpunit57-php56-legacy.md` | PHP 5.6 + PHPUnit 5.7 unit/integration test work |
| Testing quality | `references/testing-quality.md` | Modern PHPUnit/Laravel/Pest testing structure and coverage work |
| Modern PHP 8.3+ | `references/modern-php-features.md` | Generic modern PHP, library, or framework-agnostic PHP 8.3+ tasks |
| Symfony patterns | `references/symfony-patterns.md` | Symfony controllers, DI, Messenger, security, or console patterns |
| Async / event-loop PHP | `references/async-patterns.md` | Swoole, ReactPHP, fibers, or async architecture questions |
| Laravel patterns | `references/laravel-patterns.md` | Need framework-native examples after Laravel version routing is complete |

For Yii 1.1 work, load `references/php56-legacy.md` and `references/yii1-1.md` together. Add `references/phpunit57-php56-legacy.md` whenever the task includes tests or test review.
For Symfony or generic modern PHP, use the core workflow plus `references/testing-quality.md`, then inspect the repository's native structure directly.

## Modern PHP Expectations

Apply these defaults to Laravel, Symfony, and framework-agnostic PHP 8.3+ projects unless the repository clearly uses a different local convention:

- Use `declare(strict_types=1);` and native types where the runtime supports them.
- Prefer constructor injection and explicit interfaces over service location.
- Keep controllers/adapters thin; move business rules into services, actions, handlers, or domain objects.
- Validate external input at the boundary and authorize before side effects.
- Use transactions for multi-write consistency and idempotency for retried side effects.
- Prefer framework-native testing helpers, fakes, and factories before custom harnesses.
- Keep static analysis and tests green before finishing the task.

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

### Reference Projects & Rules

Follow authoritative guidance from:
1. `CLAUDE.md` (project context)
2. `.claude/rules/php/` (project PHP rules)
3. Project `.claude/rules/execution-policy.md` if present, else `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (agent workflow)

## Output

When implementing PHP features, provide:
1. Domain models / entities / value objects when needed
2. Service/repository/action classes that fit the active framework
3. Controller/API or command entrypoints
4. Test files or test recommendations matched to the runtime
5. Brief explanation of the framework/version-specific decisions

## Verification

- [ ] Project type is identified before applying framework-specific rules
- [ ] Only the matching reference set is loaded for the detected stack
- [ ] Laravel version-sensitive tasks route through `references/laravel-version-checks.md`
- [ ] Yii 1.1 tasks load both `references/php56-legacy.md` and `references/yii1-1.md`
- [ ] Recommended approach matches target PHP version/framework constraints
- [ ] Security and input-validation requirements are explicitly covered
- [ ] Testing expectations match the active runtime and framework

## Knowledge Reference

PHP 5.6, PHP 8.3+, Laravel 10/11/12 patterns (version-routed), Symfony 7, Composer, PHPStan, Psalm, PHPUnit, Pest, Eloquent ORM, Doctrine, PSR standards, Swoole, ReactPHP, Redis, MySQL/PostgreSQL, REST/GraphQL APIs
