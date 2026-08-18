# migration-reviewer — Yii 1.1 / Laravel / Doctrine traps

Applies when the `yii-1.1` module is active OR `composer.json` declares `yiisoft/*`
(Laravel / Doctrine equivalents noted as Non-apply pointers, not a second sheet). The
framework-agnostic Audit Checklist lives in the agent body; this sheet adds the
concrete form, naming, and verification commands. Cross-link:
the project's Yii 1.1 framework reference — Yii 1.1 `CDbMigration` API + `yiic migrate`
flow.

| Trigger | Action | Non-apply |
|---------|--------|-----------|
| Migration filename not matching the project's convention | Yii-flavoured pattern: `m<YYMMDD>_<HHMMSS>_<env-prefix>_<Author>_<TaskSlug>.php` (example: `m220621_093429_42_dev_AddColumn_OrderPaidAt.php`). `m220621_093429` — framework-native timestamp (`yiic migrate` compatible). `<env-prefix>` — deployment footprint marker (e.g. `42` = customer site 42). `<Author>` — PR provenance. `<TaskSlug>` — UpperCamelCase descriptive slug. Fail mismatches | Single-tenant projects may omit `<env-prefix>` |
| `CDbMigration` using `up` / `down`, or a class that is not transaction-wrapped | Always `safeUp` / `safeDown` (transaction-wrapped). Form: `class m… extends CDbMigration` with `safeUp()` doing DDL via `$this->addColumn()` / `$this->createIndex()` and `safeDown()` truly reversible (`dropColumn` / `dropIndex` fully restoring) | Laravel `Migration::up()` / `Migration::down()` via `Schema` and `DB` facades; Doctrine `AbstractMigration::up(Schema $schema)` / `down(Schema $schema)` — pointer only, not a second sheet. Irreversible data backfill with an explicit comment |
| DDL via `$this->execute("ALTER ...")` literal SQL | Use the framework's API: `addColumn` / `dropColumn` / `createIndex` / `addForeignKey` | `SHOW TABLE STATUS` / `INFORMATION_SCHEMA` queries and complex DML (already listed raw-SQL exceptions) |
| Shipping a migration without structural or dry-run verification | Gauge ALTER duration: `SELECT COUNT(*) FROM <table>`. Inspect structure: `SHOW CREATE TABLE <table>`. Yii dry-run up: `php yiic migrate to <migration-name> --interactive=0`. Yii dry-run down: `php yiic migrate down --interactive=0`. Defaults: `${MYSQL_CONTAINER:-mysql}`, `${PHP_CONTAINER:-php}`, `${DB_NAME:-<your-db>}` (via `docker exec -i` when using containers) | Laravel: `php artisan migrate --pretend` / `php artisan migrate:rollback --pretend`; Doctrine: `doctrine:migrations:execute --dry-run` — pointer only, not a second sheet |
