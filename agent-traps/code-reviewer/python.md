# code-reviewer — Python traps

Code-quality lanes for Python. Security lanes (SQL f-strings, `eval`/`exec`, unsafe
`yaml.load`, weak crypto, command/path injection) → `security-reviewer/python.md`.
Detect the floor from `pyproject.toml` `requires-python`; honor an explicit project
convention in CLAUDE.md.

| Lane | Flag | Fix |
|---|---|---|
| Type hints | public fn without annotations; `Any` where a precise type exists; nullable param without `Optional`/`\| None` | annotate; narrow `Any` → concrete; `Optional[T]` for nullable |
| Pythonic idiom | C-style index loop; `type(x) == T`; magic number; `"" + s` in a loop | comprehension; `isinstance`; `Enum`/named const; `"".join(...)` |
| **Mutable default arg** | `def f(x=[])` / `={}` | `def f(x=None)` then `x = x or []` inside |
| Resource mgmt | manual `open()/close()`, hand-rolled lock acquire | `with` context manager |
| Error handling | `except:` / `except Exception: pass`; swallowed exception | catch the specific class; log + handle or re-raise |
| Concurrency | shared mutable state without a lock; mixing sync calls into async paths; N+1 query in a loop | `threading.Lock`; keep async pure-async; batch the query |
| Quality | fn > 50 lines / > 5 params; nesting > 4; `value == None`; shadowing `list`/`dict`/`id` | extract / dataclass params; guard clauses; `is None`; rename |
| Best practice | `print()` for diagnostics; `from m import *`; missing docstring on public API | `logging`; explicit imports; one-line docstring |

**Framework quick-checks** — Django: `select_related`/`prefetch_related` for N+1, `transaction.atomic()` for multi-step writes. FastAPI: see `code-reviewer/fastapi.md`. Flask: error handlers + CSRF.

## Worked examples

```python
# BAD — mutable default shared across every call; grows forever
def add(item, bucket=[]):
    bucket.append(item); return bucket
# GOOD — fresh per call
def add(item, bucket=None):
    bucket = list(bucket or [])
    bucket.append(item); return bucket
```

```python
# BAD — bare except hides the real failure
try:
    n = int(raw)
except:               # swallows KeyboardInterrupt, SystemExit, real bugs
    n = 0
# GOOD — catch the expected class, name the fallback
try:
    n = int(raw)
except ValueError:
    log.warning("non-numeric %r, defaulting to 0", raw)
    n = 0
```

Diagnostics: `ruff check .` · `mypy .` · `black --check .` (run only those the project already configures).
