---
name: dhpk-execution-policy
description: 'Default workflow for software engineering tasks: task modes (small change, bug fix, new feature, architecture change), skill priority order, mandatory post-edit review steps (sentinel-driven), anti-loop guidance, and standard output shape. Triggers: how should I approach this, what is the workflow, do I need a plan, what reviews are required, I am stuck in a loop, what to do after editing. Use this skill at task kickoff to pick the right flow, and after edits to confirm review obligations.'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
---

# DHPK Execution Policy

Default: execute directly, plan sparingly. Every code change ends with `[dr*]` + `code-reviewer` **dispatched in parallel** (code-reviewer merges/dedups). `dr*` = database-reviewer (SQL) / security-reviewer (auth/crypto/money).

Agent names above are the plugin defaults; projects override via `userConfig.review_agents`.

## When NOT to Use

- Classifying a substantial change into a workflow with required artifacts + gates → use `adaptive-dev-workflow`.
- A root-cause investigation is already underway → use `bug-investigation`.
- Pure code understanding / tracing with no workflow decision → use `code-explore` (or `code-investigate` for a dual-perspective pass).
- Mid-execution of a specific skill's workflow → follow that skill's own steps, not this policy.

## Task modes

| Task | Flow |
|------|------|
| Small change | inspect → patch |
| Small bug (known cause) | inspect → tdd-guide RED → patch → tdd-guide verify |
| Medium change | inspect → brief plan → tdd-guide → patch |
| Bug (unknown cause) | bug-investigation skill → tdd-guide → patch |
| New feature | tdd-guide → patch |
| Architecture change | architect → tdd-guide → patch |

`[OpenSpec?]` defaults to inline brief plan; use `/opsx:new` only when the user explicitly requests a spec-driven change.

## Skill priority order

1. `/opsx:*` when explicitly invoked
2. `bug-investigation` — triggers: investigate / trace / why / root cause
3. `tdd-guide` — feature/bugfix needing tests (pre-edit)
4. `architect` — cross-module design
5. `/review-pending` — user-invoked; triggers `code-reviewer` on pending sentinel
6. Project-local skills win over same-name plugin skills; skip workflow skills for small direct edits.

## Mandatory post-edit steps

### Hook-enforced (sentinel-driven)

The `post-edit-remind` hook writes sentinels per matching reviewer slot:

| Sentinel | Agent (default name) |
|---|---|
| `.pending-review` | `code-reviewer` (always last) |
| `.pending-db-review` | `database-reviewer` |
| `.pending-security-review` | `security-reviewer` |

The `stop-review-reminder` Stop hook blocks the turn if any sentinel is unanswered. Each agent's Closing hook clears its matching sentinel via `clear-sentinel.sh`.

Skipped paths by default: `.claude/artifacts/**`, files outside the code-extension whitelist. See `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/post-edit-remind.sh` for the exact list.

### AI-judgment (self-trigger when hook misses)

- New feature/bug fix in business-logic code → `tdd-guide` before writing implementation (TDD).
- Money/crypto/cert/token paths not matched by hook patterns → `security-reviewer` after Edit.
- High-volume DB methods → `performance-analyzer` after Edit.

`tdd-guide` is pre-edit. After edits, triggered reviewers (`database-reviewer` / `security-reviewer` / `code-reviewer` / …) **dispatch in parallel**; `code-reviewer` merges/dedups.

Sole exemption: pure research/planning (no Edit/Write) skips all review agents.

## Anti-loop

Same failure 3× → STOP. Report:

1. What was tried + the error
2. ≥2 alternative approaches
3. Recommended next step

Do NOT keep retrying the same command with minor variations.

## Output shape (standard reply)

```
Conclusion → Changed files → Verification → Risks/Open questions
```

When blocked:

```
Blocker → Tried → Next viable option
```

## Git pipeline

`feat|fix|docs|refactor/*` → integration branch → main. Standard flow: feature branch → `/codex-review-fast` → `/precommit` → `/pr-review` → PR. Claude does NOT auto `git add / commit / push / stash` — invoke `/smart-commit` or `/precommit` explicitly.

Squash-merge hygiene: see `references/squash-merge-hygiene.md`.

## Verification: self-check before each reply

0. Editing an existing symbol → did `gitnexus_impact` run? (Append-only edits exempt; state so in plan/commit.)
1. Source-code or `.claude/`-markdown Edit/Write → did code-reviewer run (or is sentinel still pending)?
2. Bug/feature → did tdd-guide run?
3. SQL → did database-reviewer run?
4. Auth/crypto/money → did security-reviewer run?
5. Repository method on high-volume table → did performance-analyzer run?

Any applicable NO → run it before replying.

## References

- `references/task-modes.md` — detailed task-mode examples; read when unsure which flow a change fits.
- `references/anti-loop.md` — the 3x rule and what counts as the same approach; read when a retry loop is suspected.
- `references/output-shape.md` — full reply-shape and tone guidance; read when formatting a summary or a blocked reply.
- `references/squash-merge-hygiene.md` — spotting unrelated changes after a squash merge; read before reviewing a squash-merged branch.
