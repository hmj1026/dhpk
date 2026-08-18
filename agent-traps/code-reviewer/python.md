# code-reviewer — Python traps

Code-quality lanes for Python. Security lanes (SQL f-strings, `eval`/`exec`, unsafe
`yaml.load`, weak crypto, command/path injection) → `security-reviewer/python.md`.
FastAPI-specific lanes → `code-reviewer/fastapi.md`. Detect the floor from
`pyproject.toml` `requires-python`; honor an explicit project convention in CLAUDE.md.

| Lane | Trigger | Action | Non-apply |
|---|---|---|---|
| Type hints | public fn without annotations; `Any` where a precise type exists; nullable param without `Optional`/`\| None` | annotate; narrow `Any`; `Optional[T]` | generated stubs; `**kwargs` on a private helper |
| Pythonic idiom | C-style index loop; `type(x) == T`; `"" + s` in a loop | comprehension; `isinstance`; `"".join(...)` | a loop that needs the index for a documented side channel |
| Mutable default arg | `def f(x=[])` / `={}` | `def f(x=None)` then copy inside | a default that is an immutable `()` / `""` / `0` |
| Resource mgmt | manual `open()/close()`, hand-rolled lock acquire | `with` context manager | a test fixture that already uses `try/finally` |
| Error handling | `except:` / `except Exception: pass` | catch the specific class; log + handle or re-raise | a CLI top-level handler that logs then exits |
| Concurrency | shared mutable state without a lock; mixing sync calls into async paths | `threading.Lock`; keep async pure-async | a single-threaded script |
| Quality | fn > 50 lines / > 5 params; `value == None`; shadowing `list`/`dict`/`id` | extract; `is None`; rename | generated code |
| Best practice | `print()` for diagnostics; `from m import *`; missing docstring on public API | `logging`; explicit imports; one-line docstring | `__main__` scripts that print by design |

**Framework quick-checks** — Django: `select_related`/`prefetch_related` for N+1,
`transaction.atomic()` for multi-step writes. Flask: error handlers + CSRF.

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
except:
    n = 0
# GOOD — catch the expected class, name the fallback
try:
    n = int(raw)
except ValueError:
    log.warning("non-numeric %r, defaulting to 0", raw)
    n = 0
```

Diagnostics: `ruff check .` · `mypy .` · `black --check .` (run only those the project already configures).
