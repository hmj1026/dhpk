# subagent-verdict-quality Specification

## Purpose
TBD - created by archiving change consolidate-hooks-delegation-verdicts. Update Purpose after archive.
## Requirements
### Requirement: SubagentStop quality gate is default-off and controlled by a userConfig key
`scripts/hooks/subagent-stop-quality.sh` SHALL be wired on the `SubagentStop` matcher but SHALL be a no-op (immediate exit 0, no heuristic evaluation) unless the `userConfig.subagent_quality_gate` key is explicitly set to an enabling value. The default value of `subagent_quality_gate` SHALL be off.

#### Scenario: Gate is inert when userConfig key is unset
- **WHEN** `userConfig.subagent_quality_gate` is unset or at its default value
- **THEN** `subagent-stop-quality.sh` exits 0 without evaluating any thin-report heuristic

#### Scenario: Gate evaluates heuristics when explicitly enabled
- **WHEN** `userConfig.subagent_quality_gate` is explicitly set to an enabling value
- **THEN** `subagent-stop-quality.sh` evaluates its thin-report heuristics against the stopping subagent's report

### Requirement: Thin-report heuristics block-and-continue exactly once per result
When enabled, `subagent-stop-quality.sh` SHALL evaluate the stopping subagent's final report against the following heuristics: (a) the report is under 120 characters; (b) the report is a bare approval such as `lgtm`/`ok`/`done` with no supporting content; (c) the report mentions an unresolved error with no next-step or recommendation language; (d) the report is a review-shaped task's output containing no file, symbol, or command reference (evidence-free). When any heuristic matches, the hook SHALL return `{"decision":"block"}` with a continue instruction, and SHALL do so exactly once per distinct result — deduplicated by a scope key composed of session, subagent, and report-hash, using a state file under `.claude/artifacts/sessions/`. The hook SHALL honor `stop_hook_active`/`subagent_stop_hook_active` to avoid re-blocking its own continuation loop.

#### Scenario: Under-120-character report is blocked
- **WHEN** the gate is enabled and a subagent's final report is under 120 characters
- **THEN** `subagent-stop-quality.sh` returns a `block` decision with a continue instruction

#### Scenario: Bare approval report is blocked
- **WHEN** the gate is enabled and a subagent's final report consists only of a bare `lgtm`/`ok`/`done`-style approval with no supporting detail
- **THEN** `subagent-stop-quality.sh` returns a `block` decision with a continue instruction

#### Scenario: Unresolved error without next-step language is blocked
- **WHEN** the gate is enabled and a subagent's final report mentions an error it did not resolve, with no next-step or recommendation language
- **THEN** `subagent-stop-quality.sh` returns a `block` decision with a continue instruction

#### Scenario: Evidence-free review report is blocked
- **WHEN** the gate is enabled and a review-shaped task's final report contains no file, symbol, or command reference
- **THEN** `subagent-stop-quality.sh` returns a `block` decision with a continue instruction

#### Scenario: Same result is not blocked twice
- **WHEN** a thin report has already triggered one block-and-continue for a given session/subagent/report-hash scope key
- **THEN** a repeat evaluation of the same scope key does not block again

#### Scenario: stop_hook_active prevents a re-block loop
- **WHEN** the SubagentStop payload indicates `stop_hook_active`/`subagent_stop_hook_active` is true for the current continuation
- **THEN** `subagent-stop-quality.sh` does not issue another block for that same continuation

### Requirement: Quality gate is wired ahead of the sentinel auto-clear hook
In `hooks/hooks.json`, `subagent-stop-quality.sh` SHALL be ordered before `subagent-stop-verify.sh` in the `SubagentStop` hooks array, so that when the quality gate blocks a stop, the auto-clear logic in `subagent-stop-verify.sh` does not run against that stop and cannot clear a reviewer's sentinel on a thin or no-op report.

#### Scenario: A blocked reviewer stop does not reach auto-clear
- **WHEN** the gate is enabled and a reviewer's stop is blocked by `subagent-stop-quality.sh`'s heuristics
- **THEN** `subagent-stop-verify.sh`'s auto-clear logic does not run for that stop and the reviewer's sentinel remains armed

#### Scenario: A passing stop proceeds to auto-clear as before
- **WHEN** the gate is enabled and a reviewer's stop does not match any thin-report heuristic
- **THEN** `subagent-stop-quality.sh` allows the stop to proceed and `subagent-stop-verify.sh`'s existing auto-clear behavior applies unchanged

### Requirement: Report text extraction is layered and records hit/miss for the default-on flip decision
`subagent-stop-quality.sh` SHALL extract the subagent's final report text using a layered strategy: first the SubagentStop payload's text field(s), then a fallback to reading the tail of the transcript at `transcript_path`, and if neither yields usable text, a silent `exit 0` with no heuristic evaluation and no block. Each invocation SHALL record whether extraction hit (text was obtained) or missed (fell through to silent exit) to a counter file, to support a documented data-driven decision to flip `subagent_quality_gate`'s default from off to on once extraction hit rate exceeds 95% over at least 20 dispatches.

