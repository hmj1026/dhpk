# smoke-tester-goal-gate Specification

## Purpose
TBD - created by archiving change add-smoke-tester-goal-gate. Update Purpose after archive.
## Requirements
### Requirement: smoke-tester agent contract

The system SHALL define a `dhpk:smoke-tester` agent with frontmatter `tools: Read, Bash, Grep, Glob` (no `Edit`/`Write`), `model: sonnet`, `effort: medium`. The orchestrator SHALL hand it exactly one concrete scenario (setup → trigger → expected observable outcome → timeout). The agent SHALL assert on actual observed values (log lines, API responses, exit codes) and SHALL NOT infer a pass from absence of evidence — "it should have worked" is a FAIL. The agent SHALL always clean up any scratch resources it created before returning, regardless of verdict. The agent SHALL NEVER modify application code or configuration, SHALL NEVER run git write commands (`commit`, `push`, `merge`, `rebase`, etc.), and SHALL NEVER echo secrets into its report. Its report SHALL be no more than 20 lines, with `Verdict: PASS|FAIL` as the first line, followed by Scenario / Steps / Cleanup / Unexpected sections.

#### Scenario: Structural read-only enforcement
- **WHEN** `dhpk:smoke-tester` is dispatched
- **THEN** its available tools are limited to `Read, Bash, Grep, Glob` — it has no `Edit` or `Write` tool and therefore cannot make a scenario pass by modifying code

#### Scenario: One concrete scenario end-to-end
- **WHEN** the orchestrator dispatches `dhpk:smoke-tester` with a scenario of the form setup → trigger → expected observable outcome → timeout
- **THEN** the agent executes setup, performs the trigger, observes the actual runtime output within the timeout, and reports `Verdict: PASS` only if the observed value matches the expected observable outcome

#### Scenario: Observe, don't infer
- **WHEN** the triggered action produces no direct observable evidence (e.g. no log line, no response captured) but the agent believes the action "should have" succeeded
- **THEN** the agent reports `Verdict: FAIL`, not `Verdict: PASS`, because inference without an observed value is not evidence

#### Scenario: Mandatory cleanup regardless of verdict
- **WHEN** `dhpk:smoke-tester` created scratch resources (temp files, test records, background processes) during setup or trigger
- **THEN** it removes/terminates all of them before returning, whether the verdict is PASS or FAIL

#### Scenario: Never modifies application code, config, or git history
- **WHEN** `dhpk:smoke-tester` is executing a scenario
- **THEN** it does not edit application code or configuration files and does not run any git write command, even if doing so would make the scenario pass

#### Scenario: Report stays within the line budget and lead-line convention
- **WHEN** `dhpk:smoke-tester` returns its final report
- **THEN** the report is at most 20 lines and its first line is exactly `Verdict: PASS` or `Verdict: FAIL`

### Requirement: HAS_SMOKE high-precision detection

`skills/opsx-apply-goal/SKILL.md` Step 4 SHALL detect a `HAS_SMOKE` flag biased toward **high precision**: a false positive deadlocks an unattended session against a system it cannot actually drive. `HAS_SMOKE` SHALL auto-detect `true` only on strong signals: an explicit runtime-verification task named in `proposal.md`/`tasks.md`, a dispatched `e2e-runner` task, or a derivable launch command from repo config. Weak signals (e.g. a mere compose-file presence with no derivable launch command) SHALL leave `HAS_SMOKE=false` and SHALL add a Block A hint that a weak drivable signal was detected and `--smoke` would enable the gate.

#### Scenario: Strong signal auto-enables the gate
- **WHEN** `proposal.md` or `tasks.md` names an explicit runtime-verification task, or a launch command is derivable from repo config
- **THEN** `HAS_SMOKE` auto-detects `true` with no flag required

#### Scenario: Weak signal stays off with a hint
- **WHEN** the repo has a compose file present but no derivable launch command, and no explicit runtime-verification task is named
- **THEN** `HAS_SMOKE` remains `false` and Block A carries a hint that a weak drivable signal was detected and `--smoke` would enable it

### Requirement: --smoke / --no-smoke flag handling and precedence

`skills/opsx-apply-goal/SKILL.md` Step 1 SHALL parse `--smoke` and `--no-smoke` alongside the existing flags. `--smoke` SHALL force `HAS_SMOKE=true`, and if no launch command is derivable, the Block A note SHALL still be emitted stating that the runtime could not be driven this session. `--no-smoke` SHALL force `HAS_SMOKE=false`, overriding detection regardless of signal strength. Precedence SHALL be `--no-smoke` > `--smoke` > detection.

