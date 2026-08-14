# harness-sentinel-integrity Specification

## Purpose
TBD - created by archiving change dhpk-harness-integrity-guards. Update Purpose after archive.
## Requirements
### Requirement: Sentinel-slot arrays stay aligned under static test

A regression test SHALL assert that the four lockstep sentinel arrays in
`scripts/hooks/_lib/payload.sh` (`SENTINEL_NAMES`, `SENTINEL_LABELS`, `SENTINEL_SHORT_NAMES`,
and the default agents array) all have equal length. The test SHALL run inside
`node tests/run-all.js` and fail the suite when the arrays diverge.

#### Scenario: A slot is added to only one array

- **WHEN** an entry is added to `SENTINEL_NAMES` but not to `SENTINEL_LABELS`
- **THEN** `node tests/run-all.js` fails with a sentinel array-length mismatch

### Requirement: No residue from a removed sentinel slot

A regression test SHALL assert that no token belonging to a removed slot (for example `art` or
`artifact`) appears as a slot identifier anywhere under `scripts/hooks/`. Removing a slot is not
complete until this test passes.

#### Scenario: A removed slot leaves a dead token

- **WHEN** a slot is removed from `payload.sh` but a `\|art` reference remains in a hook script
- **THEN** the sentinel-integrity test fails, naming the file and dead token

### Requirement: Every hook sentinel literal is a known slot

A regression test SHALL assert that every `.pending-*` sentinel filename literal used under
`scripts/hooks/` is a member of `SENTINEL_NAMES`. A hook may not write or read a sentinel that
is not declared in the SSOT.

#### Scenario: A hook references an undeclared sentinel

- **WHEN** a hook writes `.pending-artifact-review` while `SENTINEL_NAMES` no longer contains it
- **THEN** the sentinel-integrity test fails, naming the offending literal

### Requirement: No live orphan sentinel files are committed

The repository SHALL NOT contain a `.pending-*` sentinel file whose slot is not declared in
`SENTINEL_NAMES`.

#### Scenario: An orphan sentinel is left in the tree

- **WHEN** `.claude/artifacts/sessions/.pending-artifact-review` exists but `artifact` is not a declared slot
- **THEN** the file is treated as residue and removed before the change is considered done

### Requirement: SubagentStop auto-clear covers code, database, and doc reviewer payload variants
`subagent-stop-verify.sh` SHALL preserve its generic configured reviewer-slot mapping, including frontend-reviewer. Before changing that mapping, implementation SHALL reproduce the observed failure using the real identity field/namespace, artifact filename and freshness boundary, and installed-plugin version. Only an evidenced missing payload/artifact variant or packaging drift SHALL be changed and regression-tested. A successful stop with a fresh matching artifact SHALL clear only that reviewer's sentinel even when its verdict is unparseable; unresolved-verdict and subagent-quality enforcement SHALL continue to surface the malformed verdict.

#### Scenario: Code reviewer auto-clears its sentinel
- **WHEN** `.pending-review` is armed and a successful SubagentStop payload identifies `code-reviewer`
- **THEN** `subagent-stop-verify.sh` clears `.pending-review` and does not clear other reviewer sentinels

#### Scenario: Database reviewer auto-clears its sentinel
- **WHEN** `.pending-db-review` is armed and a successful SubagentStop payload identifies `database-reviewer`
- **THEN** `subagent-stop-verify.sh` clears `.pending-db-review` and does not clear other reviewer sentinels

#### Scenario: Doc reviewer auto-clears its sentinel
- **WHEN** `.pending-doc-review` is armed and a successful SubagentStop payload identifies `doc-reviewer`
- **THEN** `subagent-stop-verify.sh` clears `.pending-doc-review` and does not clear other reviewer sentinels

#### Scenario: Frontend reviewer auto-clears its sentinel
- **WHEN** `.pending-frontend-review` is armed and a successful SubagentStop payload identifies `frontend-reviewer` with a fresh `reviews/frontend-reviewer-*` artifact
- **THEN** `subagent-stop-verify.sh` clears `.pending-frontend-review` and does not clear other reviewer sentinels

#### Scenario: Fresh frontend artifact with an unparseable verdict preserves liveness
- **WHEN** a successful frontend-reviewer stop has a fresh matching artifact whose verdict cannot be parsed
- **THEN** `.pending-frontend-review` auto-clears, while unresolved-verdict or subagent-quality evidence records that the verdict contract remains unsatisfied

