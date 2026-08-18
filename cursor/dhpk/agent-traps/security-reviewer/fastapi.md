# security-reviewer — FastAPI traps

FastAPI OWASP lanes for `security-reviewer`. Deeper SQLAlchemy correctness (session/transaction, N+1) lives in `database-reviewer/fastapi.md`.

| Trigger | Action | Non-apply |
| --- | --- | --- |
| CRITICAL — Raw SQL via `text("... %s ..." % val)` or f-string into a query | bound params: `text("... :id")` + `{"id": id}`, or the ORM `select()` with typed comparisons | `text()` with no interpolation (a constant query) — not injectable |
| CRITICAL — Protected route without an auth dependency | `Depends(get_current_user)` (or a router-level dependency); never trust a client-supplied `user_id` in the body/query for authorization | A route intentionally public (health check, login, public listing) without an auth dependency — confirm intent, don't flag |
| CRITICAL — Ownership not checked — acting on a resource by id without confirming it belongs to the principal | compare `resource.owner_id` against the authenticated user before mutating/returning | |
| CRITICAL — JWT accepted without verifying signature + `exp` + `aud`/`iss` | `jwt.decode(token, key, algorithms=[...], audience=...)`; never `options={"verify_signature": False}` | |
| HIGH — OAuth callback: `state` not validated, or `redirect_uri` not allow-listed | persist + compare `state`; allow-list redirect URIs | |
| HIGH — Pydantic model trusts client-set privileged fields (e.g. `is_admin`, `role`, `price`) | separate input vs output schemas; never bind privileged fields from the request body | |
| HIGH — Secrets hardcoded instead of `pydantic-settings` / env | `Settings` from env; rotate anything committed | |
| HIGH — `CORSMiddleware` with `allow_origins=["*"]` together with `allow_credentials=True` | explicit origin allow-list when credentials are sent | |
| CRITICAL — `passlib` / bcrypt not used — plain or fast-hash password storage | `bcrypt`/`argon2` via passlib; verify with constant-time compare | |
| MEDIUM — Background task / async path swallows an exception so the request still 200s | surface or log+alert; don't mask a failed write as success | |

