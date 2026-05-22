---
name: execution-checklist
description: End-of-task self-check before wrapping up. Use when a major task is about to wrap — final Edit/Write done, ready to reply with Conclusion, or commit incoming — especially after writing a feature/bugfix, touching SQL or repository code, changing auth/crypto/money/file-upload paths, modifying repository methods on a high-volume table, or editing JS/TS source or template-embedded `<script>` blocks. Not for trivial one-line edits, pure research/planning (no Edit/Write), or pure typo fixes.
---

# Execution checklist

Three-section self-check at task wrap-up. Per-reply mandatory, conditional
when triggers fire, task-end book-keeping.

> Source: the project's execution policy (typically
> `.claude/rules/execution-policy.md`). This skill carries the long-form
> checklist so the policy rule itself stays index-sized.

## Usage

- **Not every reply needs this** — small change / pure research → skip.
- **Load it at wrap-up** — after the final Edit/Write, before emitting the
  Conclusion, before `smart-commit`.
- **Honour the chain rule** — sentinels already trigger their reviewer
  via hooks; this skill backstops the AI-judgment calls the hook system
  cannot see.

---

## Per-reply (always check when the turn included Edit/Write)

Three boxes must clear:

1. **TDD pre-run** — Bug fix / feature that touches business logic: did
   `tdd-guide` (or the configured first agent in `review_agents`) run in
   the RED phase, writing the failing test first? Skip for pure docs /
   harness / hook edits.
2. **Final gate ran** — After the Edit/Write, the matching reviewer slot
   (code / db / sec / frontend / doc per `review_agents`) either ran, or
   has an explicit "self-accountable skip" reason recorded (e.g. all
   sentinels clean already, session-local agent dispatch unavailable,
   pure review-feedback fixup).
3. **Output structure complete** —
   `Conclusion → Changed files → Verification → Risks/Open questions`.
   When blocked: `Blocker → Tried → Next viable option`.

---

## Conditional (only when the trigger fires)

| Trigger | Required check |
|---|---|
| Modifying an existing symbol's body / signature / docblock | `gitnexus_impact({ target, direction:"upstream" })` ran. Pure additions can use the **append-only exemption** (record `append-only — gitnexus_impact skipped` in the plan / commit). |
| New / modified SQL, repository, or migration code | The database-reviewer slot (sentinel `.pending-db-review`) cleared, or a self-accountable skip is recorded. |
| Auth / crypto / money / file-upload code paths | The security-reviewer slot (sentinel `.pending-security-review`) cleared, or a self-accountable skip is recorded. |
| Repository methods on a high-volume table (the project's hottest tables — typical examples: an event log, an orders / sales table, an inventory table) | `performance-analyzer` (no hook, AI-judgment trigger) ran or skipped with reason. |
| `*.{js,ts,jsx,tsx,vue,svelte}` edit or template-embedded `<script>` change | The frontend-reviewer slot (sentinel `.pending-frontend-review`) cleared, or backfill ran when the hook missed (template-embedded scripts cannot be detected by file-extension hooks — AI judgment must backfill). |
| Pure `.claude/{agents,rules,commands,skills,manifests}/**/*.md` edit | The doc-reviewer slot (sentinel `.pending-doc-review`) cleared. Code-reviewer is not required for pure-doc edits; mixed diffs run both. |
| Controller / HTTP-entry-point edits | Security-reviewer chain runs before code-reviewer (per chain rule). |
| Edits to a shared `_lib/` hook helper | Run contract tests for ALL hooks that source the helper (e.g. `_lib/js-tier-detect.sh` is consumed by both `post-edit-js-lint.sh` and `pre-commit-js-validation.sh` — verify both still pass). |

---

## Task-end (book-keeping at the very end)

- **Newly discovered trap** → does the project's `MEMORY.md` need an
  entry? Trap-knowledge is freshest right after the bug; capture it now
  before the next session.
- **Retrospective entry** → if the project tracks a
  `skill-retrospective.md`, append one entry. Refresh aggregate stats
  every ~5 entries.
- **Backlog open items** → any `Risks / Open questions` item that should
  become a `/create-request` ticket?

---

## Chain rule (quick reference)

```
database-reviewer → security-reviewer → frontend-reviewer → code-reviewer → doc-reviewer
```

- code-reviewer and doc-reviewer are **not mutually exclusive** — a mixed
  diff runs both.
- `security-reviewer` CRITICAL findings block the chain; downstream
  reviewers don't repeat them.
- Pure research / planning (no Edit/Write) skips the entire chain.

The slot-to-agent mapping is `review_agents` userConfig (default 5 in
v0.2.0+). Re-order or substitute agents per project via that knob.

---

## Append-only exemption (restated)

A pure-addition change (no existing symbol body / signature / docblock
modified) may skip `gitnexus_impact`, but the plan / commit message MUST
record the exemption explicitly:

```
gitnexus_impact: skipped — append-only (new file / new method, no existing symbol modified)
```

If the change modifies an existing method signature / class hierarchy /
interface contract, the exemption does not apply — run impact analysis.
