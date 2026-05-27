---
description: Yii 1.1 framework security audit (PHP 5.6). Covers AccessControl/accessRules, CSRF, XSS/CHtml, SQL injection (CDbCommand/CDbCriteria), Mass Assignment, file upload (CUploadedFile), Session security. Outputs type code (AUTH/CSRF/XSS/SQL/CFG/LOGIC/FILE) + observable PoC + fix suggestion.
argument-hint: "<source_path> [--output <output_path>]"
allowed-tools: Read, Grep, Glob, Bash(find *), Bash(grep *), Bash(ls *)
---

⚠️ **Must read and follow the skill below before executing this command:**

@modules/yii-1.1/skills/yii1-security-audit/SKILL.md
@modules/yii-1.1/skills/yii1-security-audit/references/yii1-security-patterns.md

## Context

- Current working directory: !`pwd`
- Project structure summary: !`ls -1 2>/dev/null | head -20`

## Task

Run a framework-level security audit on a Yii 1.1 (PHP 5.6) project.

### Arguments

```
$ARGUMENTS
```

| Parameter | Description |
|---|---|
| `<source_path>` | Yii 1.1 project root (required) |
| `--output <path>` | Output directory (default `{source_path}_audit`) |

### Workflow

```
Framework identification → Audit checklist (8 items) → Observable PoC → Report output
```

1. **Framework identification**: confirm at least 3 of `yiic.php`, `protected/`, `CController` inheritance, `config/main.php` evidence
2. **Per-item audit**: run the 8 audit items per the SKILL.md checklist
3. **Pattern reference**: use `references/yii1-security-patterns.md` to contrast safe vs unsafe patterns
4. **PoC output**: at least 2 observable verification frames (choose one of AUTH / SQL / CSRF)
5. **Report output**: write to `{output_path}/framework_audit/yii1_{timestamp}.md`

### Key Rules

- **No empty assertions**: every risk must reference a file location (filename:line) as evidence
- **Yii 1.1 API**: use `CHtml::encode`, `CDbCommand`, `CDbCriteria` — NOT Yii2 API
- **PHP 5.6**: no `??` null coalescing; `isset()` is the only safe way
- **`queryRow()` return value**: `false` on no-result; check with `!$result`
- **Type codes**: AUTH / CSRF / XSS / SQL / CFG / LOGIC / FILE
- **Fix suggestion**: must point at concrete Yii 1.1 API or configuration key

### Output Format

```markdown
# Yii 1.1 Security Audit Report
**Project**: {source_path}
**Audit time**: {timestamp}

## Framework identification
| Evidence | Location | Status |
| ---- | ---- | ---- |
| yiic.php | protected/yiic.php | ✅ |

## Findings summary
| Severity | Count | Type codes |
| ------ | ---- | ------ |
| High     | N    | AUTH, SQL |
| Medium   | N    | CFG, LOGIC |
| Low      | N    | ... |

## Detailed findings

### [High] <Title>
- **Type code**: AUTH
- **Location**: protected/controllers/OrderController.php:45
- **Evidence**: (code snippet)
- **Impact**: (one-line description of harm)
- **Fix**: (concrete Yii 1.1 API / config)
- **PoC observation frame**: `GET /index.php?r=order/delete&id=1` → expected 403, actual 200

## Gate
✅ No high-severity issues / ⛔ N high-severity issues found (recommend re-audit after fix)
```

## Examples

```bash
/yii1-security-audit ~/projects/<your-yii-app>
/yii1-security-audit ~/projects/<your-yii-app> --output /tmp/audit
```

## Related commands

| Command | Description |
|---|---|
| `/codex-security` | Generic OWASP Top 10 audit (Codex MCP) |
| `/dep-audit` | Dependency vulnerability audit |
| `/security-review` | Single-file security review |
