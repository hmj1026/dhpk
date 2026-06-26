# performance-analyzer — Yii 1.1 / MySQL traps

Applies when the `yii-1.1` module is active OR `composer.json` declares `yiisoft/*`.

## High-Risk Tables

Declare your project's actual high-volume tables via the `hot_tables` userConfig key
(or list them in CLAUDE.md / `.claude/rules/`). The table below is **illustrative only**
(shapes drawn from a POS system) — substitute your own table/column names.

| Table (example) | Risk | Common Anti-Pattern |
|-------|------|---------------------|
| transaction header / detail | HIGH | Date-range scan without `(tenant_key, date)` composite index |
| order header / line | HIGH | N+1 via lazy AR relation inside `foreach` |
| stock / stock_adjustment | MEDIUM | Missing index on `(tenant_key, product_code)` |
| inventory | MEDIUM | Unindexed JOIN on `product_code` |
| payment actions | MEDIUM | Full scan on unbounded `findAll()` |

## N+1 Detection

Suspicious patterns to grep for:

```bash
# AR / ORM lazy relation access inside a loop (substitute your repository/domain paths)
rg -n 'foreach.*\$.*->.*[a-z]' <repository-dir> <domain-dir>
# Repeated row-fetch calls inside a method body
rg -n 'queryRow|queryAll|findAll|fetchOne|fetchAll' <repository-dir> | awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20
```

Fix: Use AR eager load — `Model::model()->with('relation')->findAll($criteria)` — or a single JOIN query via `queryBuilder()`.

## How to Run EXPLAIN

```bash
docker exec -i ${MYSQL_CONTAINER:-mysql} mysql -u root -proot <your-db-name> -e \
  "EXPLAIN SELECT h.*, d.* FROM <hot_table> h
   JOIN <detail_table> d ON d.parent_no = h.parent_no
   WHERE h.<tenant_key> = '<key>' AND h.date BETWEEN '2026-01-01' AND '2026-01-31';"
```

Watch for: `type=ALL`, `rows` > 50k, `Extra=Using filesort` on unbounded result sets.

## How to Check Indexes

```bash
docker exec -i ${MYSQL_CONTAINER:-mysql} mysql -u root -proot <your-db-name> -e \
  "SHOW INDEX FROM <hot_table>; SHOW INDEX FROM <another_hot_table>;"
```

## Environment

- DB: `<your-db-name>` (MySQL 5.7.33)
- Container: `${MYSQL_CONTAINER:-mysql}` (MySQL), `${PHP_CONTAINER:-php}` (PHP)

## References

- `.claude/rules/php/patterns.md` (Repository conventions, queryBuilder)
- `.claude/rules/php/testing.md` (PHPUnit 5.7, integration test patterns)
</content>
</invoke>
