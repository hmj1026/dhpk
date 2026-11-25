---
name: flow-drive
description: "Use the current Host and Model to complete one bounded, authorized task and report observed verification evidence or a precise blocker."
---

# Flow Drive

Invoke `/dhpk-lite:flow-drive` explicitly with one bounded task, a task-file path, or a confirmed specification/change ID. The current Host and Model handle understanding, investigation, edits, verification, and the report. `/dhpk-lite:flow-drive --help` describes the current entry; help makes no project changes.

This directory is the complete skill. It needs no dhpk checkout, sibling skill, resource synchronization, parser, runner, external CLI worker, or special execution receipt. The Host must be able to read the supplied task and relevant project files, make only authorized edits, and run the consumer project's available verification. It uses its normal file and shell tools; provider and subagent access remains subject to that Host's own capabilities and grants.

## Validation failure diagnostics

When the active Host exposes Claude Code `PostToolUse` and
`PostToolUseFailure`, the native validation-diagnostics hook tracks a verified
test, lint, or type-check target by session, project, and the actual Claude
`agent_id`. It resets on success or target change, cleans only the stopping
subagent's external atomic state, and emits one advisory on the second failure.
Other Hosts use an equivalent runner/workflow fallback when available; record
missing capabilities as `UNAVAILABLE` and skipped checks as `NOT_RUN`.

Projects may opt into `validation_failure_mode:block`. In that mode, two
correlated failures pause Edit/Write/MultiEdit while read-only diagnostics stay
available. Follow the hook's recovery command with the original target,
premise, observed configuration value, proposed change, and rerun plan. The
hook verifies the observation in the reported project configuration before
resuming the blocked editor. Escalate if the diagnosis has no direction or
the existing stop conditions apply. The gate covers those native edit tools,
not Bash, so do not edit through the shell while paused. Hosts without a
registered blocking event use the advisory workflow and report hard gating as
`UNAVAILABLE`.

## Invocation boundary

Accept one task input and no execution-selection options. If a user supplies a retired Flow Drive role, backend, Provider, planning, or architecture option as invocation syntax, reject it before any dependent edits, explain that it is unsupported here, and point to [the migration guide](references/migration.md). Ask for one task-only input or a separate help invocation. Do not silently reinterpret a retired option as task text.

A flag written inside the quoted task, a task file, or the confirmed specification is task content. For example, `/dhpk-lite:flow-drive "Update the documentation example that contains --worker=codex"` is an ordinary documentation task. Read and interpret that content as part of the task; do not treat the embedded flag as a Flow Drive option.

## Complete the task

1. Confirm one bounded goal, its acceptance criteria, requested scope, and the user's authority. If a confirmed ID or task file cannot be read, or the outcome or write scope is missing, state the exact blocker before dependent edits.
2. Follow the consumer repository's own instructions and Project Convention. Do not impose dhpk development or release rules on a consumer project.
3. Investigate enough to support the requested change. Diagnose an unknown cause before edits that depend on it. Keep writes within the authorized scope and preserve unrelated work.
4. Verify the acceptance criteria using the consumer project's appropriate tools. Report the commands or checks actually run and their observed results. A failed or unavailable check is a failure or gap, never a pass.
5. Finish when every criterion has evidence, or report what remains blocked or unverified and the concrete next action.

## Completion evidence

For each applicable test, lint, or GitNexus change analysis, record the
command, `PASS` / `FAIL` / `NOT_RUN`, exit code if run, and redacted terminal
output or a readable evidence path. Include the reason for failed or unrun
checks. Evaluate completion against the task's acceptance criteria.

| Observed check | Report |
| --- | --- |
| Tests exit 0 and report passing assertions | `PASS`, 0, actual test summary or path |
| Lint exits 1 with a diagnostic | `FAIL`, 1, diagnostic and failure reason |
| GitNexus is unavailable | `NOT_RUN`, tool unavailable, no exit code |

Do not claim a commit, merge, release, deployment, or other external action unless it was separately requested and actually completed.
