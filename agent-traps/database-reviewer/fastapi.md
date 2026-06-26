# database-reviewer — FastAPI (SQLAlchemy 2.0 async + Alembic) traps

Applies when the `fastapi` module is active OR `pyproject.toml` declares `sqlalchemy` / `alembic`.

- **Async session lifecycle** — use `AsyncSession` from an `async_sessionmaker`; yield one session per request via a FastAPI dependency and close it in `finally` (or `async with`). A session is NOT concurrency-safe: never share one across requests or across concurrent `asyncio.gather` tasks — give each task its own session.
- **2.0-style `select()`, not legacy Query** — `await session.execute(select(Model).where(...))` then `.scalars().all()` / `.scalar_one_or_none()`. The `session.query(...)` 1.x API is legacy; flag it on a 2.0 codebase.
- **No string-built SQL** — pass parameters as bind values, never f-strings / concatenation. Raw SQL only via `text("... :id")` with bound params.
- **Transaction per request** — one unit of work per request: `async with session.begin():` (or explicit `await session.commit()` / `await session.rollback()` on error). Don't auto-commit mid-handler; roll back the whole request on exception.
- **Async lazy-load N+1** — implicit lazy loads raise `MissingGreenlet` under async; eager-load relationships with `selectinload()` / `joinedload()` instead of looping. Set `expire_on_commit=False` so attribute access after commit doesn't trigger lazy IO.
- **Alembic up/down** — every revision implements both `upgrade()` and `downgrade()`; treat `--autogenerate` output as a draft and review the diff (it misses server defaults, type changes, renames). Use `op.batch_alter_table` for SQLite ALTER; verify the migration runs forward and back on a scratch DB.
