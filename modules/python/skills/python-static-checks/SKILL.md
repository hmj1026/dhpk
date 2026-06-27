---
name: python-static-checks
description: Static-check strategy for Python — ruff rule selection (lint vs format), pyright-strict vs mypy trade-offs, progressive typing adoption, per-file/per-line suppression discipline, and how the dhpk python module's post-edit + pre-commit hooks invoke them. Use when configuring ruff/pyright/mypy or triaging their output.
---

# Python Static Checks

How to configure and reason about the Python tooling the `python` dhpk module
drives. The module never bundles config — it runs the project's own
`pyproject.toml` via the configured runner (`uv run` by default).

## ruff — lint + format in one tool

- **Two commands, one tool:** `ruff check` (lint) and `ruff format` (Black-compatible
  formatter). The hooks run both; CI should too.
- **Rule selection** lives in `[tool.ruff.lint] select = [...]`. A solid baseline
  (ccas uses it): `E` (pycodestyle), `F` (pyflakes), `I` (isort/import order),
  `N` (pep8-naming), `W` (warnings), `UP` (pyupgrade — modern-syntax nudges).
  Add `B` (bugbear), `S` (bandit security), `ASYNC` as the codebase matures.
- **Per-line suppression:** `# noqa: E501` (specific code, never bare `# noqa`).
  **Per-file:** `[tool.ruff.lint.per-file-ignores]` (e.g. allow unused imports in
  `__init__.py`, asserts in `tests/`).
- Keep `line-length` and `target-version` in `pyproject.toml` so editor, hook, and
  CI agree. `ruff check --fix` and `ruff format` auto-resolve most findings.

## Type checking — pyright vs mypy

- The module's `python_typechecker` knob selects `pyright` (default), `mypy`, or
  `none`. Pick one and gate on it; running both doubles noise.
- **pyright:** fast, excellent inference, `strict` mode is aggressive. Configure in
  `pyproject.toml` `[tool.pyright]` (or `pyrightconfig.json`): set `pythonVersion`,
  `venvPath`/`venv`, and `typeCheckingMode`. ccas runs strict.
- **mypy:** ubiquitous, plugin ecosystem (pydantic, SQLAlchemy). Configure
  `[tool.mypy]`; adopt `--strict` incrementally via per-module overrides.
- **Progressive adoption** for a legacy codebase: start non-strict, enable strict
  per-package via overrides, ratchet up. Don't blanket-`# type: ignore` to go green
  — each ignore needs a trailing reason and ideally a specific error code.

## How the hooks invoke them

- **post-edit** (`post-edit-python-lint.sh`): advisory `ruff check` + `ruff format
  --check` on edited `.py`. Batched once at Stop by default (`DHPK_PY_LINT_MODE`),
  never blocks. Set `DHPK_PY_STOP_TYPECHECK=1` to also typecheck at Stop.
- **pre-commit** (`pre-commit-python-validation.sh`): the real gate — `ruff check`,
  `ruff format --check`, then the type checker on staged `.py`, grouped by the
  owning `pyproject.toml` dir. Exit 2 blocks the commit; `[skip-python-lint]`
  bypasses.
- **Tool resolution:** runner prefix (`uv run`) is used only when its binary exists,
  else tools run bare off PATH; if neither resolves, the gate self-skips with a
  warning rather than failing — so a machine without the toolchain isn't blocked.

## Monorepo / subdir backends

Project root is found by walking up to the nearest `pyproject.toml`, so a backend
under `backend/` is handled with zero config. Set `python_project_roots="backend"`
only to *restrict* checks to that subtree (ignore stray top-level scripts).

## When NOT to Use

Not for writing application logic (see `python-pro`), and not for choosing *which*
tests to write (see `pytest-async`). Load this only when configuring or triaging
ruff / pyright / mypy.

## Output

A `pyproject.toml` whose `[tool.ruff.lint] select`, `[tool.ruff]` line-length /
target-version, and `[tool.pyright]` / `[tool.mypy]` blocks are explicit and
agree across editor, post-edit hook, and CI — plus scoped, reason-tagged
suppressions instead of blanket ignores.

## Verification

- `ruff check` + `ruff format --check` and the chosen type checker run clean on
  the same config the hooks use.
- Every `# noqa` / `# type: ignore` names a code and a reason.
- The pre-commit gate resolves tools via the runner prefix (or self-skips), so a
  machine without the toolchain is never falsely blocked.
