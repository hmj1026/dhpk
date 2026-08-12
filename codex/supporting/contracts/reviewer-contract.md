# Codex Shared Reviewer Dispatch Contract

Every reviewer prompt is composed from these fields, in order:

1. **Scope** — the implementation wave and exact changed paths.
2. **Specialist charter** — the lane-specific checks owned by this reviewer.
3. **Evidence commands** — commands run, or a clear note when unavailable.
4. **Artifact path** — the fresh report location under `.codex/artifacts/`.
5. **Verdict** — the role's existing `APPROVE|WARNING|BLOCK` or `PASS|WARNING|FAIL` vocabulary.
6. **Confirm-only** — named findings to confirm for a bounded re-review; omit for a new wave.

For a dispatched wave, the report should also carry `scope_id` and `diff_id`
from the dispatch record. When either identity is present, both must match the
current obligation; a foreign wave remains unresolved.

## Single-run verdict

The final verdict MUST be emitted in the same run that performed the review.
Do not stop for an advisory response before writing it. A fresh report must
contain concrete file/line evidence, the verdict, and any bounded next steps;
a reply without that evidence is not a completed review.

## Misplaced review evidence

The parent flow scopes reports to the current dispatch obligation rather than
trusting a filename or directory alone. It records a dispatch baseline plus
session, attempt, and dispatch identity when available; reports older than the
baseline or carrying foreign provenance remain unresolved. If several fresh
reports qualify, choose the newest report and use its relative path as the
deterministic tie-breaker. A fresh report without provenance may be considered
only when it belongs to the current run, and diagnostics should expose relative
paths only.

## Manual resume

Codex has no Claude sentinel or automatic reviewer lifecycle. When a parent
flow asks a reviewer to resume, the parent supplies the exact scope and prior
finding; the reviewer confirms only that finding or reports a new one. A stale,
missing, or misplaced artifact leaves the review unresolved until the parent
dispatches a fresh run.

## Verdict semantics

- `APPROVE` / `PASS`: no blocking findings remain.
- `WARNING`: findings are recorded but do not meet the role's blocking threshold.
- `BLOCK` / `FAIL`: a critical or otherwise blocking finding remains.

The parent flow owns orchestration and lifecycle. Reviewers write the report,
return the final verdict, and never invoke host-specific sentinel helpers.
