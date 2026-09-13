# code-reviewer — FastAPI traps

Generic Python idioms → `code-reviewer/python.md`. Auth / secrets / CORS /
injection → `security-reviewer/fastapi.md`. Query plans / N+1 / index coverage →
`database-reviewer/fastapi.md`. Locate the app entry (`main.py`, `app/main.py`);
review changed routers/schemas/deps first.

| Lane | Trigger | Action | Non-apply |
|---|---|---|---|
| Async correctness | blocking DB/HTTP client (`requests`, sync `psycopg`, sync `Session`) inside an `async def` route | async client (`httpx.AsyncClient`, async SQLAlchemy) | a plain `def` route that FastAPI threadpools — not a blocking-in-async finding |
| Dependency injection | DB session / settings created inline in the handler; auth logic duplicated per route | `Depends(get_db)` / `Depends(get_settings)`; one auth dependency | a one-off script or test that constructs the session on purpose |
| Pydantic schemas | one model reused for create + update + response; write endpoint without request validation; response leaks internal fields | separate `Create`/`Update`/`Read`; validate the body; explicit `response_model` | a read-only probe schema that is already a dedicated `Read` model |
| OpenAPI | list endpoint without pagination; missing `response_model` / error responses in docs | add pagination params; document responses | internal admin routes explicitly marked excluded from OpenAPI |
| Structure | route logic duplicated across handlers; external HTTP client with no timeout | extract into a service/dependency; set a timeout | a single-handler prototype that already uses a shared client |

## Worked example

```python
# BAD — sync HTTP call blocks the event loop for every concurrent request
@app.get("/rate")
async def rate():
    return requests.get(UPSTREAM, timeout=5).json()
# GOOD — async client, shared, with a timeout
@app.get("/rate")
async def rate(client: httpx.AsyncClient = Depends(get_client)):
    r = await client.get(UPSTREAM, timeout=5.0)
    return r.json()
```

```python
# BAD — response model echoes the hashed password
class UserOut(BaseModel):
    id: int; email: str; hashed_password: str
# GOOD — response model exposes only public fields
class UserOut(BaseModel):
    id: int; email: str
```

Diagnostics (only if configured): `ruff check .` · `mypy .` · `pytest`.
