---
name: python
description: 'Python service implementation or review, async FastAPI/SQLAlchemy APIs, pytest tests, and ruff/pyright/mypy setup or triage. Use for backend Python tasks. Not for frontend or non-Python work. Output: compatible typed code, offline tests, API guidance, or static-check configuration with evidence.'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Python

Use `$python <task>` to implement, review, test, or configure the scoped Python
service. Select the required internal procedure after resolving the target.

## Resolve compatibility first

Identify the target package/subproject from the request and its own
pyproject.toml, lock, and checker configuration. An intentional explicit
version override wins; record it separately from observed constraints. Read
`requires-python` at its actual range precision: `>=3.10` establishes a 3.10
floor, while `>=3.9,<3.12` does not authorize 3.10-only syntax. Lock/configuration
conflicts, missing evidence, incompatible ranges, or several plausible package
scopes require asking and waiting before version-specific reference loads or
dependent edits. `python --version` describes the tool environment. Migration
requires an explicit destination; group resources and evidence for multi-target
work separately. Confirm framework/library major from target lock/manifest
before framework-specific API advice (especially Pydantic1 versus2).

## Select local resources

| Task | Procedure |
| --- | --- |
| Typed language/service implementation or review | [language](references/language.md) |
| ruff/pyright/mypy configuration, suppression, lint triage | [static](references/static.md) |
| Async pytest fixtures, regression tests, offline API tests | [testing](references/testing.md) |
| FastAPI routes, Depends, Pydantic, SQLAlchemy2 async, Alembic design | [FastAPI](references/fastapi.md) |

Load only the selected procedure and any other specialty actually needed for
the request. The language procedure assumes Python3.10+; TaskGroup needs3.11+.
For an older target, preserve its syntax floor and give a bounded compatibility
answer or request an explicit upgrade decision. FastAPI examples assume
Pydantic2/SQLAlchemy2; adapt only after confirming target evidence.

These are local instructions; consumer source/configuration and tool binaries
are task inputs. Missing bundled resources are `BLOCKED`; missing tools or
external services are `NOT_RUN`/`UNAVAILABLE`. Do not recover local resources
from a predecessor skill or an ambient module.

## Authority and completion

A request to implement or configure authorizes scoped source/test/configuration
edits. Review/check tasks stay read-only; auto-fix/format writes require the
corresponding edit intent. Use the project's test-first workflow for behavior.
Preserve the configured coverage floor and offline/live test distinction.
Migration design does not authorize executing DDL or mutating a shared database.
Tooling hooks mentioned by the procedures describe consumer integration; this
skill does not install or require dhpk hooks to perform its task.

Return the resolved target and compatibility floor, selected procedure,
implementation/findings/test plan/configuration, actual lint/type/test evidence,
and residual risk. API results retain transaction/auth/error boundaries;
testing results retain isolated fixtures, dependency overrides, and live opt-in
markers; static results retain command/configuration/suppression evidence. Keep
local tests, provider/DB execution, commit, push, and publication separate.
