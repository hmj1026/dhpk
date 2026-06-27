---
name: pytest-async
description: 'Async pytest + pytest-asyncio testing: asyncio_mode=auto, SQLite fixtures, httpx.AsyncClient + ASGITransport, unit/integration split, coverage floor, live markers. Use when writing or reviewing async FastAPI/SQLAlchemy tests, or enforcing TDD. Not for production code. Output: offline-green async tests.'
---

# pytest (async)

Test strategy for async Python services. Pairs with the `python` and `fastapi`
modules. TDD: write the failing test first (red), implement to green, refactor.

## Configuration

- `pytest-asyncio` with `asyncio_mode = "auto"` (in `[tool.pytest.ini_options]`)
  — `async def test_*` runs without a per-test `@pytest.mark.asyncio` decorator.
- `pytest-cov` enforces a coverage floor (ccas: `--cov-fail-under=70`, measured on
  unit tests). `pytest-timeout` guards hangs.
- Layout: `tests/unit/` (fast, isolated) and `tests/integration/` (ASGI client +
  real query paths). Exclude wiring-only modules (`__main__.py`, app factory) from
  the *unit* coverage measure; cover them in integration instead.

## Fixtures

- **In-memory SQLite** for both unit and integration: create an async engine on
  `sqlite+aiosqlite:///:memory:`, create tables per test (or per session with a
  rollback-per-test transaction), yield an `AsyncSession`. Keep it fast and hermetic.
- Build object factories/builders for domain models rather than hand-rolling rows in
  every test.
- Mock external services (Gmail, Telegram, LLM) at the boundary — inject fakes via
  the same `Depends`/Protocol seams the app uses. Never hit the network in unit tests.

## FastAPI integration tests

- Drive the app with `httpx.AsyncClient(transport=ASGITransport(app=app), ...)` —
  no live server needed. Override DB/auth dependencies with `app.dependency_overrides`
  to inject the in-memory session and a test user.
- Assert on status + response schema, not on internal ORM state. Cover the error
  paths (422 validation, 401/403 auth, 404) — not just the happy path.

## Markers & opt-in live tests

- Tests that hit a real external service (e.g. `@pytest.mark.live_fubon` in ccas)
  must be **opt-in** and excluded from the default run / CI. Register markers in
  config and select with `-m "not live_fubon"` by default.
- Use `@pytest.mark.parametrize` for table-driven cases (parsers, classifiers,
  date-boundary logic) instead of copy-pasted test bodies.

## What to test first

- Pure domain logic (parsers, classifiers, calculators) — highest value, cheapest.
- Boundary/edge cases that bit you before: timeouts, malformed input, rollback
  paths, pagination limits, regex ReDoS guards. ccas's bug fixes (CTBC due-date,
  classify rollback, PDF timeout) each landed with a regression test.
- A bug fix without a failing-first regression test is incomplete.

## When NOT to Use

Not for production code (see `python-pro` / `fastapi-pro`) and not for static
config (see `python-static-checks`). Load when writing or reviewing tests for an
async FastAPI/SQLAlchemy service.

## Output

A suite with `asyncio_mode = "auto"`, in-memory SQLite fixtures, FastAPI driven
via `httpx.AsyncClient` + `ASGITransport` (no live server), a unit vs integration
split, mocked external services, and opt-in markers for live calls — bug fixes
landing with a failing-first regression test.

## Verification

- `pytest -m "not live_*"` runs green offline with no network access.
- Coverage meets the floor (`--cov-fail-under`); wiring-only modules are excluded
  from the unit measure.
- Each bug fix has a regression test that failed before the fix.
