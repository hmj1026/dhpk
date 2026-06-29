# tdd-guide — Python traps

pytest + pytest-asyncio conventions for async FastAPI / SQLAlchemy services. Detail: pytest module `skills/pytest-async/SKILL.md`.

## Test layout

| Path | Rule |
|------|------|
| `tests/unit/` | Fast, isolated; mock externals at the boundary; no network |
| `tests/integration/` | ASGI client + real query paths against an in-memory store |

- `async def test_*` runs under `pytest-asyncio` with `asyncio_mode = "auto"`; otherwise mark each with `@pytest.mark.asyncio` (or use `anyio`).
- Method names describe behavior: `test_<subject>_<condition>_<expected>`.

## Conventions

- **Fixtures over `setUp`** — share setup via `@pytest.fixture`, not class `setUp`; build object factories instead of hand-rolling rows in every test.
- **Async DB session, rollback per test** — open an async engine on `sqlite+aiosqlite:///:memory:`, yield an `AsyncSession`, and roll back the transaction per test so cases stay hermetic and order-independent.
- **FastAPI integration** — drive the app with `httpx.AsyncClient(transport=ASGITransport(app=app), ...)`; override DB/auth via `app.dependency_overrides`. Assert on status + response schema, not internal ORM state.
- **Cover the error paths** — 422 validation, 401/403 auth, 404, timeouts, rollback, boundary inputs — not just the happy path.
- **`@pytest.mark.parametrize`** for table-driven cases instead of copy-pasted bodies; mark live external-service tests opt-in and exclude them from the default run.
- **Filesystem / env / clock isolation** — use `tmp_path`, `monkeypatch.setenv`, and `monkeypatch.setattr`; never touch the real `$HOME` / network / wall-clock `datetime.now` (inject or freeze a clock).
- **No mutable default args** — `def f(x=None)` then build inside, never `def f(x=[])` / `={}`; a shared default leaks state across calls and tests.

## Run

```bash
pytest --cov   # coverage floor enforced via --cov-fail-under
```
