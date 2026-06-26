# migration-reviewer — Yii 1.1 / Laravel / Doctrine traps

Applies when the `yii-1.1` module is active OR `composer.json` declares `yiisoft/*`
(Laravel / Doctrine equivalents noted inline). The framework-agnostic Audit Checklist
lives in the agent body; this sheet adds the concrete form, naming, and verification
commands. Cross-link: `modules/yii-1.1/references/framework.md` — Yii 1.1 `CDbMigration`
API + `yiic migrate` flow.

## Naming Convention

Recommended filename pattern (Yii-flavoured example — adapt for your framework):

```
m<YYMMDD>_<HHMMSS>_<env-prefix>_<Author>_<TaskSlug>.php
```

Example: `m220621_093429_42_dev_AddColumn_OrderPaidAt.php`

- `m220621_093429` — framework-native timestamp (Yii `yiic migrate` compatible; substitute for your framework's expected format)
- `<env-prefix>` — deployment footprint marker (e.g. `42` = customer site 42). Use per project deploy footprint; in single-tenant projects this can be omitted.
- `<Author>` — author tag for PR provenance
- `<TaskSlug>` — UpperCamelCase descriptive slug

Migrations not matching the project's convention → fail.

## Required Form (Yii 1.1 example)

```php
class m220621_093429_42_dev_AddColumn_OrderPaidAt extends CDbMigration
{
    public function safeUp()    { /* DDL via $this->addColumn() / $this->createIndex() */ }
    public function safeDown()  { /* truly reversible — dropColumn / dropIndex fully restoring */ }
}
```

- Always `safeUp` / `safeDown` (transaction-wrapped), not `up` / `down`
- DDL via the framework's API (`addColumn` / `dropColumn` / `createIndex` / `addForeignKey`); avoid `$this->execute("ALTER ...")` literal SQL
- Acceptable raw SQL exceptions: `SHOW TABLE STATUS` / `INFORMATION_SCHEMA` queries, complex DML

For Laravel, the equivalent contract is `Migration::up()` / `Migration::down()`, using the `Schema` and `DB` facades. For Doctrine, `AbstractMigration::up(Schema $schema)` / `down(Schema $schema)`.

## Verification commands

Adapt these for your project's container layout. Defaults follow dhpk convention: `${MYSQL_CONTAINER:-mysql}`, `${PHP_CONTAINER:-php}`, `${DB_NAME:-<your-db>}`.

```bash
# Row count estimate for a target table (gauge ALTER duration)
docker exec -i "${MYSQL_CONTAINER:-mysql}" \
  mysql -uroot "${DB_NAME:-<your-db>}" -e "SELECT COUNT(*) FROM <table>"

# Inspect column / index structure
docker exec -i "${MYSQL_CONTAINER:-mysql}" \
  mysql -uroot "${DB_NAME:-<your-db>}" -e "SHOW CREATE TABLE <table>"

# Yii: dry-run migrate-up (Laravel: php artisan migrate --pretend; Doctrine: doctrine:migrations:execute --dry-run)
docker exec -i "${PHP_CONTAINER:-php}" \
  php yiic migrate to <migration-name> --interactive=0

# Yii: dry-run migrate-down (Laravel: php artisan migrate:rollback --pretend)
docker exec -i "${PHP_CONTAINER:-php}" \
  php yiic migrate down --interactive=0
```
</content>
