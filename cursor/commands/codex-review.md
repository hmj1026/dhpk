---
name: codex-review
description: "CLI-backed second opinion for diffs, branches, documents, security, and tests."
---
# /codex-review

Use one retained CLI-backed review entrypoint. The default backend is the
MCP-free `cli` transport; an explicit `--backend cli` is accepted for clarity.
`--scope` selects the review contract:

| Scope | Review target | Preferred depth |
|---|---|---|
| `diff` | current uncommitted diff | `fast` for quick feedback, `full` before handoff |
| `branch` | `<base>..HEAD` feature branch | `full` |
| `doc` | an explicit or changed document | `full` |
| `security` | changed security-sensitive code | `full` |
| `tests` | tests and their production seam | `full` |

`--depth fast|full` defaults to `full`. `--coverage` is valid only with
`--scope tests`; `--spec` is valid only with `--scope doc`. `--base` chooses a
branch comparison where relevant.

Run the matching contract from `dhpk-change-review`, `dhpk-doc-review`,
`dhpk-security-review`, or `dhpk-test-review` through the CLI wrapper. Collect
only the selected scope, ask for file:line findings and a verdict, and report
the executed local checks plus PASS/FAIL/SKIP evidence. A standalone security,
documentation, or test audit should prefer its dedicated reviewer/skill; these
scope modes are the consolidated CLI second-opinion path.

```text
bash skills/dhpk-change-review/scripts/review.sh \
  --backend cli --scope diff|branch|doc|security|tests \
  --depth fast|full [--base <branch>] [--title <text>] [--prompt <text>]
```

The CLI review is an explicit second opinion and never invokes an MCP server.
It does not silently fall back to another transport when the CLI is unavailable.

Do not auto-loop beyond the policy ceiling. A `BLOCK` verdict names the focused
fix and rerun command; an acceptable verdict records scope, evidence, and
remaining uncertainty. For the backend-neutral primary review, invoke
`/dhpk:dhpk-change-review`; use this command only when the CLI second opinion is
explicitly requested.
