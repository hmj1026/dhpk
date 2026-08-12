---
name: merge-prep
description: "Pre-merge analysis and preparation — conflict detection, impact analysis, suggested commands (analysis-only, no auto-merge)"
---
## Contract

Use for analysis-only merge preparation; never auto-merge or mutate branches.
See the [command contract](https://github.com/hmj1026/dhpk/blob/main/docs/agent-guidance/command-contract.md). Stop
when either branch is missing or the worktree is dirty; completion reports
conflicts, evidence, and copy-pasteable commands.

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Status: !`git status --porcelain | head -5`

## Task

Follow the `merge-prep` skill workflow:

1. **Validate**: Source branch exists, target exists, working tree clean
2. **Analyze**: Run `skills/merge-prep/scripts/pre-merge-check.sh <source> [target]`
3. **Report**: Display pre-merge analysis (commits, files, conflicts)
4. **Conflicts**: If detected, analyze patterns and suggest resolution strategies
5. **Commands**: Output merge commands for manual execution

Arguments:
- `<source-branch>`: Branch to merge (required)
- `--target <branch>`: Target branch (default: `{TARGET_BRANCH}` or `main`)

## Output

Pre-merge analysis report with conflict details and copy-pasteable merge commands.
**v1 is analysis-only** — commands are output, never auto-executed.
