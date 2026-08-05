---
name: dhpk-skill-health-audit
description: 'Validate skill quality against routing, progressive loading, and verification criteria. Use when: auditing skills, checking skill health, reviewing skill design. Not for: code review (use dhpk-change-review) or doc review (use dhpk-doc-review). Depth split: dhpk-skill-health-audit = structural lint of one skill · dhpk-skill-quality-judge = deep rubric of one · dhpk-skill-stocktake = batch-audit of many. Output: health report with per-skill ratings + Gate.'
allowed-tools: 'Read, Grep, Glob, Bash(bash:*), Bash(node:*), Agent, Task'
context: fork
metadata:
  dhpk-invocation-class: implicit-eligible
---

# Skill Health Check

## When NOT to Use

- Code review (use `/codex-review-fast`)
- Document review (use `/codex-review-doc`)
- Creating new skills (use `skill-creator` plugin, external)
- .claude directory structure check (use `/dhpk:dhpk-claude-health`)

## Core Principle

Skills are **on-demand context packages**. Their value comes from routing precision (right skill triggers at right time) and context efficiency (minimum tokens for maximum capability). A poorly routed skill wastes context on every mismatch; a well-routed skill transforms a generalist into a specialist at exactly the right moment.

## Workflow

```
Run automated lint → Review manual dimensions → Produce integrated report → Gate
```

### Step 1: Automated Lint

Portable direct invocation:

```bash
node skills/dhpk-skill-health-audit/scripts/skill-lint.js --skills-dir skills --agents-dir agents --commands-dir commands --fix-hint
```

Repository wrapper:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/run-skill.sh" dhpk-skill-health-audit skill-lint.js --fix-hint
```

**Script I/O contract:**

| Parameter | Description |
|-----------|-------------|
| `--skills-dir <path>` | Skills directory (default: `./skills`) |
| `--agents-dir <path>` | Optional agents directory (default: `./agents`) |
| `--commands-dir <path>` | Optional commands directory (default: `./commands`) |
| `--json` | Output JSON instead of markdown |
| `--fix-hint` | Include fix suggestions |
| Exit 0 | All pass |
| Exit 1 | Warnings only (P2) |
| Exit 2 | Errors found (P0/P1) |

**Shared host contract:**

- Universal checks always run from the discovered skill packages.
- Agent checks run only when an agents directory is available.
- Command/skill pairing checks run only when a commands directory is available.
- Missing capability surfaces are reported as skipped, not passed; recursive discovery uses real directory traversal and does not follow symlinked directories.
- Malformed discoverable skill, command, and agent entries are reported as structured P1 findings with stable relative names and actionable `--fix-hint` guidance; dangling links and read failures never escape as stack traces, and no host or plugin-root paths are emitted.

**Per-skill checks (11 items):**

| # | Check | Severity | Criteria |
|---|-------|----------|----------|
| 1 | Frontmatter exists | P1 | `name` + `description` required; malformed discoverable entries are fail-closed findings |
| 2 | Routing signature | P1 | Description has at least 2 of 3 routing cues (Use/Avoid/Output); 0 cues = P1, 1 cue = P2 |
| 3 | When NOT section | P1 | Body has "When NOT to Use" heading |
| 4 | Output section | P2 | Body defines expected deliverable |
| 5 | Verification section | P2 | Body has verification checklist |
| 6 | References routing | P2 | Each reference file mentioned in body |
| 7 | Scripts contract | P2 | Each script filename referenced in SKILL.md body |
| 8 | Line count | P2 | Warning >150, flag >250 |
| 9 | Agent entitlement | P2 | Body describes `Agent()` dispatch but `allowed-tools` lacks Agent |
| 10 | Task entitlement | P2 | Body describes `Task()` dispatch but `allowed-tools` lacks Task |
| 11 | Cross-skill ref path | P1 | Bare ref paths not found locally but existing in another skill → must use `@skills/<parent>/` or `${CLAUDE_PLUGIN_ROOT}/skills/<parent>/` |

**Cross-skill and capability checks (4 items):**

| # | Check | Severity | Criteria |
|---|-------|----------|----------|
| 12 | Orphan pairing | P2 | Commands reference skills and command-backed skills are paired when commands are available |
| 13 | Description overlap | P2 | Jaccard similarity >60% flagged |
| 14 | Agent ref validity | P1 | `subagent_type` references in skills must exist in `agents/` when agents are available |
| 15 | Agent tools syntax | P2 | Agent `.md` tools field uses canonical format (ToolName, `Bash(<prefix>:*)`, or MCP namespaced form) |

Malformed command and agent entries use the same P1 contract as malformed skills: the finding names the relative file, records the filesystem/frontmatter failure, and includes a safe fix hint; the checker continues independent entries and deduplicates repeated path/check findings before calculating the exit status.

### Step 2: Manual Review (when comprehensive audit requested)

Read flagged skills and evaluate:

| Dimension | Question | Rating |
|-----------|----------|--------|
| **Why > What** | Does skill explain underlying principles, not just steps? | ⭐1-5 |
| **Scope fitness** | Is the skill focused? Could it be split? | ⭐1-5 |
| **Progressive loading** | Is heavy content in references/, not inline? | ⭐1-5 |
| **Routing precision** | Would a user's request unambiguously trigger this skill? | ⭐1-5 |

Only run Step 2 when user explicitly requests deep audit. Default: Step 1 only.

### Cost, branch, and sediment checks

The lint gate is also a context-cost check: flag unconditionally loaded
branches, non-checkable completion, and repeated routing. Mark no-op,
duplication, and documentation sediment for pruning; a conditional reference
is healthy only when its triggering branch is named in `SKILL.md`.

## Output

```markdown
# Skill Health Check Report

## Summary

| Metric | Value |
|--------|-------|
| Skills scanned | N |
| Commands scanned | N |
| Capability checks skipped | N |
| Checks passed | N |
| P0 (Must Fix) | N |
| P1 (Should Fix) | N |
| P2 (Suggestion) | N |

## Per-Skill Results

| Skill | Routing | When-NOT | Output | Verification | Refs | AgEnt | TskEnt | Lines | Status |
|-------|---------|----------|--------|--------------|------|-------|--------|-------|--------|
| name  | ✅/🟡/⚪ | ...    | ...    | ...          | ...  | ✅/⚪ | ✅/⚪  | N     | ✅/🟡/⚪/🔴 |

## P0 (Must Fix)
- **skill-name**: Issue → Fix recommendation

## P1 (Should Fix)
- **skill-name**: Issue → Fix recommendation

## P2 (Suggestion)
- **skill-name**: Issue → Fix recommendation

## Capability-Dependent Skips
- **check-name**: Capability directory not found or not available

## Gate: ✅ All Pass / ⛔ N issues need fixing
```

## Verification

- [ ] Automated lint executed (exit code checked); all P0/P1 findings have fix recommendations.
- [ ] Per-skill table includes all scanned skills; gate sentinel present for hook parsing.
- [ ] Invocation/context cost, conditional branches, and checkable completion are assessed.
- [ ] No-op, duplication, and sediment findings are actionable pruning items.

## References

- `references/routing-signature-guide.md` — How to write effective routing signatures (read when fixing P1 routing issues); `--fix-hint` — Include remediation guidance for malformed entries and ordinary findings
