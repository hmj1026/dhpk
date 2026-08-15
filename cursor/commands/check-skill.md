---
name: check-skill
description: "Validate skill quality against routing, progressive loading, and verification criteria."
---
**Must read and follow the skill below before executing this command:**

@skills/dhpk-skill-health-audit/SKILL.md

## Context

- Skills directory: !`ls skills/ | wc -l` skills
- Commands directory: !`ls commands/ | wc -l` commands

## Task

Run skill health check.

### Arguments

```
$ARGUMENTS
```

| Parameter | Description |
|-----------|-------------|
| `--deep` | Include manual review dimensions (Step 2) |
| `--json` | Output JSON format |

### Workflow

```
Run skill-lint.js → [Optional: manual review] → Report + Gate
```

2. **If `--deep`** (from `$ARGUMENTS`): Read flagged skills and evaluate Why>What, scope, progressive loading, routing precision
3. **Output**: Health report + Gate sentinel

## Output

```markdown
# Skill Health Check Report

## Summary
| Metric | Value |
|--------|-------|
| Skills scanned | N |
| P0/P1/P2 | N/N/N |

## Per-Skill Results
| Skill | Routing | When-NOT | Output | Status |
|-------|---------|----------|--------|--------|

## Gate: ✅ All Pass / ⛔ N issues
```

## Examples

```bash
/dhpk:check-skill
/dhpk:check-skill --deep
/dhpk:check-skill --json
```
