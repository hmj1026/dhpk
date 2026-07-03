---
name: dhpk-execution-policy
description: 'Default workflow for software engineering tasks: task modes (bug fix known/unknown root cause, feature delivery normal/cross-module, medium change, lightweight maintenance) with OpenSpec ask-behavior per the SSOT table, skill priority order, mandatory post-edit review steps (sentinel-driven), anti-loop guidance, and standard output shape. Triggers: how should I approach this, what is the workflow, do I need a plan, what reviews are required, I am stuck in a loop, what to do after editing. Use this skill at task kickoff to pick the right flow, and after edits to confirm review obligations.'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
---

# DHPK Execution Policy

Skill-form entry point into `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`, dhpk's canonical execution policy. Default: execute directly, plan sparingly. Every code change ends with the sentinel-driven reviewer dispatch defined there (task modes, agent dispatch table, sentinel table). This skill adds skill-routing guidance and points to that file rather than restating it — restated copies drift.

## When NOT to Use

- Classifying a substantial change into a workflow with required artifacts + gates → use `adaptive-dev-workflow`.
- A root-cause investigation is already underway → use `bug-investigation`.
- Pure code understanding / tracing with no workflow decision → use `code-explore` (or `code-investigate` for a dual-perspective pass).
- Mid-execution of a specific skill's workflow → follow that skill's own steps, not this policy.

## Task modes

See `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Change classification & OpenSpec routing (SSOT)" table.

## Skill priority order

1. `/opsx:*` when explicitly invoked
2. `bug-investigation` — triggers: investigate / trace / why / root cause
3. `tdd-guide` — feature/bugfix needing tests (pre-edit)
4. `architect` — cross-module design
5. `/review-pending` — user-invoked; triggers `code-reviewer` on pending sentinel
6. Project-local skills win over same-name plugin skills; skip workflow skills for small direct edits.

## Mandatory post-edit steps

See `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Mandatory post-steps" for the sentinel table (7-slot default), the reviewer dispatch model (triage → parallel → merge), and the AI-judgment back-stop list.

## Anti-loop

Same failure 3× → STOP. Full policy: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Anti-loop & output". Worked examples: `references/anti-loop.md`.

## Output shape (standard reply)

`Conclusion → Changed files → Verification → Risks/Open questions`. When blocked: `Blocker → Tried → Next viable option`. Full guidance: `references/output-shape.md`.

## Git pipeline

`feat|fix|docs|refactor/*` → integration branch → main. Full policy: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Git pipeline". Squash-merge hygiene: `references/squash-merge-hygiene.md`.

## Self-check before each reply

Load the `execution-checklist` skill for the full self-audit.

## References

- `references/task-modes.md` — detailed task-mode examples; read when unsure which flow a change fits.
- `references/anti-loop.md` — the 3x rule and what counts as the same approach; read when a retry loop is suspected.
- `references/output-shape.md` — full reply-shape and tone guidance; read when formatting a summary or a blocked reply.
- `references/squash-merge-hygiene.md` — spotting unrelated changes after a squash merge; read before reviewing a squash-merged branch.
