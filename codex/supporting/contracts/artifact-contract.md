# Codex Agent Artifact-Output Contract

This file is the Codex projection of the shared artifact contract. It defines
persisted report paths, frontmatter, verdict vocabulary, and retention without
Claude lifecycle hooks or sentinel files.

## Does this output belong here?

Use `.codex/artifacts/` for session-scoped evidence that should not enter a PR;
use `docs/` for durable project deliverables that teammates need on a fresh
clone. Review reports, audits, plans, and ADR fallbacks belong in the former;
codemaps, feature specs, and knowledge-base pages belong in the latter.

## Path template

```
.codex/artifacts/<category>/<agent>-{yyyymmdd-HHMMSS}-{slug}.md
```

- Timestamp uses the project's local timezone (dhpk defaults to Asia/Taipei).
- `slug` is short ASCII kebab-case.
- Reviewers normally use `reviews/`; audit-style roles use `audits/`.
- `architect` uses `plans/` and `adr/` as documented in its role.
- `codemaps/` is an optional session log; tracked codemaps remain under
  `docs/CODEMAPS/`.

## Universal frontmatter

Every artifact-writing role includes at minimum:

```yaml
---
agent: <agent-name>
generated_at: <ISO8601 with the project's local offset>
commit: <short-sha>
scope: [path/a, path/b]
---
```

## Reviewer-family extension

Severity-graded findings add:

```yaml
severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }
verdict: APPROVE | WARNING | BLOCK
```

Audit-style roles may use `PASS | WARNING | FAIL` instead. Non-reviewer roles
document their own extra fields inline; do not invent a third verdict vocabulary.

## Retention and degradation

Retention is advisory: prune old reports for navigability, never as a runtime
requirement. If `.codex/artifacts/` or its category directory is absent, emit
the report to stdout and continue; do not fail only because the directory is
missing.

## Codex lifecycle boundary

The parent flow invokes reviewers manually and owns lifecycle. A reviewer writes
one fresh artifact, returns its final verdict in the same run, and never calls a
Claude hook, sentinel, or host-specific cleanup helper. A missing or stale
artifact means the review is unresolved and the parent must dispatch again.
