# qa-executor-agent Specification

## Purpose

Define a typed live manual QA execution role. The role runs assigned QA-manual cases against a live environment through a browser skill. It records per-case evidence into one assigned results file and does not modify application code or live data without explicit authorization.

## Requirements

### Requirement: QA executor requires a complete case assignment

The `qa-executor` agent SHALL start execution only when its dispatch supplies all of the following:
- the QA manual or brief path
- the case identifiers or range
- the target environment
- exactly one results-file path

When any of these inputs is missing, the agent SHALL return `BLOCKED` and name the missing input, without opening the target environment.

#### Scenario: Missing results path blocks execution

- **WHEN** a dispatch names a QA manual and cases but no results-file path
- **THEN** the agent returns `BLOCKED` naming the missing results path and performs no browser action

#### Scenario: Complete assignment proceeds

- **WHEN** a dispatch supplies the manual path, case range, environment, and results path
- **THEN** the agent reads the manual and brief before its first browser action

### Requirement: QA executor writes only the assigned results file

The `qa-executor` agent SHALL write only the single assigned results file. It SHALL NOT edit application source, tests, QA manuals, or configuration. It SHALL NOT run `git checkout`, `git stash`, `git reset`, `git restore`, `git clean`, or `git commit`.

#### Scenario: Defect found during a case

- **WHEN** a case fails because of an apparent product defect
- **THEN** the agent records the failure and evidence in the results file and returns the defect to the parent without editing source code

### Requirement: Live-data writes require an explicit authorized fixture scope

The `qa-executor` agent SHALL NOT perform state-changing operations outside the steps a QA case prescribes, unless the dispatch contains an explicit authorized fixture scope that names the allowed targets. Out-of-case operations include direct database writes, configuration toggles, session force-close, and data cleanup. The case-prescribed steps are UI or API actions. Any operation outside the authorized scope SHALL be reported as `NOT_RUN` with the exact request the parent needs to authorize.

#### Scenario: Fixture change without authorization

- **WHEN** a case needs a configuration toggle that the dispatch did not authorize
- **THEN** the agent marks the case `NOT_RUN`, reports the exact toggle request, and leaves the configuration unchanged

#### Scenario: Fixture change within authorized scope

- **WHEN** the dispatch authorizes a named fixture change and a case needs it
- **THEN** the agent performs only that change and records it in the results file

### Requirement: QA executor never reads or emits credentials

The `qa-executor` agent SHALL obtain login details only through the mechanism the dispatch or brief names. It SHALL NOT print, store, or copy passwords, cookies, tokens, or secret configuration values into the results file or its reply.

#### Scenario: Results file content

- **WHEN** the agent completes a login step
- **THEN** the results file records that login succeeded and does not contain the credential or cookie value

### Requirement: QA executor reports per-case verdicts with observed evidence

For each assigned case, the `qa-executor` agent SHALL record one verdict, one of `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`, together with the observed evidence: visible values, messages, or read-only query results. Verdicts SHALL rest on observed state, not on transport success alone. The final reply SHALL summarize the verdict counts, the results-file path, and any unresolved requests to the parent.

#### Scenario: Transport success without visible state

- **WHEN** a save request returns HTTP 200 but the expected record is not visible
- **THEN** the case verdict is not `PASS`, and the evidence notes the missing visible state

### Requirement: Product failure requires attributable action evidence

For each executed case, the agent SHALL record the prerequisites, intended control or field, action-attempt evidence, and relevant observed outcome against the expectation. Before reporting product `FAIL`, it SHALL confirm completed prerequisites, the intended control or field, and reliable case-appropriate evidence that the prescribed action was attempted. It SHALL complete safe case-prescribed prerequisites within existing authorization. A network request is not required for every action. Without reliable attempt evidence, the agent SHALL investigate the observed evidence and SHALL NOT attribute product `FAIL` on that basis alone.

#### Scenario: Reliable click has no expected effect

- **WHEN** prerequisites are met and a click on the correct enabled button is reliably attempted, but the expected effect is absent
- **THEN** the evidence may support product `FAIL` even if no network request is observed

#### Scenario: Operation attempt is uncertain

- **WHEN** the expected effect is absent and the tool did not reliably establish that the prescribed action was attempted
- **THEN** the agent investigates the evidence and does not report product `FAIL` on the missing effect alone

### Requirement: QA executor distinguishes tool limitations

When a tool cannot reliably perform a prescribed interaction or observe its outcome, the agent SHALL report `BLOCKED`, including after a case starts, with `tool-limitation` as a reason category rather than a verdict. The report SHALL identify the affected case, evidence, and any attempted or proposed safe alternative under existing authorization, and state whether it verifies the original acceptance goal. Alternatives SHALL NOT silently replace a required UI interaction with a different acceptance test.

#### Scenario: Menu interaction cannot be driven

- **WHEN** the tool cannot reliably operate a required menu and a direct URL is available
- **THEN** the case is `BLOCKED` with `tool-limitation`, and the report explains that opening the URL does not verify the menu interaction

### Requirement: Unknown state-changing outcomes are not replayed

The agent SHALL NOT replay a state-changing or non-idempotent action whose outcome is unknown. It SHALL use only authorized read-only observation to reconcile the outcome, and SHALL stop with `BLOCKED` and record the unknown outcome if reconciliation remains unresolved.

#### Scenario: Unknown submission outcome

- **WHEN** a submission has an unknown outcome and authorized read-only observation cannot reconcile it
- **THEN** the agent does not submit again and reports `BLOCKED` with the unknown outcome

### Requirement: Error evidence retains baseline and context

The agent SHALL record console and page-error baselines before testing separately from subsequent observations, including page and action context where available. A baseline or known-noise signature SHALL neither establish a new failure by itself nor exempt a currently relevant error. Error evidence supporting `FAIL` SHALL be reliably tied to the expected behavior; ambiguous attribution SHALL be stated explicitly.

#### Scenario: Cross-page noise and relevant errors

- **WHEN** an earlier page error remains in a buffer and an error is observed during the current case
- **THEN** the agent distinguishes baseline from subsequent observations and assesses relevance rather than failing or exempting either solely by signature

#### Scenario: Relevant baseline error

- **WHEN** a baseline error remains relevant and reliable evidence ties it to the case's expected behavior
- **THEN** it may support `FAIL` even if its signature is known
