# Usage Examples

Invocation patterns for `claude-health` and the action each triggers.

```
Input: /claude-health
Action: Scan hygiene (7 items) + sync (S1-S3) → Generate consolidated report

Input: /claude-health --scope sync
Action: Scan S1-S3 only → Report version drift + component status

Input: /claude-health --scope hygiene
Action: Scan C1-C7 only → Report junk files, .gitignore, naming, counts

Input: /claude-health --fix-safe
Action: Scan all → Auto-fix safe items → Delegate to /install-* → Report

Input: /claude-health --fix
Action: Scan all → Guided remediation (interactive) for all actionable states

Input: Is my plugin up to date?
Action: Trigger sync check → Report version + component drift
```

See `references/plugin-sync.md` for the meaning of each sync state and the
`--fix` / `--fix-safe` delegation rules.