#### Scenario: --smoke forces the gate on
- **WHEN** the goal session is invoked with `--smoke`
- **THEN** `HAS_SMOKE=true` regardless of detected signal strength

#### Scenario: --smoke without a derivable launch command still notes the gap
- **WHEN** `--smoke` is passed but no launch command can be derived from repo config
- **THEN** `HAS_SMOKE=true` is set and Block A carries a note that the runtime could not be driven this session

#### Scenario: --no-smoke forces the gate off
- **WHEN** the goal session is invoked with `--no-smoke`
- **THEN** `HAS_SMOKE=false`, even if a strong drivable signal was detected

#### Scenario: --no-smoke outranks --smoke
- **WHEN** both `--smoke` and `--no-smoke` are passed in the same invocation
- **THEN** `HAS_SMOKE=false` (`--no-smoke` takes precedence)

### Requirement: Part 3 conditional smoke gate line with self-escaping hatch

`skills/opsx-apply-goal/SKILL.md` Part 3 SHALL gain a conditional gate line, emitted only when `HAS_SMOKE=true`, satisfied by exactly one of two branches: (a) `dhpk:smoke-tester` was dispatched with one concrete scenario and its report — first line `Verdict: PASS` — plus the key observed value was pasted into the conversation; OR (b) a one-line note was pasted stating why the system could not be driven this session (launch command failed / no runtime available) together with the failing command's output. Branch (b) is a self-escaping hatch, phrased in the style of the existing pre-existing-failure hatch, that prevents the gate from deadlocking an unattended session when the runtime genuinely cannot be reached.

#### Scenario: Gate satisfied by a PASS verdict with observed value
- **WHEN** `HAS_SMOKE=true` and `dhpk:smoke-tester` returns `Verdict: PASS` as its first line, with the key observed value pasted into the conversation
- **THEN** the Part 3 smoke gate line is satisfied

#### Scenario: Gate satisfied by the self-escaping hatch
- **WHEN** `HAS_SMOKE=true` but the launch command failed or no runtime was available this session
- **THEN** the gate is satisfied by pasting a one-line note explaining why the system could not be driven, together with the failing command's output, without dispatching `dhpk:smoke-tester` again

#### Scenario: Gate not emitted when HAS_SMOKE is false
- **WHEN** `HAS_SMOKE=false` (via `--no-smoke` or absence of a strong signal)
- **THEN** Part 3 does not emit the smoke gate line at all

#### Scenario: FAIL verdict does not satisfy the gate
- **WHEN** `HAS_SMOKE=true` and `dhpk:smoke-tester` returns `Verdict: FAIL`
- **THEN** the gate is not satisfied and the goal session does not proceed past Part 3 on that basis alone

### Requirement: Block A / Block C / verification checklist smoke reporting

`skills/opsx-apply-goal/SKILL.md` Block A SHALL gain a `Smoke gate` row reporting one of: `on (signal)`, `on (--smoke)`, `off (--no-smoke)`, or `off (no strong signal, hint emitted)`. Block C SHALL gain one explanatory line describing the smoke gate's purpose. The dry-run verification checklist SHALL assert two items: the smoke line is emitted if and only if `HAS_SMOKE=true`, and `--no-smoke` suppresses it regardless of detected signal strength.

#### Scenario: Block A reports the smoke gate state
- **WHEN** Block A is emitted for a goal session
- **THEN** it includes a `Smoke gate` row with exactly one of `on (signal)`, `on (--smoke)`, `off (--no-smoke)`, or `off (no strong signal, hint emitted)`

#### Scenario: Verification checklist asserts emission and suppression
- **WHEN** `/dhpk:opsx-apply-goal <change-id> --dry-run` runs
- **THEN** the checklist confirms the smoke line appears iff `HAS_SMOKE=true`, and confirms `--no-smoke` suppresses it even when a strong signal was detected

### Requirement: Smoke scenario is sourced from the change's claimed behavior, never invented

The orchestrator, not `dhpk:smoke-tester`, SHALL construct the scenario dispatched to the agent, deriving it from the active change's claimed user-visible behavior (proposal.md / tasks.md). `dhpk:smoke-tester` SHALL NOT invent its own scope or scenario beyond what it is handed.

#### Scenario: Orchestrator derives the scenario from the change
- **WHEN** the orchestrator prepares a `dhpk:smoke-tester` dispatch for a goal session
- **THEN** the scenario's setup/trigger/expected-observable are derived from the active change's claimed user-visible behavior, not authored ad hoc by the agent

#### Scenario: Agent does not expand scope
- **WHEN** `dhpk:smoke-tester` is dispatched with a scenario
- **THEN** it executes exactly that scenario and does not probe additional behavior it was not asked to verify
