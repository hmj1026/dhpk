# Update Mode — Detailed Phases

Update mode reads an existing request document, analyzes implementation evidence, and syncs Status / Progress / AC checkboxes. Entry routing (path resolution, auto-detection) lives in `SKILL.md`; this file covers the per-phase mechanics.

## Workflow

```
Phase 1: Load      -> Read existing request document
Phase 2: Analyze   -> Analyze Related Files + git changes
Phase 2.5: Verify  -> (--verify-ac only) Agent-based AC verification
Phase 3: Map       -> Compare implementation with Acceptance Criteria
Phase 4: Update    -> Update Progress / Status / Checkboxes
Phase 5: Report    -> Output change summary
```

## Phase 2: Analyze Implementation Progress

```bash
# Get changes for Related Files from request document
git log --oneline --since="<created_date>" -- <related_files>

# Check test status
grep -rE "describe|it\(" test/ --include="*<feature>*"

# Check review status
git log --oneline --grep="codex-review" -- <related_files>
```

## Phase 2.5: AC Verification Agent (`--verify-ac` only)

Dispatched when `--verify-ac` flag is present on single-request `--update`. Supports auto-detected path via feature context 5-level cascade. Skipped otherwise (default path unchanged, <10 sec).

**Input**: AC_LIST from `## Acceptance Criteria` (filter quality-gate ACs per codex-code-review Step 1.5 pattern). RELATED_FILES from `## Related Files` table.

```
Agent({
  description: "Verify AC completion for <feature>",
  subagent_type: "Explore",
  prompt: `AC verification specialist.
    AC_LIST: ${AC_LIST}
    RELATED_FILES: ${RELATED_FILES}
    For each AC: read code, verify implementation.
    Output per AC:
    - Status: Complete | Partial | Not Found | Inconclusive
    - Evidence: file:line references
    - Confidence: High | Medium | Low
    - Gap (if Partial): what is missing`
})
```

**Timeout**: 60 sec hard limit. Unverified ACs on timeout marked `Inconclusive`.

**Graceful degradation**: Agent dispatch fails → warn user, fall back to git-based heuristic (Phase 2 results).

**Confidence-to-status mapping**:

| Condition | Status |
|-----------|--------|
| All AC `Complete` with `High` confidence | `Completed` |
| All AC checked but any `Medium`/`Low`/`Inconclusive` | `Candidate Complete` + verification summary in Progress.Note |
| Some AC `Not Found` or `Partial` | `In Progress` |

## Phase 3: Progress Mapping Rules

| Implementation Status               | Progress Update      |
| ------------------------------------ | -------------------- |
| Related Files have commits           | Development -> In Progress |
| Test files added/modified            | Testing -> In Progress |
| `/codex-review-fast` passed          | Development -> Done  |
| `/precommit` passed                  | Testing -> Done      |
| All Acceptance Criteria checked      | Acceptance -> Done   |

## Phase 4: Auto-Update Items

| Section               | Update Logic                              |
| --------------------- | ----------------------------------------- |
| `Status`              | Canonical lifecycle: Pending → In Progress → Candidate Complete → Completed. Candidate Complete = all AC checked but not closure-grade verified (either heuristic-only, or `--verify-ac` with non-High confidence). Only `--verify-ac` with all-High confidence sets `Completed`. Normalize variants: `In Development`/`In Dev` → `In Progress`; `Done` → `Completed` |
| `Progress` table      | Update each phase status based on git changes |
| `Acceptance Criteria` | Check checkboxes based on implementation/test results |
| `Progress.Note`       | Add latest commit message summary         |

## Update Mode: Interaction

If confirmation needed, ask:

```
1. Confirm target request document path
2. Any manually completed items to check off?
3. Any blocked items to mark?
```
