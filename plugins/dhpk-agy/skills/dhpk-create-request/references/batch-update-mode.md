# Batch Update Mode (`--update-all`) — Detailed Phases

Scan all incomplete requests, cross-reference with git history, and batch-update docs where implementation evidence exists. This automates what would otherwise require running `--update` on each doc individually.

## Workflow

```
Phase 1: Discover  -> Reuse Scan Mode Phase 1-3 to find incomplete docs
Phase 2: Verify    -> For each doc, check git log for Related Files commits
Phase 3: Classify  -> Sort into: updatable (has commits) vs unchanged (no commits)
Phase 4: Batch Edit -> Update Status, AC checkboxes, Progress table for each updatable doc
Phase 5: Report    -> Output change summary table
```

## Phase 2: Git Verification

For each incomplete request doc, extract the feature name from path and search for evidence:

**Priority**: Use Related Files from request doc when available (most accurate). Fall back to feature slug heuristic only when Related Files section is absent.

```bash
# Priority 1: Use Related Files from request doc (if present)
# Parse "## Related Files" table → extract file paths → git log per path

# Priority 2: Feature slug heuristic (fallback)
git log --oneline --all -- skills/<feature>/ | head -5
```

**Exclude docs-only commits**: Filter out commits that only touch `docs/` paths — these are doc-sync commits, not implementation evidence. A valid evidence commit must touch at least one non-docs file.

## Phase 3: Classification

| Category | Condition | Action |
|----------|-----------|--------|
| ALL_CHECKED | AC all `[x]` but Status ≠ Completed/Candidate Complete | Update Status → Candidate Complete (heuristic-only, not Completed) |
| HAS_COMMITS | Git commits exist for Related Files | Read doc → verify AC → update |
| LEGACY_METADATA | No blockquote Status (table format or missing) | Check table format; if already Completed → skip |
| NO_EVIDENCE | No git commits, AC unchecked | Skip (report as unchanged) |

## Phase 4: Batch Edit Rules

For each updatable doc:

1. **Status**: If all AC checked (heuristic) → `Candidate Complete`. If some AC checked → `In Progress`. Only `--verify-ac` (single update) can set `Completed`.
2. **AC checkboxes**: Cross-reference git diff to determine which ACs are met. Only check ACs with clear implementation evidence.
3. **Progress table**: Update phase statuses based on commits found.
4. **Missing metadata**: Add blockquote metadata header if doc only has table format or no metadata.

## Phase 5: Report Format

```markdown
## Batch Update Report

| # | Request | Feature | Before | After | Changes |
|---|---------|---------|--------|-------|---------|
| 1 | Bug-fix redesign | bug-fix-redesign | Pending 0/14 | Candidate Complete 14/14 | Status + AC + Progress |
| 2 | Safe-remove | safe-remove | Pending 0/12 | Candidate Complete 12/12 | Status + AC |
| 3 | Multi-ecosystem | multi-ecosystem | Pending 0/23 | Pending 0/23 | (no changes — no commits) |

**Updated**: N / **Unchanged**: N / **Total scanned**: N
```
