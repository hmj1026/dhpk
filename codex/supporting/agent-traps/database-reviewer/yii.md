# database-reviewer × yii-1.1

For the database-reviewer agent on Yii 1.1 / MySQL. Neighboring agents: security-reviewer (bind params), performance-analyzer (query count), tdd-guide (DAO vs AR asserts).

SQL shape: `bindParam` and `addInCondition`. IN-clause pointer: the project's Yii repository conventions. Framework: the project's Yii 1.1 framework reference. Coding style: the project's PHP coding rules.

| Trigger | Action | Non-apply |
|---|---|---|
| SQL built with string concat / interpolation | `Yii::app()->db->createCommand($sql)->bindParam(':id', $id, PDO::PARAM_INT)->queryAll()` or `Model::model()->findAll('id = :id', [':id' => $id])` | — |
| IN / NOT IN with interpolated values | `CDbCriteria::addInCondition()` / `addNotInCondition()` — the project's Yii repository conventions | — |
| ORDER BY field from user input | whitelist the column | — |
| LIMIT/OFFSET from request | cast to `(int)` before SQL | — |
| empty-result check on `queryRow()` vs `null` | DAO `queryRow()` returns `false` on no row; AR `find*` returns `null` (DAO ≠ AR) | — |
| `utf8_unicode_ci` ordering compared with ASCII `strcmp()` | tests use `strcasecmp()` | — |
| Controller / trait / Domain service calling db directly | Repository methods named `forXxx`; ALL SQL lives in Repository | — |
| AR missing `model($className=__CLASS__)`, or wrong `tableName()` / `primaryKey()` / `rules()` | define them | — |
| Money arithmetic with `+` / `*` / float | `bcadd`/`bcmul`; rounding via custom bcround (`memory/bcmath-rounding-trap.md`) | non-money integer counts |

Run: `docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} php -r "..."`.
