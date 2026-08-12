---
name: dhpk-git-history-investigation
description: "Git history investigation. Use when: tracking code changes, finding where bugs were introduced, root cause analysis. Not for: code exploration (use dhpk-codebase-exploration), issue analysis (use dhpk-issue-analyze). Output: history trace + root cause report."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Git Investigate Skill

## When NOT to Use

- Code review (use codex-review)
- Feature development (use feature-dev)
- Just want to read code (use Read directly)

## Command

```bash
/dhpk:dhpk-git-history-investigation src/service/xxx.ts:123      # Specific line
/dhpk:dhpk-git-history-investigation processToken                 # Function name
/dhpk:dhpk-git-history-investigation "error message"              # Keyword
```

## Workflow

```
Locate code -> git blame -> find commit -> trace history -> analyze changes -> report
```

## Investigation Framework

| Question           | Method                        |
| ------------------ | ----------------------------- |
| Who wrote it?      | `git blame`                   |
| When was it changed?| `git log --follow`           |
| Why was it changed?| commit message + PR           |
| What was missed?   | `git diff` compare original vs problematic version |

## Common Patterns

| Pattern            | Symptom              | Root Cause                    |
| ------------------ | -------------------- | ----------------------------- |
| Type removed       | Enum value deleted   | Assumed no longer needed      |
| Condition simplified| If conditions reduced| Missed during refactoring    |
| Rename             | Partially unchanged  | Incomplete search-and-replace |
| Boundary ignored   | Only handles main flow| Edge cases not considered    |

## Output

```markdown
## Git Investigation Report
- **Target**: <file/feature>
- **Timeline**: <commit range>
- **Root cause**: <analysis>
- **Introduced by**: <commit hash + author>
```

## Verification

- Report includes: investigation target, author info, timeline, original vs problematic code
- Root cause has clear analysis
- Fix recommendation is specific and actionable

## References

- `references/commands.md` - Git command reference + report template
- `references/wsl-traps.md` - <your-project> WSL traps: root-owned untracked files blocking `git merge --ff-only`; git-smart-commit 全 staged 失效

## Examples

```
Input: Who changed this line of code?
Action: git blame -> find commit -> trace PR -> output report
```

```
Input: When was this bug introduced?
Action: git log -p -S -> locate introduction point -> analyze cause -> output report
```
