# security-reviewer — FastAPI traps

| Pattern | Severity | Fix |
|---|---|---|
| Raw SQL via `text("... %s ..." % val)` or f-string into a query | CRITICAL | bound params: `text("... :id")` + `{"id": id}`, or the ORM `select()` with typed comparisons |
| Protected route without an auth dependency | CRITICAL | `Depends(get_current_user)` (or a router-level dependency); never trust a client-supplied `user_id` in the body/query for authorization |
| Ownership not checked — acting on a resource by id without confirming it belongs to the principal | CRITICAL | compare `resource.owner_id` against the authenticated user before mutating/returning |
| JWT accepted without verifying signature + `exp` + `aud`/`iss` | CRITICAL | `jwt.decode(token, key, algorithms=[...], audience=...)`; never `options={"verify_signature": False}` |
| OAuth callback: `state` not validated, or `redirect_uri` not allow-listed | HIGH | persist + compare `state`; allow-list redirect URIs |
| Pydantic model trusts client-set privileged fields (e.g. `is_admin`, `role`, `price`) | HIGH | separate input vs output schemas; never bind privileged fields from the request body |
| Secrets hardcoded instead of `pydantic-settings` / env | HIGH | `Settings` from env; rotate anything committed |
| `CORSMiddleware` with `allow_origins=["*"]` together with `allow_credentials=True` | HIGH | explicit origin allow-list when credentials are sent |
| `passlib` / bcrypt not used — plain or fast-hash password storage | CRITICAL | `bcrypt`/`argon2` via passlib; verify with constant-time compare |
| Background task / async path swallows an exception so the request still 200s | MEDIUM | surface or log+alert; don't mask a failed write as success |

## False positives

- A route intentionally public (health check, login, public listing) without an auth dependency — confirm intent, don't flag.
- `text()` with no interpolation (a constant query) — not injectable.

Deeper SQLAlchemy correctness (session/transaction, N+1) is `database-reviewer`'s `fastapi` sheet.
