---
name: skill-scope
description: "Route skill-governance work to health, judge, stocktake, or scout mode. Use when: auditing skill quality, comparing many skills, or searching before authoring. Not for: authoring a skill, editing a rule, or reviewing application code. Output: one mode-specific report with evidence and a clear gate."
metadata:
  dhpk-invocation-class: "implicit-eligible"
---

# Skill Scope

Choose exactly one governance mode before loading its detail. The mode is the
deliverable boundary: do not run the other modes unless the user starts a new
request that needs them.

Record invocation cost and context cost before loading mode-specific material.
Make completion checkable, and prune no-op or duplicated sediment from reports.

## When NOT to Use

- Create or refactor a skill, or distill cross-cutting rules → use `skill-forge`.
- Review a code, pull request, security surface, test suite, or document → use
  `change-verdict`.
- Understand or trace application code → use `code-trace`.
- Execute a planned repository change → use `flow-drive`.

## Mode selection

| Mode | Select when | Load only then |
| --- | --- | --- |
| `health` | Structural lint of one skill or package | `routing-signature-guide.md`, `skill-lint.js` |
| `judge` | Deep quality score of one skill or package | `judge-philosophy.md`, `judge-scoring-rubric.md`, `judge-failure-patterns.md` |
| `stocktake` | Batch audit of installed consumer skills and commands | `scan.sh`, `quick-diff.sh`, `save-results.sh` |
| `scout` | Search for an existing local, marketplace, or remote skill | No extra reference; search sources in order |

## Workflow

1. State the selected mode and the target set. Done means the target and mode
   are unambiguous.
2. Load only the mode-specific references or scripts named in the table.
3. Collect deterministic facts before judgment. Preserve source paths, command
   output, timestamps, and exit codes as evidence.
4. Produce the mode's report and a binary gate (`PASS`, `FAIL`, or `BLOCKED`).
   Done means every target is represented and every failed gate has a reason.

### `health`

Run `node skills/skill-scope/scripts/skill-lint.js --skills-dir skills
--agents-dir agents --commands-dir commands --fix-hint`. Treat P0/P1 findings
as failures; keep P2 advisories visible. Read `routing-signature-guide.md`
only when a routing finding needs a manual correction.

### `judge`

Read the target package completely. Mark each section as expert, activation,
or redundant; then read `judge-scoring-rubric.md` before scoring all dimensions.
Use `judge-philosophy.md` when the knowledge-delta decision is uncertain and
`judge-failure-patterns.md` when naming a failure mode. Report evidence, total,
grade, critical issues, and the top three improvements.

### `stocktake`

Inventory global and project consumer skill directories, not the canonical
source tree. Use `scan.sh` for a full inventory. When a prior result exists,
use `quick-diff.sh` and re-evaluate only changed entries; persist approved
results with `save-results.sh`. Batch judgment in bounded groups and keep the
inventory, verdict, and consolidation recommendation separate.

### `scout`

Search local installed sources first, then marketplace sources, then GitHub or
web sources. Rank at most ten candidates by match and maintenance evidence.
Read and vet an external candidate before recommending use or a fork; surface
unexpected commands, writes, network access, credential handling, and installs.
End with one recommendation: use existing, fork or extend, or create fresh.

## Output

```text
Mode → Target → Evidence collected → Findings → Gate → Next action
```

For `judge`, include the score table and grade. For `stocktake`, include the
per-skill verdict table and result-file status. For `scout`, include the ranked
candidate table and recommendation.

## Verification

- [ ] Exactly one mode was selected and only its branch detail was loaded.
- [ ] Deterministic commands, paths, timestamps, and exit codes are recorded.
- [ ] Every target or candidate is accounted for; skipped items have reasons.
- [ ] The report contains an observable gate and one next action.
- [ ] External candidates were read and vetted before adoption is suggested.

## References

- `routing-signature-guide.md` — read for health-mode routing remediation.
- `judge-philosophy.md` — read for knowledge-delta and expert-content calls.
- `judge-scoring-rubric.md` — read before assigning judge scores.
- `judge-failure-patterns.md` — read when naming judge failure modes or doing the final checklist.

## Scripts

- `skill-lint.js` — structural and routing lint; exit 0 means no findings, 1 warnings, 2 P0/P1 errors.
- `scan.sh` — full consumer-skill inventory as JSON.
- `quick-diff.sh` — changed-since-last-result inventory as JSON.
- `save-results.sh` — validated result merge with a UTC timestamp.