#### Scenario: Payload text field yields the report
- **WHEN** the SubagentStop payload includes a usable text field for the final report
- **THEN** `subagent-stop-quality.sh` uses that field directly and records an extraction hit

#### Scenario: Transcript tail fallback yields the report
- **WHEN** the SubagentStop payload's text field(s) are absent or unusable but `transcript_path` is present
- **THEN** `subagent-stop-quality.sh` falls back to reading the transcript tail, and if that yields usable text, records an extraction hit and proceeds to evaluate heuristics

#### Scenario: Neither source yields text
- **WHEN** neither the payload text field(s) nor the transcript tail yield usable report text
- **THEN** `subagent-stop-quality.sh` records an extraction miss and exits 0 without blocking

### Requirement: Verdict lead-line is the first line of a reviewer or delegation agent's reply
For the seven sentinel reviewer agents (`code-reviewer`, `doc-reviewer`, `database-reviewer`, `security-reviewer`, `frontend-reviewer`, `migration-reviewer`, `polyfill-reviewer`) and for `deep-reasoner`, `fast-worker`, and `e2e-runner`, the agent's quality-gate reply SHALL place its gate/verdict line as the FIRST line of the reply, and that line SHALL be machine-parseable — a `VERDICT:` line, a `RESULT:` line, or a line whose sole content is the gate symbol/status word contract already in use. This supersedes placing the gate symbol at the end of free text. `codex-bridge` is exempt from this requirement, because it relays Codex's own output verbatim and imposing a lead-line contract on it would mean editing a third party's text. Utility agents outside the named ten are out of scope for this requirement.

#### Scenario: Reviewer agent's verdict is the first line
- **WHEN** a dispatched sentinel reviewer (e.g. `code-reviewer`) completes a quality-gate review
- **THEN** the first line of its reply is a machine-parseable `VERDICT:`/`RESULT:`/gate-symbol line, not free-text findings followed by a trailing gate line

#### Scenario: deep-reasoner, fast-worker, and e2e-runner also lead with their verdict
- **WHEN** `deep-reasoner`, `fast-worker`, or `e2e-runner` returns a report that concludes a quality-gate-relevant task
- **THEN** the first line of that report is a machine-parseable verdict/result line

#### Scenario: codex-bridge is exempt
- **WHEN** `codex-bridge` relays Codex's own reply verbatim
- **THEN** no lead-line verdict requirement is imposed on that relayed text

#### Scenario: Utility agents outside the named ten are unaffected
- **WHEN** an agent not among the seven sentinel reviewers, `deep-reasoner`, `fast-worker`, or `e2e-runner` returns a reply
- **THEN** this requirement does not apply to that agent's reply format

### Requirement: Session start announces a non-default subagent quality gate setting
When `userConfig.subagent_quality_gate` is set to a non-default value, the session-start hook SHALL announce that setting, mirroring the existing announcement pattern used for `planner_model`/`deep_reasoner_model`.

#### Scenario: Non-default setting is announced at session start
- **WHEN** a session starts with `userConfig.subagent_quality_gate` set to a non-default (enabling) value
- **THEN** the session-start hook's output announces that the subagent quality gate is enabled

#### Scenario: Default setting produces no announcement
- **WHEN** a session starts with `userConfig.subagent_quality_gate` unset or at its default value
- **THEN** the session-start hook makes no mention of the subagent quality gate

### Requirement: Reviewer agents complete their verdict in a single run
The shared reviewer contract and all seven sentinel-driven reviewer definitions (code, database, doc, security, frontend, migration, polyfill) SHALL require the final verdict to be emitted within the same run that performed the review, and SHALL forbid stopping for advisory or intermediary input before the final verdict is written. Post-verdict escalation remains permitted. A reviewer run that stops without a parseable verdict is a quality-contract defect, not a valid intermediate state. Sentinel liveness remains separate: a fresh artifact MAY auto-clear its sentinel, while `.unresolved-verdict` and the subagent quality gate keep the malformed or missing verdict visible and prevent it from being treated as satisfied completion evidence.

#### Scenario: Frontend reviewer does not pause before its verdict
- **WHEN** `frontend-reviewer` completes its analysis and its definition suggests consulting advisory material
- **THEN** it folds the advisory step into the same run and stops only after the verdict artifact is written

#### Scenario: Verdict-less stop is treated as a failed review
- **WHEN** a reviewer subagent stops without a verdict in its artifact
- **THEN** the run is treated as unfinished by unresolved-verdict/quality enforcement and is not accepted as completion evidence, without requiring the fresh-artifact sentinel itself to remain armed

#### Scenario: Polyfill reviewer follows the shared single-run contract
- **WHEN** `polyfill-reviewer` performs a sentinel-driven review
- **THEN** it emits its parseable final verdict in that same run and does not pause for advisory input before writing the verdict
