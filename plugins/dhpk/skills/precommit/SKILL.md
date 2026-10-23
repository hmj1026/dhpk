---
name: precommit
description: 'Run the deterministic pre-commit pipeline in fast or full mode through the packaged runner. Use when handing off repository changes. Not for: ad hoc replacement checks, dependency audits, or read-only verification. Output: runner-owned changed-file reporting and final verdict.'
argument-hint: '[--fast]'
metadata:
  dhpk-capability-id: dhpk.skill.precommit
  dhpk-name-style: portable-skill
  dhpk-invocation-class: implicit-eligible
  dhpk-next: "{\"PASS\":\"doc-maintain:update\",\"FAIL\":\"none\",\"BLOCKED\":\"none\",\"NOT_RUN\":\"none\",\"UNAVAILABLE\":\"none\"}"
---

# Precommit

## Workflow

Run from the consumer repository. Resolve `--fast` to fast mode and no flag to
full mode, then invoke the package-local runner:

```bash
node "$SKILL_DIR/scripts/precommit-runner.js" --mode <fast|full> --tail 80
```

Here `$SKILL_DIR` is the installed directory containing this `SKILL.md`; the
current working directory remains the consumer repository. The runner and its
adjacent `$SKILL_DIR/scripts/lib/runner-utils.js` are one local runtime tree.
With the setup installer, the runner is
`.claude/dhpk/skills/precommit/scripts/precommit-runner.js`.
The runner owns ecosystem detection, package-manager selection,
`lint:fix -> build -> test:unit` ordering, graceful skips, changed-file
reporting, and the final verdict. If checks live in subprojects or do not use
root `package.json` scripts, configure them in the repository-root
[`precommit.config.json`](references/workflow.md#explicit-repository-configuration).
Configured commands run directly from their declared working directories.
Read
[`references/workflow.md`](references/workflow.md) for the terminal boundary.

## When NOT to Use

- A read-only verification loop is requested (use `$repo-verify`).
- Dependency security evidence or a fix operation is requested (use
  `$change-verdict deps`).
- A one-off command is requested outside the deterministic precommit pipeline.

## Output

Return the runner output, changed-file report, and its final `PASS`, `FAIL`, or
`UNSUPPORTED` verdict. A missing runner is `UNAVAILABLE`; a runner crash or
failed check is `FAIL`. An `UNSUPPORTED` verdict means no Git repository or executable checks were
available and exits non-zero; never replace it with hand-written checks or claim a pass
from partial output.

## Verification

- [ ] Mode is exactly `fast` or `full` and the runner received `--tail 80`.
- [ ] The package-local runner ran from the consumer repository cwd.
- [ ] The local `runner-utils.js` helper resolved beside the runner.
- [ ] Runner-owned stage order, skips, changed files, and verdict are intact.
- [ ] `summary.json` `overallStatus` and the final Markdown verdict agree;
  `FAIL` and `UNSUPPORTED` remain terminal when the CLI exits zero.
- [ ] Non-zero exit or missing final verdict remains a failure.

## References

- [`references/workflow.md`](references/workflow.md) — mode mapping,
  `$SKILL_DIR` resolution, runner ownership, and failure handling.
