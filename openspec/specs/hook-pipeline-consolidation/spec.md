# hook-pipeline-consolidation Specification

## Purpose
TBD - created by archiving change consolidate-hooks-delegation-verdicts. Update Purpose after archive.
## Requirements
### Requirement: PreToolUse Bash gates merge into one warn-only git-gate script
The `PreToolUse` `Bash` matcher SHALL run exactly one warn-only git-gate script, `scripts/hooks/pretool-git-gate.sh`, replacing the two prior separate warn-only scripts (`pretool-sentinel-gate.sh`, `pretool-branch-safety.sh`). `pretool-git-gate.sh` SHALL parse the tool payload's command exactly once (a single `extract_tool_input command` call) and evaluate both the sentinel-commit check and the protected-branch check against the shared parsed value (`$CMD`/`$CMD_STRIPPED`), rather than each check re-parsing the payload independently. `scripts/hooks/pre-bash-dispatch.sh` (the hard-block surface for destructive commands) SHALL remain unmodified by this consolidation.

#### Scenario: Single payload parse feeds both checks
- **WHEN** `pretool-git-gate.sh` runs on a `Bash` tool call
- **THEN** it calls `extract_tool_input command` exactly once and both the sentinel-commit check and the protected-branch check evaluate against that single parsed value

#### Scenario: pre-bash-dispatch.sh hard-block surface is unchanged
- **WHEN** a destructive command (`rm -rf`, `curl|sh`, `chmod 777`, `git push --force`) is evaluated
- **THEN** `pre-bash-dispatch.sh` continues to hard-block it exactly as before this change, independent of `pretool-git-gate.sh`

### Requirement: Merged git gate emits combined output under both block and warn modes
When either the sentinel-commit check or the protected-branch check is configured in `block` mode and fires, `pretool-git-gate.sh` SHALL emit a single combined stderr message covering every fired check and exit with status 2. When no fired check is in `block` mode, `pretool-git-gate.sh` SHALL emit at most one combined `systemMessage` JSON object covering every fired warn-mode check, never more than one JSON object per invocation. Both kill-switches (`DHPK_SENTINEL_COMMIT_GATE`, `DHPK_BRANCH_SAFETY`) SHALL remain independently settable, and disabling one SHALL NOT suppress the other check's evaluation or output.

#### Scenario: Either check firing in block mode exits 2 with combined stderr
- **WHEN** the sentinel-commit check is configured `block` and fires (with or without the protected-branch check also firing)
- **THEN** `pretool-git-gate.sh` writes one combined stderr message naming every fired check and exits with status 2

#### Scenario: Both checks firing in warn mode produce one combined systemMessage
- **WHEN** both the sentinel-commit check and the protected-branch check fire in `warn` mode on the same command
- **THEN** `pretool-git-gate.sh` emits exactly one JSON object with a `systemMessage` combining both findings, not two separate JSON objects

#### Scenario: Kill-switches are independently honored
- **WHEN** `DHPK_SENTINEL_COMMIT_GATE` is disabled but `DHPK_BRANCH_SAFETY` is enabled
- **THEN** the protected-branch check still evaluates and can fire while the sentinel-commit check is skipped entirely

### Requirement: Merged git gate preserves branch-safety dedup state and timeout
`pretool-git-gate.sh` SHALL preserve the protected-branch check's existing per-session dedup state file so a repeated warning is not re-emitted every call within the same session, and SHALL carry a `timeout: 5` (seconds) hook configuration, matching the stricter of the two predecessor scripts' timeout settings.

#### Scenario: Protected-branch warning is not repeated within a session
- **WHEN** the protected-branch check has already warned once in the current session for the same branch
- **THEN** a subsequent `Bash` call in the same session does not re-emit the protected-branch warning, per the preserved dedup state file

#### Scenario: Hook configuration carries a 5-second timeout
- **WHEN** `hooks/hooks.json` registers `pretool-git-gate.sh` on the `PreToolUse` `Bash` matcher
- **THEN** its entry specifies `timeout: 5`

### Requirement: PostToolUse Edit advisories merge into one async advisory script
The `PostToolUse` `Edit` matcher SHALL run exactly one async advisory script, `scripts/hooks/post-edit-advisory.sh`, replacing the two prior separate async advisory scripts (`post-write-crlf-fix.sh`, `post-edit-manifest-guard.sh`). `post-edit-advisory.sh` SHALL extract `file_path` from the tool payload exactly once and evaluate both the CRLF-normalization trigger (`*.sh` files) and the root-manifest lockfile-reminder trigger against that single extracted value. `scripts/hooks/post-edit-dispatch.sh` (the blocking sentinel-writer) SHALL remain unmodified by this consolidation.

#### Scenario: Single file_path extraction feeds both triggers
- **WHEN** `post-edit-advisory.sh` runs on an `Edit`/`Write`/`MultiEdit` tool call
- **THEN** it extracts `file_path` exactly once and both the CRLF trigger and the manifest-lockfile trigger evaluate against that single extracted value

#### Scenario: .sh file triggers CRLF normalization advisory
- **WHEN** the edited `file_path` matches `*.sh`
- **THEN** `post-edit-advisory.sh` reports the CRLF-normalization advisory

