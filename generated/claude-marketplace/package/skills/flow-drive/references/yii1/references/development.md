
# Php56 Yii Dev

## Overview

Use this skill to work on generic Yii 1.x backend tasks in legacy PHP 5.6 environments without introducing syntax or patterns that block a later PHP 7 upgrade. Keep the workflow small: refresh framework knowledge through Context7 when needed, design with pragmatic DDD boundaries, drive changes with tests, then implement and verify.

## When NOT to Use

- Frontend-only work, documentation-only edits, or non-PHP stacks.
- The workflow still needs classification or gate decisions — route to `$flow-guide` first, then return here for implementation.
- The bug's root cause is unknown — route to `$code-trace` first, then return here for the PHP 5.6-safe fix.
- Modern PHP 7+/PHPUnit 6+ greenfield code with no PHP 5.6 runtime constraint.

## Core Rules

1. Treat PHP 5.6 runtime compatibility as a hard constraint.
2. Prefer code that still works after upgrading to PHP 7.x.
3. Keep Controllers thin and move business rules into Application Service, Domain Service, Entity, or Value Object.
4. Use TDD by default: write or identify a failing test before changing behavior.
5. Use Context7 as the knowledge source for language, framework, testing, and security questions. State when a recommendation is an inference from the sources.
6. If the task is simple CRUD with no real domain complexity, keep the design light and do not force ceremony.

## Critical Never List

- Never introduce PHP 7+ syntax or PHPUnit 6+ APIs into code or tests that must run on PHP 5.6 and PHPUnit 5.7.
- Never leave business rules, validation rules, or SQL-heavy orchestration in a Controller when a Service, Domain object, or Repository boundary would make the change clearer.
- Never trust mass assignment, request filters, sorting input, table names, or column names without scenario checks or allow-list validation.
- Never concatenate untrusted input into SQL, and never assume `queryRow()` or `queryScalar()` returns `null` on no result.
- Never use `strcmp()` to verify MySQL string ordering under `utf8_unicode_ci`; use `strcasecmp()` for ordering assertions.
- Never pretend a risky legacy path is covered when it is not. Write a characterization test, isolate a smaller seam, or call out the coverage gap explicitly.

## Workflow

### 1. Classify the task

Choose the smallest path that fits:

- `feature`: add or extend backend behavior
- `bugfix`: correct wrong behavior or regression
- `refactor`: improve structure without intended behavior change
- `hardening`: validation, security, or data-access safety improvement
- `review`: inspect existing PHP/Yii code for risks and best-practice gaps

### 2. Ground in the codebase

Before proposing changes:

- read the current Controller, Model, Service, Repository, or DAO path involved
- search for existing patterns before introducing new structure
- identify the current PHP version constraints and the active Yii style in the repo

If the task still needs workflow routing rather than implementation details, stop here and recommend `$flow-guide`.

### 3. Refresh knowledge through Context7

Read [references/context7-sources-and-query-rules.md](context7-sources-and-query-rules.md) first.

Then load only the references you need:

- PHP compatibility or security: [references/php56-php7-safe-subset.md](php56-php7-safe-subset.md)
- Yii validation, AR, DAO, request flow: [references/yii1-backend-patterns.md](yii1-backend-patterns.md)
- Domain boundaries and layering: [references/ddd-lite-for-yii1.md](ddd-lite-for-yii1.md)
- Test design and TDD loop: [references/tdd-workflow-and-test-strategy.md](tdd-workflow-and-test-strategy.md)
- PHPUnit 5.7 API traps and legacy test conventions: [references/phpunit57-legacy-test-traps.md](phpunit57-legacy-test-traps.md)

Re-query Context7 when:

- an API or framework behavior is unfamiliar
- a security or migration decision could be wrong
- the repo uses a pattern that conflicts with the reference
- the test framework version makes an example uncertain

### 4. Design the change

Use the smallest boundary set that keeps the code maintainable:

- Presentation: Controller or FormModel handles request mapping and response shaping
- Application: use case or Application Service coordinates work
- Domain: Entity, Value Object, or Domain Service holds rules and calculations
- Infrastructure: CActiveRecord, DAO, repository adapters, cache, HTTP, queue

Keep the design pragmatic:

- introduce a Value Object for high-risk concepts such as money, status, identifier, or date range
- introduce a Repository when persistence concerns are obscuring domain logic
- keep simple CRUD simple if extra layers would add noise without clarity

### 5. Drive the work with TDD

Read [references/tdd-workflow-and-test-strategy.md](tdd-workflow-and-test-strategy.md).
If the task involves writing or reviewing PHPUnit code, also read [references/phpunit57-legacy-test-traps.md](phpunit57-legacy-test-traps.md).

Use this default order:

1. write or identify the failing regression or use-case test
2. implement the smallest change that makes the test pass
3. refactor while keeping tests green
4. add follow-up coverage for edge cases and failure modes

If the code is too legacy to isolate immediately, first write characterization tests around the current behavior.

If the task is a bug and the failing behavior still cannot be isolated to a root cause, stop and recommend `$code-trace` before writing implementation guidance.

### 6. Implement with compatibility discipline

During implementation:

- prefer PHPDoc over scalar parameter or return types
- prefer `[]`, namespaces, small methods, explicit variable names, and early returns
- use prepared statements and safe validation flows
- avoid deprecated or removed features called out in the PHP reference
- do not rely on mass assignment unless the Yii model declares the attributes safe for the active scenario

### 7. Verify and report

Always report:

- task classification
- relevant Context7 sources consulted or intentionally skipped
- PHP/Yii compatibility notes
- DDD placement decisions
- tests added or recommended
- residual risks and assumptions

Add `recommended next skill` only when routing or investigation should happen before implementation.

For reviews, list findings first, ordered by severity.

## Output

Use the format that matches the task.

### Implementation, bugfix, refactor, or hardening

1. `Task classification`
2. `Context7 basis`
3. `Design decision`
4. `TDD plan`
5. `Implementation guidance`
6. `Verification`
7. `Risks / assumptions`
8. `Recommended next skill` when applicable

### Review

1. `Task classification`
2. `Context7 basis`
3. `Findings`
4. `Design / compatibility notes`
5. `Verification gaps`
6. `Risks / assumptions`
7. `Recommended next skill` when applicable

Keep each section short unless the user asks for detail.

## Verification

- [ ] Proposed code runs on PHP 5.6
- [ ] New code avoids PHP 7+ only syntax
- [ ] Data access uses parameter binding
- [ ] Validation and safe-attribute rules are explicit
- [ ] Domain logic is not leaking into Controller or View
- [ ] Tests cover the changed behavior or the gap is called out
- [ ] Any uncertain framework behavior is verified through Context7
