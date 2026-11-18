
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

- Tests that hit a real external service must be **opt-in** and excluded from
  the default run / CI. Mark each one with the shared `live` marker and any
  specific name, for example `@pytest.mark.live` and `@pytest.mark.live_fubon`.
  Register those marker names in config.
- Select the offline set with `pytest -m "not live"`. `-m` is a boolean
  expression over exact marker names. It is not a glob, so `not live_*` is a
  parse error, and it does not isolate the network: a test without `live` is
  still selected.
- A test marked only `live_fubon`, without the shared `live` marker, is still
  selected by `not live`. The specific name does not imply the shared marker.
- Use `@pytest.mark.parametrize` for table-driven cases (parsers, classifiers,
  date-boundary logic) instead of copy-pasted test bodies.

## What to test first

- Pure domain logic (parsers, classifiers, calculators) — highest value, cheapest.
- Boundary/edge cases that bit you before: timeouts, malformed input, rollback
  paths, pagination limits, regex ReDoS guards. ccas's bug fixes (CTBC due-date,
  classify rollback, PDF timeout) each landed with a regression test.
- A bug fix without a failing-first regression test is incomplete.

## When NOT to Use

Not for production code (see `language.md` / `fastapi.md`) and not for static
config (see `static.md`). Load when writing or reviewing tests for an
async FastAPI/SQLAlchemy service.

## Output

A suite with `asyncio_mode = "auto"`, in-memory SQLite fixtures, FastAPI driven
via `httpx.AsyncClient` + `ASGITransport` (no live server), a unit vs integration
split, mocked external services, and a shared `live` marker on opt-in external
calls — bug fixes landing with a failing-first regression test.

## Verification

- `pytest -m "not live"` parses, selects at least the offline tests, and
  excludes every test that carries the shared `live` marker, including
  `live_fubon`. The expression is not a glob and does not itself block the
  network.
- Coverage meets the floor (`--cov-fail-under`); wiring-only modules are excluded
  from the unit measure.
- Each bug fix has a regression test that failed before the fix.
