# Yii 1.1 — Patterns & Anti-patterns

> Extends `~/.claude/rules/common/patterns.md`. Stock-Yii guidance only;
> project-specific repository wrappers, service locators, query builders,
> and loggers live in your project's own docs.

## Layered architecture (when used)

If the project layers `Controller → Service → Repository`:

- **Controller**: thin HTTP entry. Validate input, dispatch to a service,
  return a response. No SQL, no business logic.
- **Service**: orchestrates business rules. Transaction boundary, validation,
  external API calls, rollback.
- **Repository**: holds all SQL / `CDbCriteria` / `CDbCommand` for a given
  aggregate. Returns domain values (entities or DTOs), not raw `CActiveRecord`
  arrays.

Yii 1.1 itself does not provide a Repository base class — projects that adopt
this pattern usually create their own `BaseRepository` and inject it via
`Yii::app()->getComponent(...)`.

## SQL location SSOT

When using a repository pattern, **all SQL lives in repositories**. Controllers
and Services SHALL NOT call `Yii::app()->db->createCommand()` directly or
build SQL strings.

- Prefer `$repo->queryBuilder()` chains (project query toolkit, if present) over
  raw `createCommand()`.
- `queryRow()` returns `false` on miss (not `null`) — check with `!$result`.
- IN clauses: `CDbCriteria::addInCondition('col', $ids)` — never string interpolation.
- Bind parameters: `$cmd->bindParam(':id', $id, PDO::PARAM_INT)`.

If your project enables a different framework module (not yii-1.1), substitute
the framework's repository / query convention.

## N+1 avoidance

- Always eager-load relations consumed in loops: `Model::model()->with('rel')->findAll(...)`.
- Suspicious patterns to grep for inside repositories / domain code:

  ```bash
  rg -n 'foreach.*\$.*->.*[a-z]' <repository-dir> <domain-dir>
  rg -n 'queryRow|queryAll|findAll' <repository-dir>
  ```

  Adjust the paths to your project's actual repository / domain layout.

## Exception handling

**Hard rule**: every `catch (\Exception $e)` SHALL log to the project's
structured logger; never empty `catch` blocks and never `// ignore` comments.

Yii 1.1 ships `Yii::log($msg, $level, $category)` as the baseline. Most
projects layer a typed logger on top — consult your project docs for the
canonical entry point.

## IN / NOT IN queries

- Use `CDbCriteria::addInCondition()` / `addNotInCondition()`. Never string interpolation.
- Always `array_values($ids)` before passing — Yii 1.1 binds by positional index, so
  associative arrays misalign placeholders.
- Guard empty arrays before `addNotInCondition` (it throws on empty).

## Validator / DI / Controller Response

- **Validator**: `class XxxValidator extends CValidator`; rule entry:
  `['field', 'ext.validators.XxxValidator']`.
- **DI**: `Yii::app()->getComponent('orderService')`; configure in
  `'components' => ['orderService' => ['class' => 'app.services.OrderService']]`.
- **AJAX**: standardise on a single envelope shape (e.g.
  `['success' => bool, 'data' => mixed, 'message' => string]`). Old
  Yii-style `['err' => 0|1]` payloads are noise — pick one shape and stick.

| Status | Method |
|---|---|
| 200 | Return JSON envelope: `$this->renderJson(['success' => true, 'data' => $r])` |
| 400 | Return JSON envelope with `success => false` and a user-safe message |
| 403 / 404 | `throw new CHttpException(403\|404)` |

## Raw SQL vs Query Builder

| Case | Approach |
|---|---|
| DML, fixed table | Always use `CDbCriteria` / project query builder |
| DDL (`SHOW` / `TRUNCATE` / `DESCRIBE`) or DML with dynamic table | Raw SQL **only** with table-name whitelisting (assert against a known set) |

Dynamic table names are a SQL injection vector — never interpolate request input
into the table position. Whitelist against `Yii::app()->db->schema->getTables()`
or a project-maintained allowlist.

## Append-only exemption (when adding new symbols only)

When adding entirely new methods / classes that do not touch existing call
sites, the project's "no `createCommand()` in Controller" rule still applies
to the new code. Don't introduce new debt under the banner of "minor addition".

## Refactor cleanup checklist (Yii 1.1)

Consult this when invoking the `refactor-cleaner` agent on a Yii 1.1
project. Cross-reference: `dhpk:refactor-cleaner` agent body covers
the language-agnostic flow; this list covers the Yii-1.1-specific
traps that are easy to miss when removing dead code.

- **Stale `relations()`** — when a model column is removed, the
  corresponding `relations()` entry referencing it (via `FK`/`through`)
  also becomes dead. `cx references --name <RelationName>` to confirm
  no live caller uses it before removal.
- **Disabled `before/afterSave` / `before/afterFind` hooks** — early
  returns or empty hook bodies are usually leftovers from feature
  flag rollouts. `git log -p protected/models/<Model>.php` to check
  the original purpose before removing.
- **Obsolete module aliases in `protected/config/main.php`** — modules
  removed long ago often leave behind `'modules' => [...]` entries
  whose target paths no longer exist. `cx overview protected/modules/`
  to confirm before pruning.
- **Behaviors registered on a base controller that all descendants
  override** — the behavior class still loads on every request but
  its hooks never fire. Either remove the registration or fix the
  override pattern.
- **`CHtml::scriptFile()` / `registerScript()` calls in view partials
  that nobody renders** — orphan partials accumulate after page
  redesigns; the JS assets they pull in still ship in the page bundle.
  `cx references --name <PartialName>` before removing the partial,
  then audit the script registration.
- **Rename Yii component / module names** — must go through
  `gitnexus_rename`. Yii's alias autoload makes string-based search
  brittle (the same component name appears in `protected/config/*.php`
  as a config key, in `import` paths, and in `Yii::app()->getComponent()`
  string lookups). find-and-replace is forbidden.
