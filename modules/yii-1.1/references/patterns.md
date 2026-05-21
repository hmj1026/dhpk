# PHP Patterns (<your-project>-specific)

> Extends `~/.claude/rules/common/patterns.md`. Yii 1.1 + DDD layering.

## Repository / Service

- Repository interface: `findById`, `findAll`, `findByCriteria`, `save`, `delete`. Inject `IXxxRepository` into Domain services — never AR model directly.
- Service Layer handles transaction / validation / external API / rollback.

## DB Query Layering (SQL location SSOT)

1. **Builder priority**: prefer `Infrastructure\Database\Query\Builder` via `$repo->queryBuilder()->where()->get()/first()/value()/count()/update()`; fall back to Yii `createCommand()` only when the toolkit doesn't fit.
2. **Location**: all SQL lives in Repository. Controller / Domain service / trait SHALL NOT call `Yii::app()->db->createCommand()` directly or build SQL strings.
3. **Naming**: business semantics + explicit required columns (`createWeatherContext($storeNo, ...)`). Forbidden: `insertRow($row)` / `updateBy($where, $set)` / `executeRaw($sql)`.
4. **Migration cadence**: new code follows 1+2 immediately; existing inline SQL only pushed down when its section is being modified.
5. **No mirror-existing escape hatch**: neighbor using `createCommand()` is not justification — create a **V2 parallel method** with `queryBuilder()` if upgrading is impractical, and annotate the legacy method `@see xxxV2`.

Toolkit prerequisite (unfamiliarity is not a fallback reason): read `docs/query-toolkit-cookbook.md` + `docs/query-toolkit-migration-guide.md`. Date helpers (`BuildsDateWheres` trait): `->whereDate('col', '>=|<=', 'YYYY-MM-DD')`. Spec: `infrastructure/CLAUDE.md` "Database Query Toolkit".

## Repository Discovery Gate

Before designing any new DB query:

```bash
grep -rl "<target_table>" infrastructure/Repositories/
# fallback: cx overview infrastructure/Repositories/
```

| Result | Action |
|---|---|
| Repository found | Add new method via `queryBuilder()`. Never in Controller. |
| Not found | Create `XxxRepository extends EntityRepository` in `infrastructure/Repositories/`. Never in Controller. |

`EntityRepository::queryBuilder()` returns a pre-configured `Builder`. Legacy `createCommand()` in a Controller is debt; presence does NOT permit new violations.

## Exception Logging (catch convention)

> Triggers `catch / ExceptionLogHelper / SalesWeatherLogger / EILogger / application.log` → skill `<your-project>-exception-logging` (rules, examples, anti-patterns).

**Hard rule**: every `catch (\Exception $e)` SHALL call both `ExceptionLogHelper::logCaughtExceptionToApplication()` and a domain logger; never empty / `// ignore`.

## IN / NOT IN Queries

> Triggers `addInCondition / addNotInCondition / IN clause / array_values` → skill `<your-project>-in-queries` (compound LIKE+IN, empty-array guard, anti-patterns).

**Hard rule**: use `CDbCriteria::addInCondition()` / `addNotInCondition()`; never string interpolation; always `array_values($ids)`; guard empty arrays before `addNotInCondition`.

## Validator / DI / Controller Response

- Validator: `class XxxValidator extends CValidator`; rules: `['field', 'ext.validators.XxxValidator']`
- DI: `Yii::app()->getComponent('orderService')`; config `'components' => ['orderService' => ['class' => 'app.services.OrderService']]`
- AJAX uses the `Response` trait. Legacy `['err' => 0/1]` is deprecated.

| Status | Method |
|---|---|
| 200 | `$this->json(['success' => true, 'data' => $r, 'message' => ''])` |
| 400 | `$this->error('reason')` |
| 403 / 404 | `throw new CHttpException(403\|404)` |

## Raw SQL vs Query Builder

| Case | Approach |
|---|---|
| DML, fixed table | Always query builder |
| DDL (SHOW/TRUNCATE/DESCRIBE) or DML with dynamic table | Raw SQL + `$this->assertValidTableName($name)` |

`assertValidTableName()` SSOT lives in `EntityRepository` (`protected`). Legacy `private` copies in `SystemRepository` / `CiwebRepository` are debt — when a new Repo needs it, declare `protected` (pending unification).

## Repository Class Constants

Detail → `php/coding-style.md` "Magic Values". Single-value enums need no `AbstractEnum` subclass.

## PHP 5.6 substitutions (quick ref)

- Named args → `$options` array + `array_merge($defaults, $options)`
- Chainable: `CDbCommand` native; `CDbCriteria` needs wrapping
- Full constraint list → `php/coding-style.md` "PHP 5.6 polyfills"