#### Scenario: Existing generic mapping is changed only after reproduction
- **WHEN** the observed consumer failure is evaluated against the current generic slot map
- **THEN** the implementation records the failing payload/artifact/version fixture and changes only the demonstrated missing variant rather than adding a duplicate frontend slot

#### Scenario: Alternate payload field is supported
- **WHEN** the reproduction fixture identifies an unsupported alternate identity field such as `.subagent` or `.tool_input.subagent_type` as the actual failure cause
- **THEN** `subagent-stop-verify.sh` adds that evidenced field and applies the same scoped auto-clear behavior, without changing unrelated payload handling

#### Scenario: Installed-version drift requires no source hook change
- **WHEN** the reproduction proves the installed consumer version predates the already-correct generic frontend mapping
- **THEN** the change records the fixture, adds packaging/version regression coverage, and validates the release path without duplicating the frontend slot or altering hook behavior

### Requirement: Failed or unidentified reviewer stops never clear sentinels
`subagent-stop-verify.sh` SHALL leave sentinels armed when the reviewer stop reports failure or when the payload does not identify a known reviewer. The hook MAY log the failure, but it SHALL NOT report a clean review gate.

#### Scenario: Failed reviewer keeps sentinel armed
- **WHEN** a SubagentStop payload identifies `database-reviewer` with a non-zero exit status while `.pending-db-review` is armed
- **THEN** `.pending-db-review` remains armed for a later review attempt

#### Scenario: Unknown reviewer keeps sentinel armed
- **WHEN** a SubagentStop payload lacks a known reviewer identity while `.pending-review` is armed
- **THEN** `.pending-review` remains armed and no auto-clear is reported

### Requirement: Stop reminder includes exact clear command and in-flight status
`stop-review-reminder.sh` SHALL continue to print the exact sentinel basename required by `clear-sentinel.sh`, and when in-flight reviewer state is observable it SHALL include that state in the reminder. This preserves the exact-basename contract while reducing duplicate reviewer dispatches.

#### Scenario: Exact basename is shown
- **WHEN** `.pending-db-review` is present at Stop time
- **THEN** the reminder includes a manual clear command using `.pending-db-review`, not a short keyword such as `db` or `review`

#### Scenario: In-flight status is shown when observable
- **WHEN** `.pending-doc-review` is present and a matching `doc-reviewer` task is observably still running
- **THEN** the reminder labels the review as in flight rather than only saying it is awaiting review

### Requirement: Reviewer dispatch is tracked by a per-type in-flight liveness marker
A PreToolUse hook on the `Task|Agent` matcher SHALL record, for every dispatch that identifies a known reviewer `subagent_type`, an in-flight liveness marker distinct from the `.pending-*` review sentinels, stored in `.claude/artifacts/sessions/` alongside the sentinels (e.g. `.active-review` for `code-reviewer`). The marker SHALL support more than one concurrent dispatch of the same reviewer type without one dispatch's completion prematurely clearing another still-running dispatch of that type.

#### Scenario: Dispatch appends a liveness marker entry
- **WHEN** a `Task`/`Agent` PreToolUse call identifies a known reviewer subagent_type (e.g. `code-reviewer`)
- **THEN** the hook appends one timestamped entry to that reviewer's `.active-*` marker file, leaving other reviewer types' markers untouched

#### Scenario: Non-reviewer dispatch is a no-op
- **WHEN** a `Task`/`Agent` PreToolUse call identifies a subagent_type that is not one of the known reviewer slots (e.g. `fast-worker`, `deep-reasoner`)
- **THEN** the hook performs no file write and exits immediately

#### Scenario: Two concurrent same-type dispatches are tracked independently
- **WHEN** two `code-reviewer` dispatches are in flight at the same time
- **THEN** the marker file carries two entries, and the first dispatch's SubagentStop removes only one entry, leaving the marker present (still in flight) until the second dispatch also stops

### Requirement: SubagentStop clears the liveness marker regardless of exit status
`subagent-stop-verify.sh` SHALL remove exactly one in-flight liveness marker entry for the stopping reviewer's slot whenever the SubagentStop payload identifies a known reviewer, independent of exit status — liveness reflects "is a dispatch of this type still running", not review success. This is independent of, and SHALL NOT change, the existing sentinel auto-clear behavior, which remains gated on exit status.

#### Scenario: Failed reviewer still clears its liveness marker
- **WHEN** a `database-reviewer` SubagentStop reports a non-zero exit status and `.active-db-review` has one entry
- **THEN** the hook removes that entry while `.pending-db-review` remains armed per the existing failure-path requirement

