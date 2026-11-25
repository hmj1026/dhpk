# Python build-resolver guide

Use this guide only when the Python, FastAPI, or pytest module is active.

## Detect and diagnose

Find the nearest `pyproject.toml`. Prefer `uv run <tool>` with `uv.lock`,
`poetry run <tool>` with `poetry.lock`, or the bare tool in an already active
virtual environment.

```sh
ruff check . 2>&1 | head -40
ruff format --check . 2>&1 | head -20
mypy . 2>&1 | head -40             # or: pyright 2>&1 | head -40
pytest -x -q 2>&1 | tail -40
python -c 'import sys; print(sys.version)'
sed -n '1,60p' pyproject.toml
```

| Error | Likely cause | Surgical fix |
|---|---|---|
| `F401 imported but unused` | Dead import | Remove it, or re-export intentionally via `__all__` |
| `F821 undefined name` | Typo or missing import | Correct the name or add the import |
| `E501 line too long` | Formatting | Run the project's formatter on the affected file |
| Missing return annotation | Untyped function | Add the honest return type |
| Incompatible return or argument type | Type mismatch | Fix the value or signature; do not blanket-ignore it |
| `ScopeMismatch` / `event_loop` | Async fixture scope clash | Align fixture scope and loop scope |
| `ModuleNotFoundError` | Wrong environment or missing dependency | Use the project runner and install only with authority |
| `ResolutionImpossible` | Constraint conflict | Align the implicated constraint and regenerate the lock narrowly |

Forbidden shortcuts: blanket `# noqa`, `# type: ignore`, `--no-verify`, or
deleting an assertion merely to make the command green. Stop for a missing
system library, restricted package index, or real dependency upgrade.
