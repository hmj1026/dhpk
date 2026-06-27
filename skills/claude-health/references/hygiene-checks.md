# Hygiene Checks (C1-C7) — Detailed Catalog

Exhaustive method, criteria, and exact bash for the 7 hygiene checks run by
`claude-health` when `--scope hygiene` or `--scope all` (default).

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| 1 | Junk files | `find .claude/ -name ".DS_Store" -o -name "*.zip" -o -name ".tmp*"` | Any exists → P1 |
| 2 | .gitignore exists | `ls .claude/.gitignore` | Missing → P1 |
| 3 | .gitignore completeness | Read `.claude/.gitignore`, compare required items | Missing required → P2 |
| 4 | Naming consistency | Scan all `skills/*/` for `reference` vs `references` | Inconsistent → P2 |
| 5 | README count sync | Count actual vs README description | Mismatch → P2 |
| 6 | Command-Skill pairing | Each core skill should have corresponding command | Missing → P1 |
| 7 | Cache size | `du -sh .claude/cache/` | > 50M → P2 |

## Check 1: Junk Files

```bash
find .claude/ -name ".DS_Store" -o -name "*.zip" -o -name ".tmp*" 2>/dev/null
```

- Has results → **P1**: List files, suggest deletion
- No results → ✅

## Check 2-3: .gitignore

```bash
ls .claude/.gitignore 2>/dev/null || echo "MISSING"
```

Missing → **P1**. If exists, read content and compare required items:

| Required Item | Reason |
|---------------|--------|
| `.DS_Store` | macOS generates continuously |
| `settings.local.json` | Personal config |
| `cache/` | Runtime cache |
| `.tmp*` | Temp files |
| `*.tmp` | Temp files (suffix variant) |
| `*.zip` | Backup archives |
| `.claude_review_state.json` | Review state tracking |

Missing any → **P2**

## Check 4: Naming Consistency

```bash
# Scan all skill subdirectories
for dir in .claude/skills/*/; do
  if [ -d "${dir}reference" ]; then echo "INCONSISTENT: ${dir}reference"; fi
done
```

Has `reference/` (singular) → **P2**, suggest renaming to `references/`

## Check 5: README Count Sync

```bash
# Count actual items
ls .claude/commands/ 2>/dev/null | wc -l
ls .claude/skills/ 2>/dev/null | wc -l
ls .claude/agents/ 2>/dev/null | wc -l
ls .claude/rules/ 2>/dev/null | wc -l
ls .claude/hooks/*.sh 2>/dev/null | wc -l
```

Extract counts from README.md, compare. Mismatch → **P2**

## Check 6: Command-Skill Pairing

Scan all `skills/*/SKILL.md`, exclude these types, then check for corresponding command:

| Exclude Type | Examples | Reason |
|--------------|----------|--------|
| Domain KB | `portfolio`, `aum` | Referenced by other skills, no standalone entry |
| External | `agent-browser` | Not maintained by this project |

Remaining skills without command → **P1**

## Check 7: Cache Size

```bash
du -sh .claude/cache/ 2>/dev/null
```

- \> 50M → **P2**, suggest cleanup
- ≤ 50M → ✅
