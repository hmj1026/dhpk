---
description: 'Create GitHub PR from branch — auto-extract ticket, generate title/body, dry-run by default'
argument-hint: '[--head <branch>] [--base <branch>] [--title <text>] [--execute] [--dry-run]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Read, Grep, Glob'
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Remote: !`gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo 'unknown'`
- Commits: !`git log --oneline -10`

## Task

1. **Gather info**: branch, remote, existing PRs, commits, diff stats
2. **Extract ticket**: from branch name using `{TICKET_PATTERN}` (default: `[A-Z]+-\d+`)
3. **Generate title**: `<type>: [<TICKET>] <summary>`
4. **Generate body**: Summary bullets + Ticket link + Test plan
5. **Pre-flight**: resolve `<base>`, run `git rev-list --count <base>..HEAD`, and abort before any PR creation when the result is 0 with: `No commits between <base> and HEAD — nothing to open a PR for`. Then verify the branch is pushed and no PR already exists.
6. **Output**: `gh pr create` command (dry-run default)

Arguments:
- `--head <branch>`: Source branch (default: current)
- `--base <branch>`: Target branch (default: `{TARGET_BRANCH}` or `main`)
- `--title <text>`: Override title
- `--execute`: Actually create the PR (asks confirmation first)
- `--dry-run`: Show command only (default)

## Output

Dry-run: a copy-pasteable `gh pr create` command block.
Execute: the created PR URL.
