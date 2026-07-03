# Relationship with `/req-analyze`

Request tickets are **work breakdown units** derived from `/tech-spec`, not requirements documents themselves. They live in a different document class (date-prefixed non-lifecycle vs numeric-prefix lifecycle).

| Dimension | `/create-request` → `requests/YYYY-MM-DD-*.md` | `/req-analyze` → `1-requirements.md` |
|-----------|------------------------------------------------|---------------------------------------|
| Doc class | **Request ticket** (date-prefixed, non-lifecycle) | **Lifecycle** (Phase 1, numeric prefix) |
| Count per feature | **Many** (one per task) | **One** (upsert) |
| Position in workflow | **After** `/tech-spec` (execution phase) | **Before** `/tech-spec` (design phase) |
| Content focus | Execution — Status, Progress, AC checklist, Related Files | Problem space — 5-Why, FR/NFR, MoSCoW, stakeholders |
| Granularity | **Single task** (AC ≤ 8) | **Feature-wide** |
| Update pattern | Status tracking (`scan` / `update` / `update-all` / `--verify-ac`) | Document upsert |
| Audience | Executors, progress trackers | Designers, decision-makers |

## Workflow ordering

```
/req-analyze → /tech-spec → /create-request → /feature-dev
   (Phase 1)    (Phase 2)    (ticket per task)    (implement)
```

A request ticket references its parent `/tech-spec` for technical detail and may optionally link to `1-requirements.md` for problem-space rationale (when `/req-analyze` was run).

## Anti-patterns to avoid

| Anti-pattern | Correct approach |
|--------------|------------------|
| Writing 5-Why / stakeholder analysis inside a request ticket | Put it in `1-requirements.md` via `/req-analyze`; ticket just references it |
| Adding `## Progress` / `## Status` tables to `1-requirements.md` | Progress tracking belongs in request tickets, not the lifecycle requirements doc |
| Creating one request ticket per whole feature (AC > 8) | Split by layer or functional area; see Granularity Guide in `template.md` |
| Treating `1-requirements.md` as a prerequisite for creating requests | It is advisory-only; requests work standalone when only tech-spec exists |
