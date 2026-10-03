---
name: repo-verify
description: 'Run a repository verification loop with runner-first execution, deterministic stages, and explicit PASS/FAIL/SKIP output. Use for fast or full validation of a consumer repository. Not for: mutation, fixing failures, dependency remediation, or merge approval. Output: runner summary or a complete fallback stage table.'
argument-hint: '[<mode>] [--integration=<path>] [--e2e=<path>]'
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Repository Verify

## Workflow

Run read-only in the consumer repository. Normalize no mode or `full` to full
stages and `fast` to lint + unit; accept only `fast` or `full`. Attach
`--integration <path>` and `--e2e <path>` only to their matching stages.

Use a project-installed
`.claude/dhpk/skills/repo-verify/scripts/verify-runner.js` when present. If it
is absent, use the package-local `$SKILL_DIR/scripts/verify-runner.js` for a
Node project. `$SKILL_DIR` is the installed directory containing this
`SKILL.md`; its adjacent `scripts/lib/runner-utils.js` is part of the same
local closure, and the consumer cwd remains unchanged. A runner's crash,
missing overall verdict, execution error, or explicit semantic `FAIL` is
terminal and does not fall through. A Markdown `FAIL` or `summary.json`
`overallPass=false` remains failure even when the runner exits zero. When no
applicable runner is available, use the non-Node/manifest fallback and stage rules in
[`references/workflow.md`](references/workflow.md); unsupported manifests are
terminal failures.

## When NOT to Use

- A check should edit, format, build, or fix the repository.
- Dependency security review is the goal (use `$dep-audit`).
- Merge approval or code-review verdict is the goal.

## Output

For a runner, prefix output with `Source: runner` and preserve its summary.
For fallback, report `Source: fallback`, every lint/typecheck/unit/
integration/e2e stage as `PASS`, `FAIL`, or `SKIP` with command/reason, and an
agreeing overall verdict. Invalid modes, unsupported manifests, runner
failures, and execution errors are terminal `FAIL`/`BLOCKED` results.

## Verification

- [ ] Mode and optional paths were normalized before execution.
- [ ] Runner precedence and terminal failure boundary were respected.
- [ ] Every applicable stage has a result and exact command or skip reason.
- [ ] Semantic overall verdict agrees with the stage results and source is
  named, regardless of CLI exit status.

## References

- [`references/workflow.md`](references/workflow.md) — runner precedence,
  fallback ecosystems, Node script rules, and report template.