#### Scenario: Successful reviewer clears its liveness marker
- **WHEN** a `code-reviewer` SubagentStop reports success and `.active-review` has one entry
- **THEN** the hook removes that entry in addition to the existing sentinel auto-clear behavior

### Requirement: Liveness markers are reaped on their own, shorter staleness threshold
`reap-stale-sentinels.sh` SHALL sweep `.active-*` liveness markers on every invocation using a materially shorter default threshold than the `.pending-*` 24h default, trimming only individually stale entries by their own per-entry timestamp — never the whole marker file — so a stuck orphaned entry is not masked by a newer legitimate entry in the same file.

#### Scenario: Orphaned marker entry is reaped without a SubagentStop event
- **WHEN** a reviewer subagent crashes or the session ends without SubagentStop ever firing, leaving a `.active-*` entry older than the liveness threshold
- **THEN** `reap-stale-sentinels.sh` removes that entry (and the file if now empty) and reports it reaped, so `stop-review-reminder.sh` stops reporting it as in flight

#### Scenario: A fresh entry is not masked by reaping a stale one in the same file
- **WHEN** `.active-review` carries one stale entry and one fresh entry
- **THEN** reaping removes only the stale entry, leaving the fresh entry (and the file) intact

### Requirement: A reviewer's most recent artifact verdict is checked before treating a successful stop as clean
When `subagent-stop-verify.sh` auto-clears (or observes already-cleared) a reviewer's sentinel on a successful stop, it SHALL additionally inspect the most recently modified `.claude/artifacts/reviews/<agent>-*.md` artifact for that reviewer and record a line in `.claude/artifacts/sessions/.unresolved-verdict`, scoped per reviewer slot, when either the frontmatter `verdict:` is `BLOCK` or `FAIL`, or the frontmatter `severity_summary` has a nonzero `critical`, `high`, or `medium` count — the latter closes the gap where a MEDIUM-severity Repository/query-layering hard-rule finding (actionable per the `implementation-dispatch` Repository Discovery Gate requirement) would otherwise still verdict as `APPROVE`/`PASS` under the contract's own severity mapping and slip past this check. A subsequent clean verdict (no BLOCK/FAIL and zero critical/high/medium) for the same slot SHALL remove the prior record. Absence of a fresh artifact file SHALL NOT be treated as a clean verdict — the check SHALL degrade silently with no write. This mechanical check is intentionally coarse: it cannot distinguish a Repository-layering MEDIUM finding from an unrelated MEDIUM finding by the same reviewer, so it over-triggers relative to the narrow gate it backstops — that is the accepted trade-off over silently under-enforcing a real hard-rule violation.

#### Scenario: BLOCK/FAIL verdict is recorded
- **WHEN** a `database-reviewer` stops successfully and its most recent artifact frontmatter reads `verdict: FAIL`
- **THEN** `subagent-stop-verify.sh` writes a line for the db slot in `.unresolved-verdict`, in addition to the existing sentinel auto-clear

#### Scenario: A MEDIUM-only finding is recorded even when the verdict is clean
- **WHEN** a `database-reviewer` stops successfully and its most recent artifact frontmatter reads `verdict: PASS` but `severity_summary: { critical: 0, high: 0, medium: 1, low: 0 }`
- **THEN** `subagent-stop-verify.sh` writes a line for the db slot in `.unresolved-verdict`, because a nonzero `medium` count still requires human review of the Repository Discovery Gate finding

#### Scenario: A clean re-review clears the record
- **WHEN** a subsequent `database-reviewer` stop's artifact reads `verdict: PASS` with `severity_summary: { critical: 0, high: 0, medium: 0, low: 0 }`
- **THEN** the prior `.unresolved-verdict` line for the db slot is removed and no new line is added

#### Scenario: Missing artifact degrades silently
- **WHEN** no `.claude/artifacts/reviews/database-reviewer-*.md` artifact exists for this stop
- **THEN** `.unresolved-verdict` is left unchanged and no error is raised

### Requirement: Orchestration state dotfiles do not arm the doc-review sentinel

The post-edit sentinel hook (`scripts/hooks/post-edit-remind.sh`) SHALL NOT arm
`.pending-doc-review` for an edit whose target is a leading-dot `.md` file under `openspec/` — the
orchestration state-files an unattended `opsx-apply-goal` session writes as part of its own
bookkeeping (e.g. `openspec/changes/<id>/.resume-note.md`,
`openspec/changes/<id>/.hard-rule-escalation.md`). These are session state, not auditable spec
artifacts, so a doc-review is never owed for them. Non-dotfile `openspec/**/*.md` (proposal, design,
tasks, specs) continue to arm doc-review unchanged.

