---
name: dhpk-implement
description: "Backend-neutral implementation workflow for spec decomposition, context collection, ordered delivery, verification, review, and bounded retries. The current model is the default; optional CLI, AGY, or blind second-opinion backends require an explicit flag. Not for architecture-only advice, post-hoc code review, or tiny one-line edits."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Implement

Use this skill when a confirmed specification needs implementation. Keep the
workflow backend-neutral: the current Claude model is the default primary implementer, while
`--backend cli|agy` selects an optional explicit worker backend. An explicit
`--second-opinion=codex-exec` may add a blind, read-only opinion through
`codex exec`; it is additional evidence, never the primary implementation or a
silent fallback.

## When not to use

- Architecture or module-boundary decisions only: use `dhpk-module-design`.
- Post-hoc correctness or standards review: use `dhpk-change-review`.
- Tiny one-line maintenance: inspect, patch, and run the designated review.
- Bug diagnosis without a confirmed cause: use the root-cause workflow first.

## Workflow

### 1. Parse and decompose

Read `--spec` when supplied; otherwise treat the request as the specification.
If the request has no actionable requirement, ask for the requirement, target,
and reference files. Break the work into small logical items that can be
implemented in dependency order, then record:

| # | Item | Target | Depends on |
|---|------|--------|------------|
| 1 | one observable unit | file or module | prior item or `-` |

Present this plan before editing. For OpenSpec work, preserve the change's
task order and leave unchecked tasks unchecked until their evidence exists.

### 2. Collect context before implementation

Read the repository's `AGENTS.md`/`CLAUDE.md`, the target and context files,
nearby implementations, relevant tests, and the applicable test commands.
Summarize constraints, interfaces, data flow, conventions, and edge cases.
Do not make an external backend rediscover context that the primary model can
verify locally.

### 3. Implement one item at a time

Work in dependency order. For behavior changes, write the smallest
non-tautological test at the public seam and run it RED before the minimal
implementation. Inspect the diff after each item, then run the scoped test and
static checks before continuing. Preserve unrelated dirty work.

### 4. Confirm, retry, and review

For each item, classify the result as accepted, rejected, or modified. A
rejected or modified item may be retried at most twice with the failure and
current diff supplied as context; after that, stop with a blocker. Run the
designated independent review after the implementation batch, address findings
within the same scope, and re-run the affected checks.

### 5. Final verification and report

Run the focused tests, applicable full suite, validators, freshness checks, and
diff inspection required by the request. Report actual commands and results,
changed files, skipped checks with reasons, remaining risks, and the next gate.
If an optional second opinion was not requested or could not run, state that
the result is primary-model-only and degraded; do not call it independent.

## Verification checklist

- [ ] Items are decomposed and ordered by dependency.
- [ ] Context and edge cases were checked before edits.
- [ ] Behavior tests use independent expected values at a public seam.
- [ ] RED, minimal GREEN, scoped suite, static checks, and review are recorded.
- [ ] Retry count is bounded and blockers are explicit.
- [ ] Optional backends and second opinions were opt-in only.
