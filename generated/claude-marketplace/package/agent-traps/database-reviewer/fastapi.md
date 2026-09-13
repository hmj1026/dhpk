# database-reviewer × fastapi

For the database-reviewer agent on FastAPI (SQLAlchemy 2.0 async + Alembic). Neighboring agents: migration-reviewer (Alembic reversibility), security-reviewer (bind params), performance-analyzer (N+1 / selectinload).

Applies when the `fastapi` module is active OR `pyproject.toml` declares `sqlalchemy` / `alembic`.

| Trigger | Action | Non-apply |
|---|---|---|
| Session shared across requests or `asyncio.gather` tasks; missing close | `AsyncSession` from an `async_sessionmaker`; yield one session per request via a FastAPI dependency and close it in `finally` (or `async with`). Give each concurrent task its own session. | sync FastAPI routes that are not using async SQLAlchemy |
| `session.query(...)` 1.x API on a 2.0 codebase | `await session.execute(select(Model).where(...))` then `.scalars().all()` / `.scalar_one_or_none()` | — |
| SQL built with f-strings / concatenation | pass bind values; raw SQL only via `text("... :id")` with bound params | — |
| auto-commit mid-handler; no rollback on exception | one unit of work per request: `async with session.begin():` (or explicit `await session.commit()` / `await session.rollback()` on error) | — |
| looping relationships / implicit lazy load under async (`MissingGreenlet`) | eager-load with `selectinload()` / `joinedload()`; `expire_on_commit=False` so post-commit attribute access does not trigger lazy IO | — |
| Alembic revision missing `downgrade()`; unreviewed `--autogenerate` | every revision implements both `upgrade()` and `downgrade()`; review the diff (it misses server defaults, type changes, renames). `op.batch_alter_table` for SQLite ALTER; verify forward and back on a scratch DB | Alembic revision that documents irreversible data backfill |
