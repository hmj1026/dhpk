# database-reviewer — Yii 1.1 / MySQL traps

## Required Form (no string concat ever)

- `Yii::app()->db->createCommand($sql)->bindParam(':id', $id, PDO::PARAM_INT)->queryAll()`
- `Model::model()->findAll('id = :id', [':id' => $id])`
- IN/NOT IN: `CDbCriteria::addInCondition()` / `addNotInCondition()`, never interpolation (`.claude/rules/php/patterns.md`)

## Project Traps

- ORDER BY field cannot embed user input → whitelist
- LIMIT/OFFSET cast to `(int)` before SQL
- `queryRow()` returns `false` (not `null`) on no row
- `utf8_unicode_ci` ordering ≠ ASCII → tests use `strcasecmp()`
- Repository methods named `forXxx`; ALL SQL lives in Repository (Controller / trait / Domain service must not call db directly)
- AR must define `model($className=__CLASS__)`; correct `tableName()`, `primaryKey()`, `rules()`
- Money: `bcadd/bcmul`; rounding via custom bcround (`memory/bcmath-rounding-trap.md`)

## Environment

- DB: `<your-db-name>` (MySQL 5.7.33)
- Run: `docker exec -i -w <container-workdir> ${PHP_CONTAINER:-php} php -r "..."`