#### Scenario: Writing a resume-note does not arm doc-review

- **WHEN** the hook processes an edit to `openspec/changes/<id>/.resume-note.md`
- **THEN** `.pending-doc-review` is not armed for that edit

#### Scenario: A real spec artifact still arms doc-review

- **WHEN** the hook processes a prose edit to `openspec/changes/<id>/proposal.md`
- **THEN** `.pending-doc-review` is armed as before (no regression)

### Requirement: A checkbox-only tasks.md edit does not arm the doc-review sentinel

The post-edit sentinel hook (`scripts/hooks/post-edit-remind.sh`) SHALL NOT arm `.pending-doc-review` when the only net change in an edit to a `tasks.md` file is checkbox flips (`- [ ]` ↔ `- [x]`) — the orchestrator's own progress bookkeeping. A `tasks.md` edit that changes prose, adds or removes tasks, or otherwise alters non-checkbox content continues to arm doc-review as before.

#### Scenario: Flipping a task checkbox does not arm doc-review

- **WHEN** the hook processes a `tasks.md` edit whose only net change is `- [ ]` → `- [x]` on one or
  more lines
- **THEN** `.pending-doc-review` is not armed for that edit

#### Scenario: A prose change to tasks.md still arms doc-review

- **WHEN** the hook processes a `tasks.md` edit that changes task text or adds a new task line
  (beyond a bare checkbox flip)
- **THEN** `.pending-doc-review` is armed as before

### Requirement: Hook auto-clear is the sanctioned reviewer sentinel-clear path

All configured sentinel-backed reviewer definitions SHALL NOT instruct the reviewer subagent to invoke `clear-sentinel.sh` as a closing step — the auto-mode classifier blocks a reviewer clearing its own review gate as "Logging/Audit Tampering", and the runtime already owns clearance. `subagent-stop-verify.sh` SHALL clear the stopping reviewer's sentinel on a successful stop with a fresh matching artifact. When a reviewer was resumed through `SendMessage` and no matching `SubagentStop` event occurs, the orchestrator SHALL use the artifact-backed resumed-review reconcile path with the exact known sentinel basename and matching obligation; this is the sanctioned fallback for that lifecycle, not a reviewer self-clear. Native auto-clear and resumed reconcile SHALL share the generated sentinel whitelist, freshness boundary, session ownership checks, and `.unresolved-verdict` refresh. Clearance SHALL remain separate from approval: BLOCK/FAIL, malformed verdicts, or actionable severity continues to block completion.

#### Scenario: Reviewer closes without touching its sentinel
- **WHEN** a doc-reviewer completes its review, writes its artifact, and stops successfully
- **THEN** the reviewer itself makes no `clear-sentinel.sh` call, `subagent-stop-verify.sh` clears `.pending-doc-review`, and no failure entry or AUTO-CLEARED warning is logged

#### Scenario: Resumed reviewer uses the sanctioned fallback
- **WHEN** a reviewer resumed through `SendMessage` returns a conclusive verdict and a fresh canonical artifact exists but `SubagentStop` did not fire
- **THEN** the orchestrator invokes the resumed-review reconcile path for the exact `.pending-*` basename and the reviewer does not clear its own sentinel

#### Scenario: Reconcile without a fresh artifact does not clear
- **WHEN** a resumed reviewer returns without a fresh canonical review artifact
- **THEN** the sentinel remains armed and the missing-artifact condition is visible to the liveness gate

#### Scenario: BLOCK remains unresolved after lifecycle clearance
- **WHEN** a resumed reviewer artifact has `verdict: BLOCK` or `verdict: FAIL`, or actionable critical/high/medium findings
- **THEN** the sentinel/review obligation may be reconciled, but `.unresolved-verdict` remains and the completion gate stays unsatisfied

#### Scenario: Classifier block path no longer exists
- **WHEN** any configured sentinel-driven reviewer runs under the auto-mode permission classifier
- **THEN** no tool call from that reviewer attempts to clear a review sentinel, so the "Logging/Audit Tampering" block cannot fire on the review flow

#### Scenario: Foreign or ambiguous ownership remains armed
- **WHEN** a resumed obligation has no matching session/provenance identity, has a foreign provenance row, or the configured reviewer identity has drifted
- **THEN** the reconcile path fails closed, leaves the sentinel and obligation armed, and reports the ownership blocker without deleting a shared sentinel
