# performance-analyzer — Yii 1.1 / MySQL traps

Declare your project's actual high-volume tables via the `hot_tables` userConfig key
(or list them in CLAUDE.md / `.claude/rules/`). The rows below are **illustrative only**
(shapes drawn from a POS system) — substitute your own table/column names.

| Trigger | Action | Non-apply |
|---|---|---|
| Date-range scan on transaction header / detail without a `(tenant_key, date)` composite index | add the composite index; constrain the date-range predicate | — |
| N+1 via lazy AR relation inside `foreach` (order header / line) | AR eager load — `Model::model()->with('relation')->findAll($criteria)` — or a single JOIN via `queryBuilder()` | — |
| Missing index on `(tenant_key, product_code)` (stock / stock_adjustment) | add the composite index | — |
| Unindexed JOIN on `product_code` (inventory) | index the JOIN column | — |
| Full scan on unbounded `findAll()` (payment actions) | bound the query; add a covering index | `findAll` on a bounded in-memory fixture |
| EXPLAIN `type=ALL`, `rows` > 50k, or `Extra=Using filesort` on an unbounded result set | add/adjust indexes; bound the result set; rewrite the query | `type=ALL` on a tiny lookup table |

## Diagnostics

Suspicious N+1 patterns to grep for:

```bash
# AR / ORM lazy relation access inside a loop (substitute your repository/domain paths)
rg -n 'foreach.*\$.*->.*[a-z]' <repository-dir> <domain-dir>
# Repeated row-fetch calls inside a method body
rg -n 'queryRow|queryAll|findAll|fetchOne|fetchAll' <repository-dir> | awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20
```

EXPLAIN:

```bash
docker exec -i ${MYSQL_CONTAINER:-mysql} mysql -u root -proot <your-db-name> -e \
  "EXPLAIN SELECT h.*, d.* FROM <hot_table> h
   JOIN <detail_table> d ON d.parent_no = h.parent_no
   WHERE h.<tenant_key> = '<key>' AND h.date BETWEEN '2026-01-01' AND '2026-01-31';"
```

SHOW INDEX:

```bash
docker exec -i ${MYSQL_CONTAINER:-mysql} mysql -u root -proot <your-db-name> -e \
  "SHOW INDEX FROM <hot_table>; SHOW INDEX FROM <another_hot_table>;"
```

## Environment

- DB: `<your-db-name>` (MySQL 5.7.33)
- Container: `${MYSQL_CONTAINER:-mysql}` (MySQL), `${PHP_CONTAINER:-php}` (PHP)

## References

- `modules/yii-1.1/references/patterns.md` (Repository conventions, queryBuilder)
- `modules/phpunit-5.7/references/testing.md` (PHPUnit 5.7, integration test patterns)
