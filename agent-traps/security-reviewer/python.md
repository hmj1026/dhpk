# security-reviewer — Python traps

OWASP lanes for Python on top of the baseline. Non-security idioms / type hints → `code-reviewer/python.md`. FastAPI auth/CORS/secrets → `security-reviewer/fastapi.md` (diagnostic: `bandit -r .` when configured).

| Trigger | Action | Non-apply |
| --- | --- | --- |
| SQL injection — f-string / `%`/`.format()` building a query: `cur.execute(f"… {uid}")` | parameterize: `cur.execute("… WHERE id = %s", (uid,))`; ORM bound params | server-side constant / already-validated values are not injectable |
| Command injection — `os.system`, `subprocess.*(..., shell=True)` with user input | `subprocess.run([...], shell=False)` with a list; allowlist the program | server-side constant / already-validated values are not injectable |
| Path traversal — user-controlled path into `open`/`send_file` | `os.path.realpath` + assert it stays under an allowed root; reject `..` | server-side constant / already-validated values are not injectable |
| Unsafe deserialization — `pickle.loads` / `yaml.load(...)` on untrusted data | `yaml.safe_load`; never unpickle untrusted bytes; use JSON | |
| Dynamic execution — `eval` / `exec` / `__import__` on input | remove; map to an explicit allowlist of operations | |
| Weak crypto — `hashlib.md5`/`sha1` for passwords/tokens; `random` for secrets | `bcrypt`/`argon2` for passwords; `secrets` for tokens | |
| Secrets in code — hardcoded API key / password / token | env var / secret manager; report `file:line` + type only, never echo the value | |

## Worked example

```python
# BAD — f-string interpolates user input straight into SQL
cur.execute(f"SELECT * FROM users WHERE email = '{email}'")
# GOOD — bound parameter; the driver escapes it
cur.execute("SELECT * FROM users WHERE email = %s", (email,))
```
