---
name: codex-review
description: "Consolidated Codex second opinion for diffs, branches, documents, security, and tests."
---
# /codex-review

Use one Codex-backed review entrypoint. `--scope` selects the review contract:

| Scope | Review target | Preferred depth |
|---|---|---|
| `diff` | current uncommitted diff | `fast` for quick feedback, `full` before handoff |
| `branch` | `<base>..HEAD` feature branch | `full` |
| `doc` | an explicit or changed document | `full` |
| `security` | changed security-sensitive code | `full` |
| `tests` | tests and their production seam | `full` |

`--depth fast|full` defaults to `full`. `--coverage` is valid only with
`--scope tests`; `--spec` is valid only with `--scope doc`. `--base` chooses a
branch comparison where relevant, and `--continue` resumes the Codex thread.

Read the matching prompt/reference from `dhpk-change-review`, `dhpk-doc-review`,
`dhpk-security-review`, or `dhpk-test-review` before calling Codex. Collect only
the selected scope, ask Codex for file:line findings and a verdict, and report
the executed local checks plus PASS/FAIL/SKIP evidence. A standalone security,
documentation, or test audit should prefer its dedicated reviewer/skill; these
scope modes are the consolidated CLI second-opinion path.

Do not auto-loop beyond the policy ceiling. A `BLOCK` verdict names the focused
fix and rerun command; an acceptable verdict records scope, evidence, and
remaining uncertainty.
