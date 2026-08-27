# Scan Mode (`--status`) — Detailed Phases

Scan mode discovers all request docs, parses metadata, filters out completed ones, and prints a console-only status dashboard (no file creation).

## Workflow

```
Phase 1: Discover  -> Glob docs/features/*/requests/*.md (exclude archived/)
Phase 2: Parse     -> Extract Status, Priority, Created, AC progress from each doc
Phase 3: Filter    -> Keep incomplete (Status ≠ Completed, Done, Superseded)
Phase 4: Report    -> Group by status, sort by priority then date, output markdown
```

## Phase 1: Discovery

```
Glob: docs/features/*/requests/*.md
Exclude: docs/features/*/requests/archived/*.md
```

Count total, active, and archived separately.

## Phase 2: Metadata Parsing

Support two metadata formats (try in order, use first match):

| Format | Status Pattern | Priority Pattern | Created Pattern |
|--------|---------------|-----------------|-----------------|
| Blockquote | `> **Status**: <value>` | `> **Priority**: <value>` | `> **Created**: <value>` |
| Table | `^\| Status \| **?<value>**? \|` (anchor to line start, metadata section only — first 15 lines) | `^\| Priority \| <value> \|` | `^\| Created \| <value> \|` |

**Fallback**: If metadata missing, extract date from filename (`YYYY-MM-DD-*`), default status to `unknown`, priority to `--`.

**AC Progress**: Count `- [x]` (checked) vs total `- [ ]` + `- [x]` in `## Acceptance Criteria` section.

**Feature name**: Extract from path — second segment after `docs/features/` (e.g., `docs/features/auth/requests/...` → `auth`).

## Phase 3: Filter & Classify

| Status | Classification | Include in Report |
|--------|---------------|-------------------|
| Completed | Done | No |
| Done | Done | No |
| Superseded | Done | No |
| In Progress / In Development / In Dev | Active | Yes |
| Candidate Complete | Active (needs verification) | Yes — group after In Progress |
| Pending | Backlog | Yes |
| Design / Proposed | Pre-work | Yes |
| unknown | Backlog (grouped with Pending) | Yes |

**Stale detection**: Pending requests with Created date > 30 days ago → mark `[stale]`.

## Phase 4: Report Format

Console-only markdown output (no file creation). Group by status in actionability order:

1. **In Progress** — active work, highest actionability
2. **Candidate Complete** — heuristic-complete, needs `--verify-ac` confirmation
3. **Pending** — backlog, includes stale detection
4. **Design / Proposed** — pre-implementation

Each group as a table with columns: `#`, `Request`, `Feature`, `Priority`, `Created`, `AC`, `Path`.
Pending group adds a `Stale` column.

**Sort order within each group**: Priority descending (`P0 > P1 > P2 > --`), then Created ascending (oldest first).

Bottom summary table: status counts + average age (days since Created).

Summary line at top: `N incomplete / M total (K archived excluded)`.
