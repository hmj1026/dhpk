# dhpk suite usage advice log

Append-only retrospective log of dhpk suite usage. Each session appends a dated
`## Session …` section with two tables: **(A)** errors observed + optimization
suggestions, and **(B)** subagent-dispatch adequacy (was work dispatched
reasonably, or under-/over-dispatched — especially during a `/goal` run).

> Companion to the consumer-side `zdpos-217/claude/dhpk_advice.md` retrospectives.
> Findings here are about dhpk used **on its own source tree** (plugin-dev mode).

---

## Session 2026-07-07 — `dhpk-advice-fe13512c-fixes` implementation (`dhpk:do → opsx-apply-goal → /goal`, CODEX=on)

Unattended `/goal` run: opsx:apply of a 20-task OpenSpec change (12 findings F1–F13, F7 excluded) touching 7 harness files. Completed green (20/20 `[x]`, sentinels NONE, tests 13/13 + validate-harness PASS-with-warnings).

### A. Errors observed + optimization suggestions

| # | Type | What happened (evidence) | Impact | Suggested fix |
|---|------|--------------------------|--------|---------------|
| A1 | **error — reviewer no-op** | `dhpk:doc-reviewer` (Haiku) misfired **2× consecutively** on the task-4.4 gate — each run returned an injected system-reminder / agent-roster echo as its final message with **`tool_uses: 0`** (never Read a file). | doc-review gate unsatisfiable by the designated agent; **~93.5k tokens** burned on 2 no-op runs; had to substitute `code-reviewer`. | In `opsx-apply-goal` / execution-policy: treat a reviewer returning `tool_uses=0` (no Read/Grep) as a **FAILED gate → auto-fallback** to `code-reviewer`, not a silent pass. Also harden the Haiku `doc-reviewer` body against echoing injected `<system-reminder>` content instead of acting. |
| A2 | **error — tooling/locale** | Verification greps containing BRE `$` + the multibyte `§` (`${CLAUDE_PLUGIN_ROOT}/…§Implementation dispatch`) returned **0 matches for a present string** under `zh_TW.UTF-8`. Hit Worker 5 first, then the orchestrator. | False alarm that the F1 edit hadn't applied; wasted a verification cycle each time; `grep -F` needed to confirm. | fast-worker/skill verification-command guidance: emit greps over `$`/`§`/CJK/multibyte content as **`grep -F`** (fixed-string), never BRE. |
| A3 | **gap — sentinel coverage in plugin-source mode** | Editing dhpk's **own** repo-root `agents/ rules/ skills/ agent-traps/` `.md` armed **no** doc-review sentinel — the trigger matches only `.claude/{…}/`, `openspec/`, `docs/`. All 6 substantive edits armed nothing; only the `openspec/…/tasks.md` checkbox edit armed one. | The review gate for dhpk's **own** harness files is AI-judgment-only, not hook-enforced — easy to skip review when developing the plugin itself. | Add a **plugin-dev hook profile** (or extend the doc-review trigger) to match repo-root `agents|rules|skills|commands|agent-traps/**/*.md` when the repo *is* the plugin source. |
| A4 | process slip | Orchestrator planned "5 parallel fast-workers" but launched 4, then Worker 5 (`SKILL.md`) separately after noticing. | None (caught + corrected); minor plan↔exec drift. | Emit the full parallel dispatch batch in **one** message when planned as parallel. |
| A5 | **self-violation of shipped rule** | While waiting for `code-reviewer`, the orchestrator ran `grep` against the **running agent's output JSONL** and a `sleep`-based wait loop — the F5 "no block-poll a running worker" anti-pattern it had **just shipped this session**. | Minor (caught + stopped; no transcript entered context), but ironic. | Rely on completion notifications only; never touch a running agent's `output_file`. Consider a lint/hook that flags reads of `tasks/*.output` paths. |
| A6 | friction — gate wording | `validate-harness.sh` **exits 2 on warnings** ("PASS (with warnings)"), ambiguous against the completion gate's "green / 0 failures". Needed a `git stash -u` baseline to prove the 4 warnings pre-existing (identical on clean HEAD). | Extra verification round to prove change-neutrality. | Completion-gate wording (and `opsx-apply-goal` Part 3) should treat **PASS-with-warnings + proven-pre-existing** as green; or `validate-harness.sh` should exit 0 when only warnings remain. |

