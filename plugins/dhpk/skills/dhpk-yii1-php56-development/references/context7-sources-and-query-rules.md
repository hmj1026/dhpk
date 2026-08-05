# Context7 Sources And Query Rules

Use Context7 as the primary knowledge source for this skill.

## Preferred libraries

- PHP manual: `/websites/php_net_manual`
- Yii documentation: `/yiisoft/yii`
- PHPUnit documentation: `/websites/phpunit_de_en_12_5`
- Lightweight DDD structure reference: `/lunarstorm/laravel-ddd`

Treat the DDD source as a structural example, not a framework dependency. Use it to reason about layer boundaries such as Domain, Application, and Infrastructure.
Treat the PHPUnit source as a testing-principles source, not as the API SSOT for PHPUnit 5.7. For legacy assertion and exception syntax, use `references/phpunit57-legacy-test-traps.md` first.

## Query before deciding when

- a PHP function, migration caveat, or deprecation status is unclear
- a Yii validation, scenario, AR, or DAO behavior matters to correctness
- test double or fixture guidance affects test design
- a PHPUnit API detail is unclear and is not already covered by the local legacy PHPUnit reference
- a security-sensitive decision involves request data, SQL construction, or password handling

## Query patterns

### PHP compatibility

Query for:

- PHP 5.6 features that remain valid in PHP 7.x
- migration incompatibilities to avoid upfront
- deprecations or removals such as `ext/mysql`, PHP 4 constructors, `create_function()`
- security guidance for PDO and password hashing

### Yii backend behavior

Query for:

- `rules()` and scenario behavior
- safe attributes and mass assignment
- FormModel versus CActiveRecord responsibilities
- DAO parameter binding and query practices
- Controller responsibility boundaries

### Testing

Query for:

- Arrange, Act, Assert structure
- fixtures with `setUp()` and `tearDown()`
- test doubles, stubs, and mocks
- brittle-test avoidance

Do not lift modern PHPUnit method names into PHP 5.6 / PHPUnit 5.7 code without translating them back through the local legacy reference.

### DDD placement

Query for:

- Domain versus Application versus Infrastructure responsibilities
- value object and repository placement
- lightweight use-case organization

## Reporting rules

- Name the Context7 source when you rely on it.
- If you adapt a source into Yii-specific guidance, label that as an inference.
- If the source is too modern for the target runtime, keep the principle and translate the syntax back to PHP 5.6-safe form.
- If a testing detail conflicts with the local legacy PHPUnit reference or repo conventions, follow the local legacy rule and call the Context7 result a modern-source inference.
- If no reliable source is available for a detail, say that explicitly and fall back to existing repo conventions.
