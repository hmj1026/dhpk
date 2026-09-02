---
name: dhpk-doc-review
description: "Portable document review using the current model. Purpose: review .md docs, audit a tech spec, or check document quality. Not for: code review (use dhpk-change-review), test review (use dhpk-test-review). Output: 5-dimension rating table + gate."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Document Review Skill

## When NOT to Use

- Code review (use `dhpk-change-review`)
- Test coverage review (use `dhpk-test-review`)
- Just want to read a document (use Read directly)

## Commands

| Command             | Description            | Use Case          |
| ------------------- | ---------------------- | ----------------- |
| `/codex-review-doc` | Review .md docs | Document changes  |
| `/review-spec`      | Review tech spec       | Spec confirmation |
| `/doc-refactor`     | Streamline documents   | Doc too long      |
| `/update-docs`      | Research & update docs | After code change |

## Workflow: `/codex-review-doc`

```
Determine target → Read content → Primary review (5 dimensions) → Rating table + Gate → Loop if Needs revision
```

### Step 1: Determine Target File

| Condition | Action |
|-----------|--------|
| Path specified | Use that path directly |
| No path | Auto-detect: git modified `.md` → staged `.md` → new `.md` |
| Multiple files | List and ask user which to review |

### Step 2: Read File Content

Read target file, save as `FILE_CONTENT`.

### Step 3: Primary Review

Run the document review with the current model using the prompt in
`references/codex-prompt-doc.md`. The primary path is complete without an
external opinion. A caller may explicitly opt into `codex exec` as an additive,
clearly labeled second opinion; it must never be an implicit requirement or
silent fallback.

Keep the document snapshot and selected target explicit so a later round can be
reproduced with the same input.

**Save the review artifact identifier and pinned input state.** No stateful
external thread is assumed.

**Loop review**: reread the explicit document snapshot and prior review
artifact with `references/review-loop-doc.md`; do not assume stateful thread
continuity.

### Step 4: Consolidate Output

Organize results into rating table + severity-grouped findings + gate. When no
optional second opinion runs, state that the result is primary-model only and
degraded; do not claim independent verification.

## Review Dimensions

| Dimension           | Checks |
| ------------------- | ------ |
| Architecture Design | System boundaries, responsibilities, dependencies, extensibility |
| Performance         | Bottlenecks, concurrency, caching, resource usage |
| Security            | Data leakage, access control, input validation, error handling |
| Documentation Quality | Structure, completeness, accuracy, examples, docs-writing standards |
| Code Consistency    | Pseudocode matches codebase, referenced files exist, technical accuracy |

## Output

Return the five-dimension rating table, severity-ranked findings with
file:line evidence, actionable corrections, and an explicit Mergeable or
Needs revision gate. Preserve the review artifact and input snapshot when
another review round is required.

## Review Loop

Auto-loop semantics: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Anti-loop & output.

⛔ Needs revision → fix 🔴 items → `/codex-review-doc --continue <review-artifact>` → repeat until ✅ Mergeable.

Max 3 rounds. Still failing → report blocker.

## Verification

- [ ] Each issue tagged with severity (🔴/🟡/⚪)
- [ ] Gate is clear (✅ Mergeable / ⛔ Needs revision)
- [ ] The primary reviewer verified code-documentation consistency; label any
      optional independent second opinion separately

## Required Actions

| Change Type | Must Execute                          |
| ----------- | ------------------------------------- |
| `.md` docs  | `/codex-review-doc` or `/review-spec` |
| Tech spec   | `/review-spec`                        |
| README      | `/codex-review-doc`                   |

## References

- Doc review prompt: `references/codex-prompt-doc.md`
- Review loop: `references/review-loop-doc.md`

## Examples

```
Input: /codex-review-doc docs/features/xxx/tech-spec.md
Action: Read file → primary document review → Rating table + Findings + Gate

Input: /codex-review-doc
Action: Auto-detect changed .md → primary document review → Rating table + Gate

Input: Review this tech spec for me
Action: /review-spec → Check completeness/feasibility/risks → Output Gate

Input: This document is too long, streamline it
Action: /doc-refactor → Tabularize + Mermaid → Output comparison
```
