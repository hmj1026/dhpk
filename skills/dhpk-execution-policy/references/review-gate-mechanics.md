# Review-gate mechanics — operational detail

Operational detail for `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Mandatory post-steps. The always-loaded SSOT there keeps the Post-implementation agent gate, the sentinel table (7-slot default), the reviewer-dispatch skeleton (triage → parallel → merge), the Review output gate, and the AI-judgment back-stop **trigger list**. This file carries the how/why the orchestrator needs **when wiring or clearing sentinels, or self-triggering a back-stop reviewer**. Every "§X" below refers to a section of that SSOT file.

## Sentinel clear contract (hook-owned, fail-loud)

Reviewer sentinel clearance is owned by the runtime hook `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/subagent-stop-verify.sh`: it clears only its matching reviewer's slot (a `frontend-reviewer` can clear `.pending-frontend-review`, never `.pending-review`) after a fresh canonical `<agent>-YYYYMMDD-HHMMSS-<slug>.md` artifact with valid leading delimited frontmatter containing `agent`, `generated_at`, `commit`, `scope`, `severity_summary`, and `verdict`, and only when that verdict is `APPROVE` or `PASS`. A missing, stale, misplaced, noncanonical, malformed, warning, failing, or unparseable artifact leaves the sentinel armed. This is the **sanctioned** path — reviewer agent definitions carry NO closing `clear-sentinel.sh` step (the auto-mode permission classifier blocks a reviewer clearing its own review gate as "Logging/Audit Tampering"). `clear-sentinel.sh <name> <label>` remains the tool the **orchestrator** invokes directly — for a triage-drop or the stale-sentinel back-stop below — and it stays fail-loud: a known name clears the file and records success; an unknown name — or an empty/unresolvable name from a stale or partial payload — exits 2 with an explicit stderr message naming the problem, rather than silently no-op'ing. When a manual clear exits non-zero the orchestrator MUST surface that failure (a review gate remains open) — it must not report a clean "review complete."

### Misplaced review-file observability

The native stop hook applies the dispatch's freshness and ownership boundary to
review files written outside the canonical `artifacts/reviews/` directory.
`pre-agent-liveness-mark.sh` records the dispatch baseline, session, attempt, and
dispatch identifier (when present) in `.review-dispatch-attempts`. On reviewer
stop, `subagent-stop-verify.sh` ignores stale or foreign candidates, chooses the
newest qualified file with a relative-path tie-breaker, and keeps the sentinel
armed when the only evidence is misplaced. Fresh misplaced evidence is reported
with a relative path; stale or foreign evidence is reduced to a no-fresh-doc
diagnostic without an absolute host path. A fresh file without provenance is
accepted only for the current stop session and is labelled
`current-unknown-session`.

<!-- SSOT for the ${CLAUDE_PLUGIN_ROOT} interpolation-token caveat — rules/execution-policy.md and skills/dhpk-execution-checklist/SKILL.md point here. -->
`${CLAUDE_PLUGIN_ROOT}` is a markdown-interpolation token, not a shell variable: the orchestrator resolves it when reading this document, and it is unset inside a subagent's Bash environment. A subagent must never paste the literal `${CLAUDE_PLUGIN_ROOT}/...` into a Bash command — use the absolute path the orchestrator supplies, or, when `stop-review-reminder.sh` has printed an already-resolved command (stale sentinels only — that branch is gated on sentinel age), the command it printed. On a 127 / "No such file or directory" failure, escalate to the orchestrator for the resolved path; never recover by scanning the filesystem with `find / -iname`.

## Resumed reviewer reconcile contract

Both `subagent-stop-verify.sh`'s native auto-clear and the `stop-review-reconcile.sh` background-dispatch sweep (issue #76/#77) key on evidence tied to the CURRENT dispatch — a fresh review artifact, or a lingering active-liveness marker proving this session dispatched the reviewer. A reviewer **resumed** through `SendMessage` breaks both: it is not a fresh dispatch (no new sentinel arm), and its active marker may already have been removed by the ORIGINAL dispatch's `SubagentStop` before the resume ever happened — so neither existing mechanism reaches it, and the sentinel can stay armed after a genuinely conclusive resumed result (issue #92).

The fallback is a third, explicit, session-scoped contract, never inferred from the resumed message alone:

1. **Record before resuming**: `bash scripts/hooks/record-resumed-obligation.sh <sentinel-name> [label]` — captures this session's identity (`CLAUDE_CODE_SESSION_ID`), the resolved agent, and an **artifact baseline** (the latest matching canonical review doc, if any, BEFORE the resume) into the `.resumed-review-obligations` JSONL sidecar. The record binds the generated slot, exact sentinel basename, resolved agent identity, origin session, dispatch/resume ID, resume timestamp, artifact baseline, attempt, and state. One active record per (sentinel, session); a repeated resume for the same slot updates the existing record's `attempt` rather than creating a second one. This is lifecycle state, not a new reviewer sentinel slot or active marker.
2. **Reconcile after a final result**: `bash scripts/hooks/reconcile-resumed-review.sh <sentinel-name> [label]` — clears the sentinel through the same `clear-sentinel.sh` SSOT ONLY when a fresh canonical review doc now postdates BOTH the sentinel AND the recorded baseline (proving a NEW review doc was written during the resume, not that the baseline doc merely still exists). An intermediate reply, a missing/stale/misplaced/foreign doc, or a doc identical to the baseline leaves the sentinel and obligation armed (exit 1) — message finality is never trusted on its own. A final response must contain actual review work, findings or an explicit no-findings statement, and a parseable verdict from the reviewer's existing vocabulary.
3. **Stop-time safety net**: `stop-review-reminder.sh` also runs `dhpk_resumed_reconcile_sweep` (sourced from `_lib/resumed-review-obligation.sh`, invoked from `_lib/stop-review-reconcile.sh`) every Stop cycle, so a resumed obligation the orchestrator forgot to reconcile explicitly still clears once its fresh doc lands. Until then, the reminder reports the slot as `[WARN] RESUMED: <agent>` and explicitly recommends waiting for the resumed result — never a duplicate dispatch.
4. **Ownership fails closed**: reconcile only ever matches a record whose `session_id` equals the caller's — a foreign or concurrent session's obligation, or a foreign-slot artifact, never satisfies this session's sentinel. This is orchestrator-only: it must not delete a shared sentinel belonging to a foreign or ambiguous session when session/provenance, slot, agent, dispatch, or configuration identity cannot be proven.
5. **Lifecycle clearance is never approval**: like the native path, resumed reconciliation requires fresh canonical review evidence with leading delimited frontmatter, all required reviewer fields, and a parseable passing `APPROVE` or `PASS` verdict before it clears a sentinel. A malformed, unparseable, warning, BLOCK, FAIL, or nonzero severity result remains armed and unresolved; message text never substitutes for qualifying evidence.
6. **Idempotent with the native path**: if `subagent-stop-verify.sh` (or an earlier reconcile call) already cleared the sentinel, both the explicit script and the Stop sweep consume the now-orphaned obligation silently — no error, no double-clear. Native `SubagentStop` remains first choice; native and fallback paths use the same whitelist, ownership checks, and `clear-sentinel.sh` SSOT.
7. **Retry ceiling**: while the resumed agent remains addressable, the orchestrator may issue one corrected resume but must not dispatch a duplicate; a second failure becomes a replacement-reviewer decision or an explicit human blocker. Existing stale/orphan triage remains a human non-approval action only.

## Orchestrator-side confirm the clear actually happened (Closing-hook back-stop)

Clearance is hook-owned: `subagent-stop-verify.sh` clears only the matching reviewer's slot after a fresh canonical review artifact has valid leading delimited frontmatter, all required fields, and an `APPROVE` or `PASS` verdict. A warning, failure, malformed or unparseable artifact, a noncanonical path, or no fresh artifact leaves the sentinel armed. This is the sanctioned path; reviewers never self-clear. If a native `SubagentStop` payload is missing or a background review did not produce that event, the orchestrator must use the documented session-scoped reconcile or fail-loud manual back-stop, never treat a reviewer message alone as clearance.

For a sentinel with an outstanding resumed-review obligation, this broad manual
back-stop is overridden: use the artifact-backed resumed reconcile contract
(§Resumed reviewer reconcile contract above) and do not manually clear without
a conclusive result plus fresh canonical artifact. The stale/orphan command
remains an explicit human triage action only and never represents approval;
its reason must be recorded.

## Skipped paths (sentinel table)

`.claude/artifacts/**` is exempt from ALL 7 slots via an unconditional early hook exit that runs before any slot logic (self-edits by review agents would otherwise re-trigger themselves). For doc-review specifically, a `.md` file is skipped UNLESS it is under `.claude/{agents,rules,commands,hooks,scripts,skills,manifests}/`, `openspec/`, or `docs/`, or is named `CLAUDE.md` / `AGENTS.md` (any depth), or is a top-level `README*.md` (nested READMEs excluded) — so `.claude/{memory,worktrees}/**` and any other `.md` file outside that list is skipped for doc-review. This does NOT exempt `.claude/{memory,worktrees}/**` from every slot: the hook's generic extension/keyword defaults (code-reviewer on `*.php`/`*.js`/etc., db-reviewer on `*.sql`, security-reviewer on `*Auth*`/`*Login*`/etc.) match on filename alone with no path restriction, so e.g. a `.php` file under `.claude/worktrees/` (a real git-worktree-checkout location) still routes normally. See your hook source for the exact list.

## Reviewer dispatch — full triage → parallel → merge

At the end of a turn that produced Edits/Writes, gather ALL pending sentinels, then **triage → dispatch in parallel → merge**:

`stop-review-reminder.sh` expresses each surviving slot as one merged dispatch covering its complete pending-file list. For an unchanged pending set, the third reminder states that two reminders were ignored and requires dispatch before further implementation. Fresh sentinels never advertise manual clearing; after the shared 60-minute stale threshold, the command may appear only as a stale-debt triage-drop.

1. **Triage first (cheap, no agent).** Look at the diff scope and DROP false-positive sentinels before dispatching — a pure-style CSS tweak, a single-string / comment-only / whitespace-reflow change does not warrant a full reviewer (e.g. a 2-line CSS change must not pull in `security-reviewer`); a typo-fix or pure-formatting `.md` change does not warrant `doc-reviewer` (it fires for substantive policy/SSOT changes, not cosmetics), and pure OpenSpec bookkeeping — ticking `tasks.md` checkboxes — is the canonical batch/drop case (make the checkbox edits together and let `doc-reviewer` run once on the substantive artifacts, not once per checkbox). Clear each dropped sentinel with `clear-sentinel.sh <name> <label>` and a one-line reason (a triage-drop is an orchestrator action — no reviewer runs, so there is no auto-clear to rely on). Triage only **drops**; when in doubt, keep the reviewer.
2. **Dispatch the surviving reviewers IN PARALLEL** — one message, multiple Agent calls. Each reviewer audits only its own concern and is independent, so wall-clock is `max(reviewers)`, not the sum. Do **not** run them as a sequential chain.
3. **`code-reviewer` is the merge/dedup owner.** When it is in the dispatched set, `code-reviewer` (or the orchestrator on collecting the parallel results) merges all findings and removes cross-reviewer duplicates — this replaces the old "sequential order de-dups" mechanism. Each specialist still owns its lane (code-reviewer does not re-run OWASP / SQL / link-checks; frontend-reviewer does not re-run SQL; doc-reviewer does not audit code quality).

The counter-example this consolidation prevents is a six-dispatch goal-session tail: 2 code-review rounds + 1 database-review round + 2 doc-review rounds + 1 `dhpk-codex-bridge` round. Those concerns belong in one parallel batch per implementation wave; a second round requires new substantive scope or explicit escalation, and `dhpk-codex-bridge` is escalation-only, at most once per change.

- Each reviewer **only handles its own sentinel**: missing sentinel → skip; present (and not triaged out) → it MUST run (back-stop excepted).
- **Batched per turn, not per edit**: a turn with N Edits runs each reviewer at most once, after the last edit — never once per Edit. This extends across a **review round**: when responding to a set of already-flagged findings (Codex findings, reviewer-flagged issues, a `design.md` append recording one) with a series of small fixes, apply all of that round's known-finding-mapped small fixes first and dispatch the re-review ONCE for the batch — never edit→re-review→edit→re-review serially, one finding-fix at a time. A genuinely new finding discovered mid-batch still gets its own cycle.
- **CRITICAL handling under parallel dispatch**: collect every parallel verdict, then if any reviewer returns CRITICAL → surface it and block the merge/commit. (Parallel means all reviewers run regardless of another's CRITICAL — independent concerns are not short-circuited.)
- `code-reviewer` and `doc-reviewer` **are not mutually exclusive**: mixed diffs (PHP + .sh + plain `.claude/` policy doc) dispatch both. Single-type diffs dispatch only the matching one.
- Pure research / planning (no Edit/Write) skips all reviewer agents.

## Reduced-tier dispatch for known-finding-mapped tiny deltas

A delta of roughly **≤3 net changed lines** that maps 1:1 to a finding **already flagged in the current review round** (not new or uninspected work) MAY be dispatched to the required reviewer at a *reduced* tier — e.g. `haiku` — via the same `model` param the §Model tier rule uses to *escalate* a HIGH-risk dispatch, here reused symmetrically for a LOW-risk case, instead of the reviewer's frontmatter-default tier. Guards: never for a **security/db-sensitive file** or a **CRITICAL-severity** target finding (those stay at the default tier), and this lowers the gate's *cost*, not the gate itself — the reviewer dispatch still runs. SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Model tier.

## Reviewer liveness — a no-op return is a failed gate

A reviewer that *ran* but did no work is a distinct failure from a reviewer that never fired. When a dispatched reviewer returns with `tool_uses=0` (no `Read`/`Grep`/`Bash`), or a body that only echoes an injected `<system-reminder>` / agent roster rather than a findings-plus-verdict report, the gate is **FAILED, not satisfied** — the orchestrator must not mark the review complete or accept a cleared sentinel. Re-dispatch exactly once with a corrected prompt. If that retry is still empty, use a replacement reviewer or leave a pending gate with a recorded reason; never perform a third identical retry. A real review — `Read`/`Grep` performed, a findings list plus an explicit gate verdict returned — is evaluated on its verdict as usual. SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §Reviewer dispatch.

## File-state ground truth — re-verify a file-state defect live before reporting it

Before concluding a file was reverted, a regression exists, or the working tree is broken/inconsistent, re-verify live — `git status --porcelain` + a direct `Read` of the target file's current content — rather than treating a single injected file-snapshot (e.g. a `<system-reminder>` capturing a mid-operation, mid-branch-switch working tree) as proof. Such a snapshot can transiently show a stale or reverted-looking state that is not a real defect; the live re-check is the tie-breaker. A live-confirmed defect is still reported — the check confirms genuine defects, it does not suppress them. SSOT: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` (File-state ground truth paragraph, §Agent dispatch).

## AI-judgment back-stop — explanatory notes

> **Why view-layer script doesn't go through the hook**: `post-edit-dispatch.sh` uses path-pattern matching (O(1)). Detecting `<script>` blocks would require reading the full PHP file content on every Edit (grep cost asymmetric to the edit cost). Per the trigger taxonomy, view templates don't all contain `<script>`; AI looking at the diff has near-zero recognition cost, so back-stop is sufficient.
>
> **When to upgrade to hook**: once a project accumulates ≥3 missed-review cases (feature shipped to prod), or view-layer JS bug ratio significantly exceeds the JS-file leaf ratio, then add path+content grep to the hook. Until then, AI judgment.
>
> **`tdd-guide` has no sentinel.** `.pending-tdd` is never written by any hook (tdd-guide is pre-edit, not post-edit), so it is reached only via the back-stop list or an explicit pre-implementation invocation — it is **not** auto-enforced by the `dhpk-opsx-apply-goal` universal `ls .pending-*` gate. For unattended `dhpk-opsx-apply-goal` runs, new-code testing is enforced as an *outcome* by the **coverage gate** when the project has a coverage threshold configured (see `skills/dhpk-opsx-apply-goal/references/detection.md` `HAS_COVERAGE`); where no threshold exists, tests-first must be carried by the change's tasks/plan (authored via `dhpk-feature-dev`), not assumed from the sentinel gate.
