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

## When NOT to Use

- Trivial one-line edits or pure typo fixes.
- Pure research / planning turns with no Edit/Write.
- Replies that touched no source, harness, or doc files — there is nothing to gate.

## Usage

- **Not every reply needs this** — small change / pure research → skip.
- **Load it at wrap-up** — after the final Edit/Write, before emitting the
  Conclusion, before `smart-commit`.
- **Honour the reviewer dispatch model** — sentinels already trigger their reviewer
  via hooks; this skill backstops the AI-judgment calls the hook system
  cannot see.

---

## Per-reply (always check when the turn included Edit/Write)

Four boxes must clear:

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
4. **Edit-before-Read enforced** — every file_path that was Edit/Write'd
   this turn has been Read in **this session** first. Mass refactor
   (same string across N files) MUST Read each file independently.
   Successive Edits on the same file with linter / parallel-edit risk
   in between: re-Read first. Matching error messages:
   `File has not been read yet` / `File has been modified since read`.

### Mass refactor preference order (avoid N-deep Edit failure chains)

When mechanically replacing across multiple files, **pick the tool
before reaching for Edit**:

- Same string, across many files, mechanical replace (e.g. `array()` → `[]`)
  → **first choice**: `Bash sed -i` or a formatter rule
  (e.g. `php-cs-fixer fix --rules='{array_syntax:{syntax:short}}'`,
  `prettier --write`, `ruff format`).
- Same file, multiple places, needs semantic context preserved →
  `Edit replace_all: true` + Read the file **once** first.
- Across files but each spot has different semantic context → only then
  fall back to multiple Edits (**Read each file independently**).

> Anti-pattern: chain N Edits across N files without Read → 100%
> failure rate × N, wasting tokens and reviewer trigger cost.

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
| Controller / HTTP-entry-point edits | Security-reviewer and code-reviewer both dispatch (in parallel per reviewer dispatch); code-reviewer merges the findings. |
| Edits to a shared `_lib/` hook helper | Run contract tests for ALL hooks that source the helper (e.g. `_lib/js-tier-detect.sh` is consumed by both `post-edit-js-lint.sh` and `pre-commit-js-validation.sh` — verify both still pass). |
| Bash uses bare glob expansion (`ls .pending-*` / `for f in .pending-*`) in a shell **without** `nullglob` (zsh default, dash, BusyBox) | Switch to `find <dir> -maxdepth N -name '<pattern>' -print 2>/dev/null` or append `2>/dev/null \|\| true`. Bare glob with zero matches becomes a literal token in those shells, then often errors as "no such file". Common in sentinel-existence checks. |
| Hand-constructing `clear-sentinel.sh` path | Use the dhpk SSOT: `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh` (NOT `${CLAUDE_PROJECT_DIR}/.claude/scripts/...`). Reviewer agent bodies shipped in dhpk already use the correct path — compare against them before constructing your own. |

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

## Reviewer dispatch (quick reference)

Triage out false positives → dispatch the surviving reviewers **in parallel**
(one message, multiple Agent calls) → `code-reviewer` merges / dedups:

```
{ database-reviewer | security-reviewer | frontend-reviewer | code-reviewer | doc-reviewer }   ← parallel
```

- code-reviewer and doc-reviewer are **not mutually exclusive** — a mixed
  diff dispatches both.
- Any reviewer returning CRITICAL blocks the merge/commit; `code-reviewer`
  dedups overlapping findings across the parallel results.
- Pure research / planning (no Edit/Write) skips all reviewers.

The slot-to-agent mapping is `review_agents` userConfig (7-slot default
since v0.10.0; see `agents/INDEX.md`). Re-order or substitute agents per
project via that knob.

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

---

## Output

This skill produces no artifact of its own — it shapes the **wrap-up reply**.
At wrap-up the reply MUST follow:

`Conclusion → Changed files → Verification → Risks / Open questions`

When blocked, switch to: `Blocker → Tried → Next viable option`. Any
self-accountable reviewer skip is recorded inline (with its reason) in the
Verification section.

## Verification

- [ ] Per-reply four boxes cleared (TDD pre-run, final gate, output structure, Edit-before-Read).
- [ ] Every conditional trigger that fired has its required check run, or a recorded skip reason.
- [ ] Surviving reviewers dispatched in parallel; any CRITICAL resolved before commit.
- [ ] Task-end book-keeping considered (MEMORY.md / retrospective / backlog tickets).
