---
name: python-pro
description: 'Modern Python (3.10+) review checklist: typing, dataclasses/pydantic, async-await discipline, logging over print, exception chain, ruff+pyright. Use when writing or reviewing backend Python (async FastAPI/SQLAlchemy). Not for non-backend or pre-3.10 code. Output: typed, ruff/pyright-clean code.'
---

# Python Pro (3.10+)

Framework-agnostic guidance for modern, type-checked Python services. Assumes the
`python` dhpk module's tooling baseline (ruff for lint+format, pyright or mypy for
types, `uv run` as the default runner — all overridable). For web-API specifics see
the `fastapi` module; for tests see the `pytest` module.

## Typing discipline

- **Annotate every public function** (params + return). Prefer `X | None` over
  `Optional[X]`, `list[str]` over `List[str]` (PEP 585 3.9+, PEP 604 3.10+).
- Run the type checker as a gate, not a suggestion. ccas runs **pyright strict**;
  mypy is the alternative. Don't add `# type: ignore` without a reason comment.
- Model data with `@dataclass(slots=True)` or **pydantic** models, not bare dicts.
  Pydantic at the I/O boundary (request/response, config); dataclasses for internal
  value objects.
- Use `typing.Protocol` for structural interfaces and dependency-injection seams
  (host-testable code) instead of inheritance.

## Async-await discipline

- Never call blocking I/O inside an `async def` coroutine — it stalls the event
  loop. Wrap unavoidable blocking calls in `await asyncio.to_thread(...)`.
- Don't mix sync and async DB sessions. With SQLAlchemy 2.0 async, every query is
  `await session.execute(...)`; never hold a session across `await` boundaries it
  doesn't own.
- Guard external calls with timeouts (`asyncio.wait_for`, httpx `timeout=`); an
  unbounded `await` is a latent hang. ccas isolates poison PDFs this way.
- Use `asyncio.TaskGroup` (3.11+) or `asyncio.gather` for fan-out; propagate
  cancellation rather than swallowing `CancelledError`.

## Errors & logging

- **No `print()` in library/app code** — use the `logging` module (structured JSON
  in ccas). `print` is for CLIs/scripts only. The post-edit hook flags stray prints.
- Define a project exception hierarchy (`class AppError(Exception)` → specific
  subclasses). Raise specific, catch specific. Never `except Exception: pass` — log
  with context and re-raise or convert. (See the silent-failure-hunter agent.)
- Preserve the chain: `raise NewError(...) from err`. Don't discard the original
  traceback.
- Validate inputs at the boundary and fail fast with a descriptive message; don't
  let a `None` or malformed value propagate three layers deep.

## Structure & idioms

- One responsibility per module; keep `__init__.py` thin. Layer
  Controller/Router → Service → Repository (or your stack's equivalent).
- Dependency-inject collaborators (clients, sessions, clocks) so they're swappable
  in tests — don't reach for module-level singletons inside business logic.
- Prefer comprehensions and generators over manual loops for transforms; prefer
  `pathlib.Path` over `os.path`; prefer f-strings.
- Keep functions small; if a function needs a comment to explain a block, that
  block usually wants to be its own named function.

## Tooling baseline (what the hooks enforce)

- `ruff check` (lint) + `ruff format` (formatting) — single tool, fast. ccas selects
  rule families `E, F, I, N, W, UP`. See the `python-static-checks` skill for the
  selection strategy.
- Type checker on every commit (pyright/mypy). Coverage floor via pytest-cov.
- The `python` module's pre-commit gate runs ruff + format-check + type-check on
  staged `.py`; `[skip-python-lint]` bypasses in an emergency.

## When NOT to Use

Not for non-Python work, frontend tasks, or codebases pinned to Python <=3.9
(the `X | None`, `slots=True`, and `TaskGroup` idioms here assume 3.10/3.11+).
For ruff/pyright config see `python-static-checks`; for web-API specifics see
`fastapi-pro`; for tests see `pytest-async`.

## Output

Python that meets the checklist above: every public function annotated, data
modelled with dataclasses/pydantic, no blocking I/O in `async def`, no stray
`print`, a preserved exception chain — and that passes ruff + the type checker
clean.

## Verification

- `ruff check` and `ruff format --check` report no findings.
- `pyright` (strict) or `mypy` passes; no new `# type: ignore` without a reason.
- No `print()` in library/app code; `pytest --cov` meets the coverage floor.