### B. Subagent dispatch adequacy — `codex-bridge` / `fast-worker` / `deep-reasoner` during the `/goal` run

| Agent | Dispatches | Verdict | Detail |
|-------|:---:|---|--------|
| **fast-worker** | 5× | ✅ **appropriate** | Grouped by **disjoint file** (deep-reasoner.md · e2e-runner.md+playwright.md · execution-policy.md · implementation-dispatch.md · SKILL.md), run in parallel, each with a verification command + edited-file list. Correct per the ">2-file footprint → dispatch, not salami-sliced inline" rule. **Efficiency nuance:** ~144k subagent tokens for ~57-insertion doc edits — in an unattended run where wall-clock isn't the constraint, **1 sequential fast-worker over the disjoint files** (one context load) can beat 5 parallel dispatches (each re-loads context) on token cost. Heuristic worth adding: *parallel for latency, single-batch for token economy when latency is slack.* |
| **deep-reasoner** | 0× | ⚠️ **defensible, but tier unused** | No genuinely reasoning-heavy task (all were clear-spec OpenSpec-delta edits). Two candidates settled **inline**: (a) task-1.5 scan-vs-defer scoping — settled by reading `post-edit-remind.sh`; **correct** per the policy's "don't deep-reasoner a Read-settleable static premise" rule. (b) the F10/F11 `SKILL.md` template design (`<CODEX_STATEMENT>` substitution + `--codex` convention) — low-complexity design synthesis, defensibly inline. Not a clear under-dispatch, but the one genuine **design decision** (deferring a spec'd requirement, 1.5) shipped without an independent reasoning check. |
| **codex-bridge** | 0× | ❌ **UNDER-dispatched (headline)** | **CODEX=on was declared but zero Codex paths fired all session.** Two root causes below. This is the clearest gap: the highest-stakes artifact — `skills/opsx-apply-goal/SKILL.md`, the **generator of every future unattended goal** — was edited on inline-designed decisions, and one (leaving CODEX-clause exec-policy paths **bare** "to match spec prose") was **wrong**, caught only by the single-model `code-reviewer`. |
| e2e-runner *(bonus)* | 0× | ⚠️ under-dispatched | The `playwright.md` trap sheet **asserts runtime/browser behavior** (`boundingBox()` shape, iframe offset, click auto-scroll) from docs/memory — the very "verify a runtime premise with an executable probe" pattern **this change shipped (F10/F3)**. Claims were in fact correct (code-reviewer confirmed), but a scratch Playwright probe would have been the rigorous path. Ironic self-referential miss. |

**Headline finding — why `codex-bridge` stayed unused despite `CODEX=on`:**

1. **Session-level:** editing the goal-template generator is exactly the "high-stakes implement-phase design decision" that `rules/execution-policy.md` §`CODEX=on high-stakes parallel peer path` exists for. A parallel `codex-bridge` independent review of that `SKILL.md` edit (blind to code-reviewer) was warranted and skipped — the cross-model peer might have flagged the bare-path inconsistency independently.
2. **Template-level (deeper):** the **F11 wiring just shipped** makes the emitted `/goal` invoke cross-model doubt **only** "at a contradiction-arbitration point where two agents' conclusions directly conflict." No two agents conflicted → codex never fired. But **high-stakes _solo_ design edits** (goal-template generator, an SSOT policy file, deferring a spec'd requirement) never trip that trigger. So the goal-template's CODEX wiring is **narrower** than execution-policy's CODEX=on capability (which also covers *proactive* high-stakes peer review), and `codex-bridge` structurally stays idle in exactly the sessions that edit a high-stakes artifact without an inter-agent conflict.

**Suggested fix (feeds a future OpenSpec change):** `opsx-apply-goal` Part 0's CODEX=on statement should **also** wire the proactive path, not just contradiction-arbitration — e.g. *"under CODEX=on, before finalizing a high-stakes solo design edit (goal-template generator, SSOT policy file, deferral of a spec'd requirement), run a parallel `codex-bridge` independent review per §CODEX=on high-stakes parallel peer path."* This converts a declared-but-idle capability into one that actually fires on the session's riskiest edits.

**Net dispatch grade:** fast-worker well-used; deep-reasoner defensibly idle; **codex-bridge under-used (declared, never fired)**; e2e-runner under-used for its own trap-sheet claims.