#### Scenario: Root manifest file triggers lockfile reminder
- **WHEN** the edited `file_path` is a root-level manifest file covered by the lockfile-sync reminder
- **THEN** `post-edit-advisory.sh` reports the lockfile-sync reminder, independent of whether the CRLF trigger also fired

#### Scenario: post-edit-dispatch.sh blocking sentinel writer is unchanged
- **WHEN** an `Edit`/`Write`/`MultiEdit` call arms a review sentinel
- **THEN** `post-edit-dispatch.sh` continues to write and gate that sentinel exactly as before this change, independent of `post-edit-advisory.sh`

### Requirement: Merged advisory script always exits 0
`post-edit-advisory.sh` SHALL always exit with status 0 regardless of which advisories fire, consistent with its role as a non-blocking, asynchronous notification script.

#### Scenario: Neither trigger fires
- **WHEN** the edited `file_path` matches neither the CRLF trigger nor the manifest-lockfile trigger
- **THEN** `post-edit-advisory.sh` exits 0 with no advisory emitted

#### Scenario: Both triggers fire
- **WHEN** the edited `file_path` matches both the CRLF trigger and the manifest-lockfile trigger
- **THEN** `post-edit-advisory.sh` reports both advisories and still exits 0

### Requirement: Superseded hook scripts are fully removed with every reference cleaned up
The four scripts superseded by this consolidation — `scripts/hooks/pretool-sentinel-gate.sh`, `scripts/hooks/pretool-branch-safety.sh`, `scripts/hooks/post-write-crlf-fix.sh`, `scripts/hooks/post-edit-manifest-guard.sh` — SHALL be deleted, and every reference to them (hook wiring in `hooks/hooks.json`, test files, and documentation such as `docs/hook-extension.md`) SHALL be removed or retargeted in the same change. No dangling reference to a deleted script's filename SHALL remain in the repository.

#### Scenario: hooks.json no longer registers the superseded scripts
- **WHEN** this change is complete
- **THEN** `hooks/hooks.json` contains no `PreToolUse`/`PostToolUse` entry naming `pretool-sentinel-gate.sh`, `pretool-branch-safety.sh`, `post-write-crlf-fix.sh`, or `post-edit-manifest-guard.sh`

#### Scenario: Tests are retargeted, not left pointing at deleted scripts
- **WHEN** a test previously exercised one of the four superseded scripts (e.g. `tests/pretool-branch-safety-dedup.test.js`)
- **THEN** the test is retargeted to the merged replacement script (`pretool-git-gate.sh` or `post-edit-advisory.sh`) rather than left failing or silently removed without a replacement assertion

#### Scenario: Documentation is synced to the merged script names
- **WHEN** `docs/hook-extension.md` is checked after this change
- **THEN** it names `pretool-git-gate.sh` and `post-edit-advisory.sh` in place of the four superseded scripts, with no residual reference to the deleted filenames

### Requirement: Sentinel-clearing scripts share one core library
The three sentinel-clearing entry points — `scripts/hooks/subagent-stop-verify.sh` (sanctioned auto-clear), `scripts/hooks/clear-sentinel.sh` (manual/triage), `scripts/hooks/reap-stale-sentinels.sh` (stale reap) — SHALL delegate their shared logic (slot resolution, sentinel file operations, logging) to a single library `scripts/hooks/_lib/sentinel-clear-core.sh`. The three entry points SHALL remain as thin shells with unchanged invocation semantics; no caller-facing interface changes.

#### Scenario: Behavior parity after extraction
- **WHEN** each of the three entry points runs its existing test suite after the extraction
- **THEN** all tests pass with unchanged observable behavior (same sentinel files removed, same log lines)

#### Scenario: Single implementation of sentinel file removal
- **WHEN** the repository is searched for the sentinel-removal implementation
- **THEN** it exists once in `_lib/sentinel-clear-core.sh` and the three entry points call it rather than reimplementing it

### Requirement: Default-off Stop advisory hooks merge into one gated dispatcher
The three default-off async Stop hooks (`stop-completion-evidence.sh`, `stop-graduation-scan.sh`, `stop-dispatch.sh`) SHALL merge into a single async gated dispatcher `scripts/hooks/stop-advisory-dispatch.sh` that evaluates each advisory's existing enable-gate and runs only the enabled ones. `hooks/hooks.json` Stop wiring SHALL shrink accordingly (`stop-review-reminder.sh` stays separate as the sync sentinel reminder). Each merged advisory's kill-switch SHALL remain independently settable; superseded scripts SHALL be deleted with every reference (wiring, tests, docs) retargeted and no dangling filename references remaining.

#### Scenario: All-off default emits nothing
- **WHEN** none of the three advisory gates is enabled and a Stop event fires
- **THEN** `stop-advisory-dispatch.sh` exits 0 quickly with no advisory output

#### Scenario: Independent gates honored
- **WHEN** only the graduation-scan gate is enabled
- **THEN** the dispatcher runs the graduation scan and skips the other two advisories entirely

#### Scenario: No dangling references to superseded Stop scripts
- **WHEN** this change is complete
- **THEN** `hooks/hooks.json`, tests, and docs contain no reference to the three superseded Stop script filenames, and each advisory's behavior has a retargeted test
