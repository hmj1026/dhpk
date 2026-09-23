---
name: harness-audit
description: "Run the deterministic repository harness audit and return its prioritized scorecard. Use when measuring harness health for a repository or scoped harness area. Not for: changing harness files, inventing scoring dimensions, or replacing harness governance. Output: script-owned score, findings, failed checks, top actions, and suggested skills."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Harness Audit

## Workflow

Resolve `scope` to `repo` by default; valid scopes are `repo`, `hooks`,
`skills`, `commands`, and `agents`. Resolve `--format` to `text` by default or
`json`, and use `--root <path>` only when supplied. Run the package-local
deterministic engine from the consumer repository:

```bash
node "$SKILL_DIR/scripts/harness-audit.js" <scope> --format <text|json> [--root <path>]
```

Here `$SKILL_DIR` is the resolved installed package directory. The script is
the score and check source of truth; preserve rubric `2026-03-30`, all seven
categories, and its output. Read
[`references/workflow.md`](references/workflow.md) for format handling.

## When NOT to Use

- Harness files should be edited or conformed (use `$harness-govern`).
- A general project health or dependency audit is requested.
- A new score, dimension, or ad-hoc point system is being proposed.

## Output

For `json`, return script JSON unchanged. For `text`, report overall/max
score, category scores, concrete findings, failed checks with exact paths,
top three `top_actions`, and suggested dhpk skills. Missing engine, invalid
scope/format, or script failure is terminal `UNAVAILABLE`/`FAIL`.

## Verification

- [ ] Scope, format, and optional root were normalized exactly once.
- [ ] Package-local `scripts/harness-audit.js` ran from the consumer cwd.
- [ ] Script output was not rescored or augmented with ad-hoc dimensions.
- [ ] JSON remained unchanged, or text retained paths and top actions.

## References

- [`references/workflow.md`](references/workflow.md) — invocation, rubric,
  format-specific output, and failure handling.
