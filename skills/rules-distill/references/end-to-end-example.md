# Rules Distill End-to-End Example

```text
$ /rules-distill

Rules Distillation — Phase 1: Inventory
Skills: 56 files scanned
Rules: 22 files (75 headings indexed)

[Analyze thematic batches with full rules text]
[Cross-batch merge: deduplicate and promote cross-batch candidates]

# Rules Distillation Report

| # | Principle | Verdict | Target | Confidence |
|---|-----------|---------|--------|------------|
| 1 | Validate LLM output before reuse | New Section | coding-style.md | high |
| 2 | Define explicit loop stop conditions | New Section | coding-style.md | high |
| 3 | Compact context at phase boundaries | Append | performance.md §Context Window | high |

Each detail includes evidence from 2+ skills, violation risk, and draft text.

Approve, modify, or skip each candidate by number:
> User: Approve 1, 3. Skip 2.

✓ Applied: coding-style.md §LLM Output Validation
✓ Applied: performance.md §Context Window Management
✗ Skipped: Iteration Bounds

Results saved to results.json
```
