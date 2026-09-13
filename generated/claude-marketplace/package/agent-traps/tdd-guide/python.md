# tdd-guide — Python traps

pytest + pytest-asyncio conventions for async FastAPI / SQLAlchemy services. Detail: pytest module `skills/dhpk-pytest-async/SKILL.md`.

| Trigger | Action | Non-apply |
|---------|--------|-----------|
| Tests placed outside `tests/unit/` / `tests/integration/`, or mixed concerns in one tree | `tests/unit/`: fast, isolated; mock externals at the boundary; no network. `tests/integration/`: ASGI client + real query paths against an in-memory store | — |
| `async def test_*` without an asyncio runner | Run under `pytest-asyncio` with `asyncio_mode = "auto"`; otherwise mark each with `@pytest.mark.asyncio` (or use `anyio`) | Sync-only packages that do not use pytest-asyncio |
| Test method names that do not describe behavior | Name as `test_<subject>_<condition>_<expected>` | — |
| Class `setUp` or hand-rolled rows in every test | Share setup via `@pytest.fixture`; build object factories | — |
| Async DB tests sharing state across cases | Open an async engine on `sqlite+aiosqlite:///:memory:`, yield an `AsyncSession`, and roll back the transaction per test so cases stay hermetic and order-independent | — |
| FastAPI integration tests | Drive the app with `httpx.AsyncClient(transport=ASGITransport(app=app), ...)`; override DB/auth via `app.dependency_overrides`. Assert on status + response schema, not internal ORM state | — |
| Coverage of only the happy path | Cover error paths: 422 validation, 401/403 auth, 404, timeouts, rollback, boundary inputs | — |
| Copy-pasted test bodies for table-driven cases | Use `@pytest.mark.parametrize` | Live external-service tests already marked opt-in (exclude from the default run) |
| Tests touching real `$HOME` / network / wall-clock `datetime.now` | Isolate with `tmp_path`, `monkeypatch.setenv`, and `monkeypatch.setattr`; inject or freeze a clock | — |
| Mutable default args (`def f(x=[])` / `={}`) | Use `def f(x=None)` then build inside; a shared default leaks state across calls and tests | — |

## Run

```bash
pytest --cov   # coverage floor enforced via --cov-fail-under
```
