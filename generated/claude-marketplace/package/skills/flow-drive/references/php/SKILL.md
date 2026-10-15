---
name: php
description: 'PHP implementation, review, tests, runtime compatibility, and feature or library-floor decisions across PHP5.6,7.4,8.x. Use for language/runtime tasks and mixed-floor packages. Not for frontend-only work or Yii framework security/development ownership. Output: compatibility-safe code or decisions with runtime-matched verification.'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# PHP

Use `$php <task>` for language/runtime implementation, review, testing, or a
feature decision. Yii framework behavior and framework-security tasks belong to
`yii1`; this folder remains independently usable for PHP runtime work.

## Resolve before versioned loads

1. Identify the target package/subproject and task. An intentional explicit
   target/version override wins; report it separately from observed constraints.
2. Inspect target composer.json PHP constraint, lock, platform emulation, CI and
   deployment configuration at their actual precision. The lowest supported
   floor governs syntax for a shared file. `^7.4 || ^8.0` retains7.4 compatibility;
   a broad `>=5.6` does not authorize8.x syntax. A lock or config.platform.php
   value and `php --version` do not alone prove deployment or package floor.
3. Ask and wait for missing/conflicting/incompatible evidence or unspecified
   monorepo scope before version-specific resources or dependent edits. A
   migration needs an explicit destination. For multiple targets, group
   references, compatibility decisions and verification evidence per target.

## Select only the matching local references

| Target/task | Local resources |
| --- | --- |
| PHP5.6 language/service compatibility | [legacy](references/php56-legacy.md) |
| PHP5.6 + PHPUnit5.7 tests | [legacy testing](references/phpunit57-php56-legacy.md) and relevant [test quality](references/testing-quality.md) |
| PHP7.4 baseline, API shape, mixed-floor library | [7.4](references/7-4.md) |
| PHP8.x feature/minimum-version decision | [8.x](references/8-x.md), selected section of [feature catalog](references/feature-catalog.md) |
| Static analysis/style setup | [static checks](references/static-checks.md) |
| Generic test design | [test quality](references/testing-quality.md) |
| Resolved Laravel application | laravel-projects, laravel-patterns; version-specific laravel-v10 or laravel-v11-v12 only after exact major evidence |
| Resolved Symfony or async/event-loop work | symfony-patterns or async-patterns only when applicable |
| PHP8.3+ general idioms | modern-php-features only when the floor permits |

All named resources above live in `references/`. Local framework examples are
starting points, not a substitute for the actual installed major and test
harness. Unsupported or uncertain framework APIs require the matching official
source/tool capability or an explicit `NOT_VERIFIED` boundary. No external peer
skill or dhpk module is required to perform the runtime task. Missing bundled
resources are `BLOCKED`.

## Compatibility and authority

PHP5.6 uses PHPDoc and compatible test APIs: no strict_types, scalar/return
syntax, ??, typed properties, arrows or8.x features. PHP7.4 supports typed
properties, arrows and ??=; string-key array spread needs8.1. PHP8.x features
must satisfy each catalog minimum. A same-file runtime guard cannot conceal a
parser error on an older floor. Attribute use on7.x also requires safe comment
layout and a compatible metadata consumer; do not infer general8.x support.
Public parameter names matter to named-argument callers. A floor bump is an
explicit compatibility/semver decision, not an automatic fix.

Use the project's test-first workflow for changed behavior; isolate dependencies
and preserve parameter binding, authorization-before-side-effects, thin adapters,
and transaction/idempotency boundaries. Implementation requests authorize scoped
code/tests/configuration edits; review/advice requests stay read-only. A design
or local test request grants no shared database mutation, DDL, package release,
commit or push permission. Optional consumer hooks are background integrations,
not required bundled runners.

## Completion

Return target floor and evidence/override, selected resource set, resulting
code or feature/floor decision, framework-specific design where relevant,
runtime-matched test recommendations/results, and residual risks. Record parser,
static-analysis and focused tests separately for every target. An unavailable
legacy runtime is `NOT_RUN`; running a new PHP binary does not prove5.6
compatibility. Preserve local, DB/provider and release evidence separately.
