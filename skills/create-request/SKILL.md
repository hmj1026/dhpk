---
name: create-request
description: 'Create, update, or scan per-task request tickets for progress tracking. These are date-prefixed non-lifecycle docs under requests/, NOT feature-level requirements (use /req-analyze for those). Use when: tracking task progress, updating completion status, scanning incomplete requests, checking request status dashboard. Not for: feature-level problem-space analysis (use req-analyze for 1-requirements.md lifecycle doc), tech specs (use tech-spec), code implementation (use feature-dev). Output: request ticket with status tracking, referencing parent tech-spec.'
allowed-tools: 'Read, Grep, Glob, Write, Bash, AskUserQuestion, Agent'
---

# Create/Update Request Skill

## Trigger

- Keywords: create request, new request, write request, build request, update request, sync progress, scan requests, request status, incomplete requests, request dashboard

## Mode Overview

```mermaid
flowchart LR
    A[/create-request] --> B{Mode?}
    B -->|--status| C[Scan: Discover → Parse → Filter → Report]
    B -->|--update-all| F[Batch Update: Scan → Git Verify → Batch Edit → Report]
    B -->|--update| D[Update: Load → Analyze → Map → Update → Report]
    B -->|default| E[Create: Gather → Explore → Generate → Confirm]
```

## Modes

| Mode     | Trigger Condition             | Action                          |
| -------- | ----------------------------- | ------------------------------- |
| `create` | No file specified / new request | Gather info -> Fill template -> Create file |
| `update` | File specified / update request | Read current state -> Check implementation -> Update progress |
| `update-all` | `--update-all` flag | Batch scan → git verify → update all stale docs → report |
| `scan`   | `--status` flag                 | Scan all requests -> Parse metadata -> Filter incomplete -> Report |

### Arguments

| Flag | Applies To | Description |
|------|-----------|-------------|
| `--verify-ac` | `--update` (single) | Dispatch Explore agent to verify AC completion with evidence (file:line). Supports auto-detected path via feature context 5-level cascade. Not available with `--update-all`. |

## When NOT to Use

- **Feature-level requirements analysis** (use `/req-analyze` — produces `1-requirements.md`, a Phase 1 lifecycle doc for problem-space analysis; see `references/req-analyze-relationship.md`)
- Viewing request structure (use request-tracking)
- Writing tech spec (use /tech-spec)
- Code development (use feature-dev)

Request tickets are **work breakdown units** derived from `/tech-spec`, not requirements documents themselves — a different document class (Request tickets are date-prefixed, non-lifecycle; requirements docs are numeric-prefix lifecycle docs). Workflow position: `/req-analyze` → `/tech-spec` → `/create-request` → `/feature-dev`. See `references/req-analyze-relationship.md` for the full comparison and anti-patterns.

---

## Create Mode Workflow

```
Phase 1: Gather     -> Collect feature, title, priority, requirements
Phase 1.5a: Quick   -> AC count + layer keyword scan (pre-Explore)
Phase 2: Explore    -> Search related code + tech specs
Phase 1.5b: Refined -> Layer mixing (Related Files) + scope breadth + WBS (post-Explore)
Phase 3: Generate   -> Fill template + create file(s)
Phase 4: Confirm    -> Display result + suggest next steps
```

### Phase 1.5: Granularity Check (summary)

Two-pass assessment of whether the request should be split into focused tickets. Primary signals: AC count > 8, layer mixing (behavior `.md` vs code `.sh`/`.js`), scope breadth (3+ independent areas). Secondary (×0.5): WBS groups ≥ 2, effort > 3 days.

```
signal_count = primary_count + 0.5 × secondary_count
< 2 → single request   ≥ 2 → suggest split   ≥ 3 → strongly recommend split
```

On split, create indexed siblings `...-r1.md`, `...-r2.md`, each with its own AC subset (≤8). Full signal table, split-suggestion prompt, and sibling-output rules: `references/granularity-split.md`.

### Create Mode: Interaction

If incomplete info, ask:

```
1. Feature area: Which feature? (e.g., auth, billing, notifications)
2. Title: Brief description
3. Priority: P0 (urgent) / P1 (high) / P2 (medium)
4. Background: Why is this needed?
5. Requirements: What needs to be done? (list)
6. Acceptance criteria: How do we know it's done?
```

---

## Update Mode Workflow

**Path resolution**: `--update` supports three forms:

| Form | Behavior |
|------|----------|
| `--update <path>` | Use explicit path (must match `docs/features/*/requests/*.md`) |
| `--update` (no path) | Auto-detect from feature context (see `references/feature-context-resolution.md`) |
| `--update <keyword>` | Resolve feature key, then find active request(s) |

