# Phase 1.5: Granularity Check & Split

Assess whether the request should be split into multiple focused tickets. This runs in two passes (1.5a pre-Explore, 1.5b post-Explore) to balance early detection with accurate analysis.

## Signal Detection

| Signal | Detection | Weight |
|--------|-----------|--------|
| **AC count > 8** | Count `- [ ]` items. Exclude quality-gate ACs matching: `/codex-review-fast`, `/codex-review-doc`, `/codex-review`, `/precommit`, `/precommit-fast`, `/pr-review` | Primary |
| **Layer mixing** | **1.5a**: keyword scan for `rules/`, `hooks/`, `scripts/` in requirements text. **1.5b**: classify Related Files into behavior-layer (`.md` rules/skills) vs code-layer (`.sh`/`.js` hooks/scripts) | Primary |
| **Scope breadth** | Requirements has 3+ functionally independent areas | Primary |
| **WBS groups ≥ 2** | Tech spec has `Work Breakdown` heading with 2+ independent task groups (secondary, high-confidence only) | Secondary (×0.5) |
| **Effort > 3 days** | Tech spec WBS has multiple M/L items | Secondary (×0.5) |

## Decision Logic

```
signal_count = primary_count + 0.5 × secondary_count

< 2  → proceed as single request (no suggestion)
≥ 2  → suggest split (advisory AskUserQuestion)
≥ 3  → strongly recommend split
```

## Split Suggestion

When triggered, use AskUserQuestion:

```
## Granularity Assessment

This request has {N} acceptance criteria (target: ≤8) and {layer_info}.

Suggested split:
1. {Title A} — {scope A} ({AC_count_A} AC)
2. {Title B} — {scope B} ({AC_count_B} AC)

Options:
- "Split into {N} requests" (Recommended)
- "Keep as 1 request"
```

Split by: **layer** (behavior vs code) if detected, then **functional area** if scope breadth detected, then **balanced AC groups** as fallback.

## Sibling Request Output

When user accepts split, create indexed files: `YYYY-MM-DD-{title-slug}-r1.md`, `...-r2.md`, etc. (e.g., `2026-03-18-auth-fix-r1.md`, `2026-03-18-auth-fix-r2.md`). Each gets its own AC subset (target ≤8), scoped Related Files, and conditional `> **Depends On**:` header if dependency exists between siblings.
