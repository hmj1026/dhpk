# Usage Examples

Invocation patterns for `dhpk-claude-health` and the action each triggers.

```
Input: /dhpk:dhpk-claude-health
Action: Scan hygiene (7 items) + sync (S1-S3) → Generate consolidated report

Input: /dhpk:dhpk-claude-health --scope sync
Action: Scan S1-S3 only → Report version drift + component status

Input: /dhpk:dhpk-claude-health --scope hygiene
Action: Scan C1-C7 only → Report junk files, .gitignore, naming, counts

Input: /dhpk:dhpk-claude-health --fix-safe
Action: Scan all → Auto-fix safe items → Delegate to /install-* → Report

Input: /dhpk:dhpk-claude-health --fix
Action: Scan all → Guided remediation (interactive) for all actionable states

Input: Is my plugin up to date?
Action: Trigger sync check → Report version + component drift
```

See `references/plugin-sync.md` for the meaning of each sync state and the
`--fix` / `--fix-safe` delegation rules.