**Auto-detection** (when no explicit path): resolve feature context via the 5-level cascade (`node scripts/resolve-feature-cli.js`), scan `docs/features/<key>/requests/*.md` for incomplete requests (Status not in `[Completed, Done, Superseded]`); 1 active → auto-select, multiple → AskUserQuestion, 0 → offer create, unresolved → Gate: Need Human.

```
Phase 1: Load      -> Read existing request document
Phase 2: Analyze   -> Analyze Related Files + git changes
Phase 2.5: Verify  -> (--verify-ac only) Agent-based AC verification
Phase 3: Map       -> Compare implementation with Acceptance Criteria
Phase 4: Update    -> Update Progress / Status / Checkboxes
Phase 5: Report    -> Output change summary
```

**Status lifecycle**: Pending → In Progress → Candidate Complete → Completed. `Candidate Complete` = all AC checked but not closure-grade verified. Only `--verify-ac` with all-High confidence sets `Completed`. Per-phase git-analysis commands, the `--verify-ac` agent prompt, confidence-to-status mapping, progress-mapping rules, and auto-update item logic: `references/update-mode.md`.

---

## Scan Mode Workflow (`--status`)

```
Phase 1: Discover  -> Glob docs/features/*/requests/*.md (exclude archived/)
Phase 2: Parse     -> Extract Status, Priority, Created, AC progress from each doc
Phase 3: Filter    -> Keep incomplete (Status ≠ Completed, Done, Superseded)
Phase 4: Report    -> Group by status, sort by priority then date, output markdown
```

Console-only dashboard (no file creation), grouped by actionability: In Progress → Candidate Complete → Pending (with `[stale]` for Pending > 30 days) → Design/Proposed. Top summary line `N incomplete / M total (K archived excluded)`. Metadata-format patterns (blockquote vs table), classification table, columns, and sort order: `references/scan-mode.md`.

---

## Batch Update Mode (`--update-all`)

Scan all incomplete requests, cross-reference with git history, and batch-update docs where implementation evidence exists.

```
Phase 1: Discover  -> Reuse Scan Mode Phase 1-3 to find incomplete docs
Phase 2: Verify    -> For each doc, check git log for Related Files commits
Phase 3: Classify  -> Sort into: updatable (has commits) vs unchanged (no commits)
Phase 4: Batch Edit -> Update Status, AC checkboxes, Progress table for each updatable doc
Phase 5: Report    -> Output change summary table
```

Evidence priority: Related Files from the doc first, feature-slug heuristic as fallback; exclude docs-only commits. Heuristic completion sets `Candidate Complete` (never `Completed`). Git-verification commands, classification categories, batch-edit rules, and report format: `references/batch-update-mode.md`.

## File Naming

**Format**: `YYYY-MM-DD-kebab-case-title.md` — **Location**: `docs/features/{feature}/requests/`

## Output

- Request document at `docs/features/<feature>/requests/YYYY-MM-DD-<title>.md`
- Sections: Background, Requirements, Scope, Related Files, Acceptance Criteria, Progress, References
- Status: New or Updated (scan/batch modes emit console-only reports, no file)

## Verification

- File naming follows convention
- All template sections are filled
- Related file links are correct
- Acceptance criteria use checkboxes

## After Creation

Request tickets are created **after** `/tech-spec` exists. Suggest execution-oriented next steps:

1. `/feature-dev` — Start implementation following the ticket's Acceptance Criteria
2. `/verify` — Run tests after implementation
3. `/create-request --update` — Sync progress as work completes

**Exception**: If the ticket was created before a tech spec exists (emergency or exploratory work), consider running `/tech-spec` first to capture the technical design the ticket will execute against.

## References

- `references/template.md` — request document template, naming convention, priority/status tables, writing & granularity guides. Read when creating a ticket or deciding split granularity.
- `references/req-analyze-relationship.md` — full `/create-request` vs `/req-analyze` comparison, workflow ordering, anti-patterns. Read when unsure whether a ticket or a `1-requirements.md` is the right doc.
- `references/granularity-split.md` — signal-detection table, decision logic, split-suggestion prompt, sibling-output rules. Read during Phase 1.5 when assessing a split.
- `references/feature-context-resolution.md` — the 5-level feature-context cascade, upsert decision table, cross-link invariants. Read for `--update` auto-detection.
- `references/update-mode.md` — per-phase update mechanics, `--verify-ac` agent prompt, confidence/progress mapping, auto-update items. Read when running `--update`.
- `references/scan-mode.md` — discovery globs, metadata parsing, filter/classify, dashboard report format. Read when running `--status`.
- `references/batch-update-mode.md` — git verification, classification, batch-edit rules, report format. Read when running `--update-all`.
- `references/examples.md` — worked input → action examples per mode. Read for concrete invocation patterns.

## Related Skills

| Skill              | Purpose                   |
| ------------------ | ------------------------- |
| `request-tracking` | Request structure knowledge base |
| `tech-spec`        | Tech spec writing         |
| `feature-dev`      | Development workflow      |
