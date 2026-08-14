# Anti-Rationalization Patterns

Self-talk stop-loss reference for the rationalization phrasings that precede skipping a mandatory reviewer / TDD / sentinel step. Not always-on; referenced from `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Anti-rationalization" section.

> **Load when**: feeling hesitant about skipping any one of reviewer / TDD / sentinel mandatory steps; self-reference before acting.

## Why list them out

Reviewing common judgment biases that resurface across sessions, each one is accompanied by **a single line of self-persuasion**. This file collects the common phrasings as a self-talk stop-loss reference table.

The most dangerous moment for a rationalization phrase is the instant it **genuinely feels reasonable**; consulting this table can yank that system-1 impulse back into system-2 thinking.

---

## Common phrasings → counter-arguments

| Self-persuasion phrasing | Counter-argument / fact to return to |
|---|---|
| "This change is small, no reviewer needed" | The sentinel system is **designed for the cumulative risk of small changes**, not large-change-only. Three-line changes have historically tripped CSRF / SQL injection / silent truncation traps. |
| "Sentinel auto-reaps, just commit first" | The reap script's 24h threshold is a **safety net**, not a rationalisation for skipping the reviewer. Reap firing means "the previous review was missed" — it's a trap, not a feature. |
| "Bug is obvious, skip tdd-guide and just fix" | "Obvious" is **the single largest source of known bias**. RED test forces the symptom into a reproducible failure, which is the only guarantee that you fix the root cause and not just the symptom. Historical record: bug fixes that skip RED have an average regression rate > 30%. |
| "Append-only exemption should apply here" | Definition: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` Glossary. It applies only to pure additions — any line entering an existing method body, parameter reorder, or docblock edit means it does NOT apply. Before invoking it, first check the diff is actually 100% inside "new file / new method appended to end". |
| "Commit first, write tests after" | The TDD workflow is **RED → GREEN → REFACTOR**, not `GREEN → commit → RED`. Tests written after the implementation naturally hug the implementation, not the requirement — and cannot detect "what was fixed wrong". Once committed, the psychological priority of writing those follow-up tests drops, every time. |
| "This is unique to us, we need custom logic" | Library/service evaluation is the **prerequisite, not the conclusion**. Before building custom, answer: (1) what existing library did you rule out and why? (2) would its edge cases matter? (3) is custom actually simpler than integrate + maintain? Can't answer all → premature. Existing solutions ship battle-hardened edge cases. |
| "I'll add logging / telemetry after it works" | "After" reliably becomes **"after the first incident"** — the most expensive moment to discover you're blind. Instrument as you build, the same way you test as you build; a feature that ships without telemetry turns its first prod bug into archaeology instead of a query. |
| "console.log is fine / more logs = more observability" | Unstructured output **cannot be filtered, correlated, or alerted on**, and volume is not signal — three queryable structured events beat three hundred prose lines. A stable event name + fields + a correlation ID costs five minutes once; reconstructing an incident from orphan log lines costs hours. |
| "We'll document / version the API later" | The types **are** the contract, and Hyrum's Law guarantees every observable behaviour (including undocumented quirks) becomes a dependency once anyone relies on it. Design for extension now — additive, optional fields; retrofitting a version scheme after consumers depend on the shape is a breaking change, not a later chore. |
| "I'm confident, skip the doubt step" | Confidence **correlates poorly with correctness on novel problems** — the moment of certainty is exactly when a blind spot hides. A bounded fresh-context doubt pass (ARTIFACT + CONTRACT, never your conclusion) is cheap now; debugging the wrong direction after commit is not. See `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "In-flight doubt cycle". |
| "The fresh reviewer disagreed, so I was wrong / so it's noise" | A fresh reviewer **lacks your context** — disagreement is information, not a verdict. Re-read the artifact against the finding and classify it (contract-misread / actionable / trade-off / noise); rubber-stamping the reviewer is the same failure as ignoring it. Zero actionable findings across 2+ substantive cycles = doubt theatre → escalate. |
| "We'll remove the dead / zombie code later" | Code is a **liability, not an asset** — unreachable code misleads every future reader, surfaces in every grep and impact analysis, and quietly rots. Remove it in the same change that orphaned it (your own mess); for anything with consumers, ship the migration path first, then delete. |

---

## When to load

Per any of the situations below, **proactively load this file** (don't wait for a hook prompt):

| Signal | Counter-action |
|---|---|
| Task mode classified "Small change" but diff exceeds 30 lines | Load this file → re-evaluate whether small mode still applies |
| Wanting to skip any sentinel-driven reviewer | Load this file → consult the table for the counter-argument; if no counter is available, the reviewer MUST run |
| Wanting to invoke the append-only exemption (Glossary, `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`) | Load row 4 of the table → enforce the "100% pure addition" check |
| Wanting to claim completion via "verify skill passed" without a corresponding test diff | Load this file → completion claims must accompany a verifiable artifact |
| Three consecutive entries in your project's judgment-retrospective notes (`memory/skill-retrospective.md` or equivalent) flag the same type of bias | Load this file + the matching `memory/feedback_*.md` (or equivalent project notes) |
| About to ship a production feature (endpoint / background job / external call) with no new telemetry | Load this file → "add logging after" row — instrument before shipping, not after the incident |
| About to commit or deploy a non-trivial / irreversible decision (branching logic, boundary crossing, migration, public API change) | Load this file → run the in-flight doubt cycle (`${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`) before it stands |

---

## Not in scope

- **Does not replace** TDD workflow specifications (your TDD discipline doc — e.g. testing.md in your common rules + framework-specific testing.md). This file only lists "rationalisation phrasings when skipping it" — it does not restate the TDD process itself.
- **Does not replace** the reviewer dispatch model (see `## Cross-references` below). This file only lists "rationalisation phrasings when skipping a reviewer".
- **Not language-specific** — applies across PHP / JS / shell / Python / etc. Pure self-dialogue layer.

---

## Cross-references

- `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` — reviewer dispatch + Self-check SSOT
- Project's own judgment-retrospective notes (memory entries / docs that record historical rationalisations → consequences → corrections)
