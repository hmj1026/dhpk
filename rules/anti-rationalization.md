# Anti-Rationalization Patterns

> **Load when**: feeling hesitant about skipping any one of reviewer / TDD / sentinel mandatory steps; self-reference before acting.
>
> Not always-on; referenced from `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Anti-rationalization" section.

## Why list them out

Reviewing common judgment biases that resurface across sessions, each one is accompanied by **a single line of self-persuasion**. This file collects the common phrasings as a self-talk stop-loss reference table.

The most dangerous moment for a rationalization phrase is the instant it **genuinely feels reasonable**; consulting this table can yank that system-1 impulse back into system-2 thinking.

---

## 5 common phrasings → counter-arguments

| Self-persuasion phrasing | Counter-argument / fact to return to |
|---|---|
| "This change is small, no reviewer needed" | The sentinel system is **designed for the cumulative risk of small changes**, not large-change-only. Three-line changes have historically tripped CSRF / SQL injection / silent truncation traps. |
| "Sentinel auto-reaps, just commit first" | The reap script's 24h threshold is a **safety net**, not a rationalisation for skipping the reviewer. Reap firing means "the previous review was missed" — it's a trap, not a feature. |
| "Bug is obvious, skip tdd-guide and just fix" | "Obvious" is **the single largest source of known bias**. RED test forces the symptom into a reproducible failure, which is the only guarantee that you fix the root cause and not just the symptom. Historical record: bug fixes that skip RED have an average regression rate > 30%. |
| "Append-only exemption should apply here" | The execution-policy §0 exemption **only applies to pure additions (not modifying existing symbol body / signature / docblock)**. Any line entering an existing method body, parameter reorder, or docblock edit — exemption does NOT apply. When invoking §0, first check the diff is actually 100% inside "new file / new method appended to end". |
| "Commit first, write tests after" | The TDD workflow is **RED → GREEN → REFACTOR**, not `GREEN → commit → RED`. Tests written after the implementation naturally hug the implementation, not the requirement — and cannot detect "what was fixed wrong". Once committed, the psychological priority of writing those follow-up tests drops, every time. |

---

## When to load

Per any of the situations below, **proactively load this file** (don't wait for a hook prompt):

| Signal | Counter-action |
|---|---|
| Task mode classified "Small change" but diff exceeds 30 lines | Load this file → re-evaluate whether small mode still applies |
| Wanting to skip any sentinel-driven reviewer | Load this file → consult the table for the counter-argument; if no counter is available, the reviewer MUST run |
| Wanting to invoke execution-policy §0 append-only exemption | Load row 4 of the table → enforce the "100% pure addition" check |
| Wanting to claim completion via "verify skill passed" without a corresponding test diff | Load this file → completion claims must accompany a verifiable artifact |
| Three consecutive entries in your project's judgment-retrospective notes (`memory/skill-retrospective.md` or equivalent) flag the same type of bias | Load this file + the matching `memory/feedback_*.md` (or equivalent project notes) |

---

## Not in scope

- **Does not replace** TDD workflow specifications (your TDD discipline doc — e.g. testing.md in your common rules + framework-specific testing.md). This file only lists "rationalisation phrasings when skipping it" — it does not restate the TDD process itself.
- **Does not replace** sentinel chain rule (`execution-policy.md` "Mandatory post-steps"). This file only lists "rationalisation phrasings when skipping a reviewer".
- **Not language-specific** — applies across PHP / JS / shell / Python / etc. Pure self-dialogue layer.

---

## Cross-references

- `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` — sentinel chain rule + Self-check SSOT
- Project's own judgment-retrospective notes (memory entries / docs that record historical rationalisations → consequences → corrections)
