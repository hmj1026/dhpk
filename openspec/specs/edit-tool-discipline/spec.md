# edit-tool-discipline Specification

## Purpose
TBD - created by archiving change dhpk-advice-fe13512c-fixes. Update Purpose after archive.
## Requirements
### Requirement: Repo file edits use Edit/Write; Bash is last-resort and self-triggers review

Repo file edits SHALL be made with the Edit or Write tools, not with Bash-based file writes (python heredocs, `tee`, shell redirection). A Bash-written file does not pass through the project's `PostToolUse` Edit/Write hooks, so the review sentinel that would normally arm for that file type never arms, and the file can silently skip its mandatory reviewer gate. Bash-based file writes SHALL be used only as a last resort (e.g. the Edit/Write tools cannot express the needed operation), and whenever one is used, the writer SHALL self-trigger the review gate that would have applied had the file been Edit/Write-written — dispatching the appropriate reviewer (or, absent a project's post-edit hooks having fired, at minimum checking for and handling the applicable `.pending-*` sentinel manually per the existing AI-judgment back-stop convention).

#### Scenario: Bash-written file self-triggers its reviewer
- **WHEN** a repo file is written via a Bash heredoc or redirection because Edit/Write could not express the operation
- **THEN** the writer explicitly dispatches (or confirms already-armed) the reviewer gate that file type requires, rather than relying on a hook that will not fire

#### Scenario: Edit/Write is the default path
- **WHEN** a repo file edit can be expressed with the Edit or Write tool
- **THEN** it is made with that tool, not with a Bash-based write

### Requirement: CJK/fullwidth document edits copy old_string verbatim from Read output

When editing a document containing CJK text or fullwidth punctuation (，（）——, etc.), the Edit tool's `old_string` argument SHALL be copied verbatim from the immediately preceding Read tool's output for that region, never retyped or reconstructed from memory. Fullwidth punctuation characters are visually similar to, but distinct from, their halfwidth ASCII counterparts, and a reconstructed `old_string` that substitutes one for the other fails to match silently or edits the wrong occurrence. When an Edit's `old_string` cannot be matched after this precaution (e.g. non-unique text, or an editor tool limitation), python or sed SHALL be used as the documented fallback path instead of retrying with a hand-retyped string.

#### Scenario: old_string is copied from Read output
- **WHEN** editing a CJK/fullwidth-punctuation document
- **THEN** the `old_string` passed to Edit is copied verbatim from the preceding Read output, not retyped from memory

#### Scenario: Fallback to python/sed on a persistent match failure
- **WHEN** an Edit against CJK/fullwidth text fails to match even with a verbatim-copied `old_string`
- **THEN** the edit falls back to a python or sed-based replacement rather than repeatedly retrying a hand-retyped Edit `old_string`

### Requirement: Stop-time scan backstop is implemented or its deferral is documented

As a mechanical backstop for the self-trigger obligation above, this change SHALL either (a) extend the Stop hook (`scripts/hooks/stop-review-reminder.sh`) to detect repo files changed in the working tree (via `git status`/`git diff`) that do not correspond to a tool-call-triggered `.pending-*` sentinel already on record for this session, arming the applicable sentinel(s) for those files before the existing pending-sentinel scan runs — so a Bash-written file that skipped its hook still surfaces a reviewer reminder at Stop time — or (b) record a documented deferral decision (in the change's task notes, per design D6) stating why the scan's implementation complexity is disproportionate to the finding, leaving the Edit/Write policy statement as the shipped fix. When branch (a) is implemented, Edit/Write-written files whose hooks already armed or cleared their sentinels normally SHALL be unaffected by the scan.

#### Scenario: Implemented scan arms a sentinel for a Bash-written file
- **WHEN** branch (a) is implemented, and a session ends with a repo file changed via a Bash-based write with no corresponding `.pending-*` sentinel armed during the session
- **THEN** the Stop-time scan arms the applicable sentinel for that file before the Stop hook's existing pending-sentinel reminder logic runs

#### Scenario: Implemented scan leaves Edit/Write-written files unaffected
- **WHEN** branch (a) is implemented and all changed files in the session were written via Edit/Write (their hooks already armed or cleared the applicable sentinels normally)
- **THEN** the Stop-time scan arms no additional sentinels and behavior is unchanged from before this requirement

#### Scenario: Deferral is documented, not silent
- **WHEN** the implementing session concludes the scan's complexity is disproportionate (branch (b))
- **THEN** the deferral decision and its rationale are recorded in the change's task notes, and the Edit/Write policy statement requirement above still ships — the scan is never silently dropped without a recorded decision
