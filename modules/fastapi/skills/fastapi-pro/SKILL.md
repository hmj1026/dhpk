---
name: fastapi-pro
description: 'FastAPI + SQLAlchemy 2.0 async patterns + review checklist: routers, Depends DI, Pydantic schemas, session/transaction discipline, Alembic safety, auth/CORS/errors. Use when writing or reviewing FastAPI routes, async repositories, or migrations. Not for non-web Python. Output: layered, transaction-safe API.'
---

# FastAPI + SQLAlchemy (async) Pro

Web-API layer guidance. Builds on the `python` module (typing, async discipline,
ruff/pyright). Layering: **Router → Service → Repository**; routers stay thin
(validate, delegate, shape response), business logic lives in services,
data-access in repositories.

## Routers & dependency injection

- Inject collaborators via `Depends(...)` — DB session, current user, settings.
  Don't instantiate sessions/clients inside the handler.
- Declare an explicit `response_model=` and `status_code=` on every route. Never
  return raw ORM objects — return a Pydantic response schema (prevents lazy-load
  serialization surprises and leaking columns).
- Keep one session per request, yielded by a dependency; commit/rollback at the
  edge of the unit of work, not scattered through services.
- Version/prefix routers (`APIRouter(prefix=...)`); group by domain. Paginate list
  endpoints with a consistent envelope (ccas standardized `/pipeline/runs`
  pagination) and bound max page size.

## Pydantic schemas

- Separate **request** (`...Create` / `...Update`) and **response** (`...Out`)
  models from ORM models. Use `model_config = ConfigDict(from_attributes=True)` for
  ORM→schema conversion.
- Validate at the boundary: constrained types, field validators. Reject bad input
  with 422 rather than letting it reach the DB.
- Don't put secrets/internal fields in response schemas.

## SQLAlchemy 2.0 async

- `async with AsyncSession(...) as session:` — every query is
  `await session.execute(select(...))`; use `.scalars()` / `.scalar_one_or_none()`.
- **One transaction per unit of work.** Wrap multi-statement writes in
  `async with session.begin():`. Don't hold a session across an `await` to an
  external service it doesn't need.
- Avoid N+1: eager-load with `selectinload` / `joinedload` for relationships you
  render. ccas batch-aggregates monthly budget totals to kill a 1+N frontend load.
- Set `busy_timeout` / pool sensibly (SQLite WAL in ccas uses a 30s busy timeout
  for write atomicity). Always parameterize — never f-string SQL.
- Repositories return domain objects or `None`; they don't leak `Session` upward.

## Alembic migrations

- Autogenerate then **review** the diff — autogen misses server defaults, enum
  changes, and data migrations. Provide a real `downgrade()`.
- Make migrations idempotent/reversible; name constraints and indexes explicitly so
  they don't collide across environments. Test `upgrade` then `downgrade` locally.
- For large tables, prefer additive online-safe DDL; backfill in batches, not one
  giant `UPDATE`. (The migration-reviewer agent covers this in depth.)

## CORS, auth, errors

- Configure CORS allow-origins from settings (env), not `*` in production.
- Centralize error handling: map the app's exception hierarchy to HTTP responses
  via exception handlers; don't leak tracebacks. Return structured error bodies.
- Auth dependencies (token/cookie) belong in a shared dependency; handle the OAuth
  callback's `error` param and rotate state safely (ccas hardened Gmail OAuth this
  way). The `sec` triggers route auth/oauth/ingestor edits to security-reviewer.
- Guard external I/O with timeouts; isolate untrusted inputs (ccas runs PDF parsing
  under `asyncio.wait_for` to contain poison inputs).

## When NOT to Use

Not for non-web Python (see `python-pro`), and not for writing the tests that
exercise these endpoints (see `pytest-async`). Load when building or reviewing
routers, async repositories, or Alembic migrations.

## Output

FastAPI code that follows Router → Service → Repository: every route declares
`response_model` + `status_code` and returns a Pydantic schema (never a raw ORM
object), one session per request, writes wrapped in a single transaction,
eager-loaded relationships, and a reviewed, reversible Alembic migration.

## Verification

- No route returns a raw ORM object; request and response schemas are separate.
- Each unit of work commits/rolls back once at the edge; no session held across
  an unrelated `await`.
- `alembic upgrade head` then `downgrade` round-trips locally; CORS origins and
  error handlers come from settings — no hardcoded `*` or leaked tracebacks.
