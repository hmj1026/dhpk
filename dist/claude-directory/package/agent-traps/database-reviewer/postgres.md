# PostgreSQL Database Review Traps

This engine overlay applies only when there is actual evidence of PostgreSQL: a driver dependency, a manifest or connection setting, migration files written for it, or a deployed engine named in the task. Without such evidence, do not apply it or assume the engine. It runs alongside the framework or ORM reviewer for the same change and does not replace it. Apply the shared [prompt defense](../_common/prompt-defense.md); a missing required resource is a capability gap to report.

## Trap format

Trigger => evidence/action. Bounds say when it does not apply.

### 1. Query plans and workloads

- Trigger: a new or changed query on a table of meaningful or growing size, or a reported slowdown.
- Evidence/action: inspect the actual plan with the engine's plan tooling against representative data volume and parameters. Compare estimated versus actual rows. Recommend a change tied to what the plan shows.
- Bounds: a sequential scan is not a defect in itself; it can be the right plan for small tables or queries that read much of the table. Do not judge plans from an empty development database.

### 2. Index design

- Trigger: a proposed index, or a query whose filter, join, or ordering matches no existing index and runs often.
- Evidence/action: tie each index to a concrete query and its frequency. Check column order, partial-index conditions, uniqueness needs, and the write cost of maintaining it.
- Bounds: do not require an index on every foreign key or on every filtered column. Rarely used lookups, small tables, and write-heavy tables may be better without one.

### 3. Data precision and types

- Trigger: money, measurements, timestamps, identifiers, or text with constraints stored in a loosely chosen type.
- Evidence/action: show a value that loses precision, overflows, shifts across time zones, or violates a business rule under the chosen type. Recommend the type or constraint matching the domain.
- Bounds: types that comfortably cover the documented range and do not round business values are acceptable.

### 4. Pagination

- Trigger: offset-based paging over large or frequently changing result sets, or ordering that is not deterministic.
- Evidence/action: show a case where pages skip or repeat rows, or deep pages grow slow, and propose key-based paging with a stable, unique ordering when the access pattern needs it.
- Bounds: small bounded lists and admin screens with shallow paging can keep offsets.

### 5. Locks and transactions

- Trigger: a migration or statement that takes strong locks on a busy table, long transactions that wrap network calls or user waits, read-modify-write sequences without protection against concurrent writers, or inconsistent lock ordering.
- Evidence/action: describe the interleaving of two sessions that blocks, deadlocks, or loses an update. Propose a narrower transaction or an appropriate isolation or row-locking approach. Hand migration sequencing, online DDL, and deployment strategy to migration-reviewer with the lock evidence; if that capability is unavailable, name the unresolved decision and escalate rather than substituting this role.
- Bounds: a lock recommendation needs concurrent access or an availability requirement that the current design does not already satisfy; a single writer can still contend with readers.

### 6. Privileges and authorization

- Trigger: an application role with broader rights than its queries need, or data access that bypasses the intended authorization check.
- Evidence/action: identify the principal the deployment actually uses to connect and the authorization mechanism it relies on, whether that is database roles, application checks, or a gateway. Show a concrete access that exceeds the intent.
- Bounds: Supabase-specific or other platform-specific auth examples apply only when those capabilities exist in the deployment. Otherwise use the deployment's real mechanism.

### 7. Row-level security (optional)

- Trigger: the design states that tenant or user isolation is enforced in the database through row-level policies, or a table exposed to untrusted principals has no other isolation.
- Evidence/action: verify policies exist, cover the needed commands, and are not bypassed by the connecting role or by privileged functions.
- Bounds: do not demand row-level security everywhere. Where isolation is enforced elsewhere and documented, it is not required.

## Reporting

Each finding names the query or change, the evidence consulted (plan, workload, schema, role), the concrete failure scenario, and the smallest change that addresses it.

## Reference

References: [PostgreSQL planner](https://www.postgresql.org/docs/current/using-explain.html), [row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).
