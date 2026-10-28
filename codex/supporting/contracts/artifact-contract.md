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

`BLOCK` and `FAIL` record a defect from checked evidence at that role's own
threshold. `code-reviewer` and `frontend-reviewer` use `BLOCK` for any CRITICAL
finding. The library-author polyfill review uses that same CRITICAL threshold.
It is capability-gated and has no direct Codex role here. `doc-reviewer`
uses `BLOCK` for any HIGH finding. `BLOCKED` means required capability or
evidence is missing. It is not a worse defect and not a synonym of `BLOCK` or
`FAIL`. A review that did not run stays `NOT_RUN` or `UNAVAILABLE`.
change-verdict `READY` / `BLOCKED` / `INCONCLUSIVE` is a separate response gate
and is not mapped here.

## Codex read-only handoff

A read-only role returns one inline result with scope, source identity, verdict, findings, and evidence gaps. It does not write an artifact. When the parent has write authority, the parent may persist that result. A complete inline result is finished; do not dispatch the role again only because the report file is missing.

A role that writes may still produce assigned test traces and runner output. Those files stay separate from the summary, which is the inline result. Evidence that was not observed stays NOT_RUN, UNAVAILABLE, or BLOCKED. It is not PASS.

Retention of any parent-persisted copy is advisory. Prune old copies for navigability, never as a runtime requirement.

## Model and effort precedence

When a custom agent file sets model or model_reasoning_effort, that file value takes precedence. Before the file applies, Codex resolves each setting from an explicit spawn value, then the [agents] default, then the parent. A start argument does not rewrite a pinned file effort. Warm review at medium uses a separate verified profile whose file sets model_reasoning_effort to medium.

## Permission boundary

sandbox_mode in a custom agent file does not create an independent sandbox. The parent session owns sandbox and approval. Read-only behavior is the role instruction together with that parent policy. Hard isolation uses the root session or tool policy, not an agent-file sandbox field.

## Codex agent TOML schema

Required fields are name, description, and developer_instructions. dhpk roles also set model and model_reasoning_effort. Do not require Claude tools or Claude model aliases. Do not declare sandbox_mode. A citation that the consumer install cannot resolve is UNAVAILABLE, not PASS.
