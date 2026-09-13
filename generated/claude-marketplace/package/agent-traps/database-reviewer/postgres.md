# database-reviewer × postgres

For the database-reviewer agent on PostgreSQL. Neighboring agents: performance-analyzer (query plan / N+1), migration-reviewer (schema up/down), security-reviewer (RLS / authz).

Engine-keyed sheet: load when a Postgres driver is present (`pg`/`postgres`/`@supabase/*`
in package.json, `psycopg`/`asyncpg`/`sqlalchemy[postgresql]` in pyproject, `*/pgsql*` in
composer, or a `supabase/` dir) alongside any framework sheet. Patterns adapted from
Supabase postgres-best-practices (credit: Supabase team, MIT).

| Trigger | Action | Non-apply |
|---|---|---|
| WHERE/JOIN column unindexed; FK without an index; composite index column order ≠ predicate | index it; **always index FKs**; equality columns first, then range | tiny lookup tables where Seq Scan is expected |
| `EXPLAIN ANALYZE` shows a Seq Scan on a large table; N+1 | add the covering index; batch / join | tiny lookup tables where Seq Scan is expected |
| `int` PK (overflow); `varchar(255)` with no reason; `timestamp` (no tz); money as `float` | `bigint`/`IDENTITY`; `text`; `timestamptz`; `numeric` | — |
| `OFFSET n` on a large table | keyset: `WHERE id > $last ORDER BY id LIMIT n` | — |
| missing PK / FK `ON DELETE` / `NOT NULL` / `CHECK`; quoted MixedCase identifiers | declare them; `lower_snake_case` unquoted | — |
| row-by-row `INSERT` in a loop; long transaction holding locks across an external call | multi-row `INSERT` / `COPY`; keep transactions short, no I/O inside | — |
| inconsistent lock order (deadlock); queue `SELECT` without `SKIP LOCKED` | `ORDER BY id FOR UPDATE`; `FOR UPDATE SKIP LOCKED` | — |
| multi-tenant table without RLS; policy calling `auth.uid()` per-row; RLS predicate column unindexed; `GRANT ALL` to app role; public-schema perms not revoked | enable RLS; wrap `(SELECT auth.uid())` so it's evaluated once; index the policy column; least privilege | public schema on a single-tenant app without RLS |

## Worked example

```sql
-- BAD — per-row function call + OFFSET; scans and re-evaluates auth.uid() each row
CREATE POLICY p ON orders USING (user_id = auth.uid());
SELECT * FROM orders ORDER BY id OFFSET 10000 LIMIT 20;
-- GOOD — auth.uid() evaluated once; keyset pagination; user_id indexed
CREATE POLICY p ON orders USING (user_id = (SELECT auth.uid()));
SELECT * FROM orders WHERE id > $last ORDER BY id LIMIT 20;
```

Diagnostics (read-only): `EXPLAIN (ANALYZE, BUFFERS) <query>`; `pg_stat_statements` for slow queries; `pg_stat_user_indexes` for unused indexes.
