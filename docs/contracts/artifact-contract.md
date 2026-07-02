# Agent Artifact-Output Contract

SSOT for the write-to-disk conventions shared across dhpk agents that persist a report, review, or plan under `.claude/artifacts/`. Extracted from what was previously copy-pasted (and drifting) inline across 18 agent files. Referenced from each agent's own "Closing — Artifact Output" section, which keeps only what's genuinely agent-specific: its own path category, its own extra frontmatter fields, and whether it's sentinel-driven.

## Path template

```
.claude/artifacts/<category>/<agent>-{yyyymmdd-HHMMSS}-{slug}.md
```

- Timestamp in the project's local timezone (dhpk defaults to Asia/Taipei).
- `slug` is ASCII kebab-case, short.
- Known categories: `reviews/` (most reviewer-family agents), `audits/` (harness-reviser), `codemaps/` (doc-updater), `refactors/` (refactor-cleaner). `architect` is the one exception with two categories (`plans/`, `adr/`) instead of `reviews/` — document that inline in its own Closing section, don't force it into this template.
- Some agents have no artifact at all (`docs-lookup` is read-only-reply; `spec-miner`'s deliverable is `openspec/specs/<capability>/spec.md`, not a `.claude/artifacts/` report) — those agents document that exception inline instead of using this template.

## Universal frontmatter fields

Every artifact-writing agent includes at minimum:

```yaml
---
agent: <agent-name>
generated_at: <ISO8601, +08:00 offset or the project's local offset>
commit: <short-sha>
scope: [path/a, path/b]
---
```

## Reviewer-family extension

Agents that produce a severity-graded finding list add:

```yaml
severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }
verdict: APPROVE | WARNING | BLOCK   # or PASS | WARNING | FAIL — see below
```

Two verdict vocabularies are both in current use — pick the one matching the agent's own body, don't invent a third:

- **APPROVE | WARNING | BLOCK** (`code-reviewer`, `doc-reviewer`, `frontend-reviewer`, `polyfill-reviewer`, and others with a `Verdict:` line convention): APPROVE = no CRITICAL/HIGH finding; WARNING = HIGH only; BLOCK = any CRITICAL finding.
- **PASS | WARNING | FAIL** (`database-reviewer`, `security-reviewer`, `migration-reviewer`, `performance-analyzer`, `tdd-guide`): used by audit/analysis-style agents; each agent's own body defines what PASS vs FAIL means for its domain (e.g. `tdd-guide` ties it to `coverage_pct`).

Non-reviewer agents keep their own extra fields documented inline, not centralized here — they're genuinely agent-specific:

- `architect`: `verdict` only, no `severity_summary` (a design review isn't severity-graded the same way).
- `refactor-cleaner`: `removed[]`, `consolidated[]`.
- `harness-reviser`: `baseline_pass`, `post_pass`, `deferred[]`, `verdict`.
- `doc-updater`: `updated_files[]`, no `verdict` (it's a sync operation, not a gate).
- `tdd-guide`: `coverage_pct` alongside `verdict (PASS|WARNING|FAIL)`.
- `e2e-runner`: `pass_rate` alongside `verdict (PASS|WARNING|FAIL)`.
- `polyfill-reviewer`: `guards_reviewed` alongside the APPROVE/WARNING/BLOCK shape.
- `agent-evaluator`, `type-design-analyzer`: `verdict` only, no `severity_summary`.

## Retention

Keep the most recent ~30 artifacts per category; move older ones to `archive/`.

## Degradation

If `.claude/artifacts/` (or the specific category subdirectory) does not exist, emit the report to stdout only — do not error.

## Sentinel-clear hook (sentinel-driven agents only)

```
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" <sentinel-name> <agent-name>
```

N/A for agents not in the sentinel review chain (`doc-updater`, `harness-reviser`, `tdd-guide`, `type-design-analyzer`, `architect`, `agent-evaluator`, `refactor-cleaner`, `e2e-runner`, `performance-analyzer`, `spec-miner`, `deep-reasoner`, `fast-worker`) — those either have no sentinel slot or are triggered by explicit invocation / a back-stop, not a `.pending-*` sentinel.
