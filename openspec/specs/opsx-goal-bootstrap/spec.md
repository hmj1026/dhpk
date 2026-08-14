# opsx-goal-bootstrap Specification

## Purpose
TBD - created by archiving change harvest-advice-20260711. Update Purpose after archive.
## Requirements
### Requirement: Goal kickoff runs an orientation command before any Skill invocation
The goal string emitted by opsx-apply-goal SHALL instruct the fresh session to run exactly one
Bash orientation command (reading the change's tasks.md head) BEFORE invoking the opsx:apply
skill, so the first Skill call never races plugin skill-catalog registration.

#### Scenario: Fresh session boots without Unknown-skill race
- **WHEN** a generated /goal string is pasted into a fresh session
- **THEN** the session's first tool call is a Bash orientation command (not a Skill invocation), and opsx:apply is invoked on a subsequent turn

#### Scenario: Skill catalog still unavailable after retry
- **WHEN** the opsx:apply invocation returns "Unknown skill" and one retry on the next turn also fails
- **THEN** the session proceeds by reading openspec/changes/<CHANGE_ID>/ artifacts directly and implementing tasks under the same gates, instead of aborting or hunting for the skill

### Requirement: Emitted goal strings carry a self-locating policy path, never a baked absolute path
The goal generator SHALL NOT embed a generation-time-resolved absolute plugin path in the emitted
goal string. Policy references SHALL be emitted as a self-locating clause: resolve
`$CLAUDE_PLUGIN_ROOT` in-session, fall back to the newest installed cache path, and if
unresolvable proceed by the gates written in the goal string itself — never scanning the
filesystem.

#### Scenario: Executing session resolves the policy from its own environment
- **WHEN** a goal string generated in one environment (source tree or older cache) executes in a session whose plugin root differs
- **THEN** the session resolves execution-policy.md via its own $CLAUDE_PLUGIN_ROOT or cache fallback, without any `find /`-style filesystem scan

#### Scenario: Policy file unresolvable
- **WHEN** neither $CLAUDE_PLUGIN_ROOT nor the cache fallback yields the policy file
- **THEN** the session continues using the dispatch and gate clauses embedded in the goal string, and does not block or scan the filesystem

### Requirement: Inline-edit exception counts the whole implement-step footprint
The goal template's inline-edit carve-out SHALL state that the ≤2-file threshold is measured on
the entire implement-step's edited-file footprint, not on each individual edit.

#### Scenario: Multi-file step exceeds the inline threshold
- **WHEN** an implement step's fix spans 4 files even though each file needs only one surgical edit
- **THEN** the goal discipline requires dispatching a worker for the step rather than editing inline

### Requirement: Goal generator hard-stops over the length cap
The goal generator SHALL measure the assembled `GOAL_CONDITION` as UTF-8 bytes via a scratch file and `wc -c`. It SHALL compose one compact full template with a fixed core and change-scaled gate tokens, targeting at most 3,400 UTF-8 bytes and reserving at least 600 bytes below the 4,000-byte hard cap for bounded variable verification data. A measured length at or under 4,000 bytes SHALL emit normally; a length over 4,000 bytes SHALL produce the Block A hard-stop notice with the measured length and no `/goal` output. The generator SHALL not silently remove required safety or verification clauses to fit.

#### Scenario: Compact normal generation
- **WHEN** the fixed core and change-scaled gates measure at most 3,400 UTF-8 bytes
- **THEN** the generator emits the goal in one pass and reports the measured length

#### Scenario: Bounded variable gates use reserved space
- **WHEN** change-specific test, smoke, or artifact gates are added
- **THEN** the generator keeps the required gates, uses their compact contract form, and remains at or under 4,000 UTF-8 bytes when the reserved budget permits

#### Scenario: Over-cap generation hard-stops
- **WHEN** the assembled goal string measures over 4,000 UTF-8 bytes
- **THEN** the generator emits Block A with the measured length, does not emit a `/goal` string, and does not fall back to a compact substitute that drops required clauses

### Requirement: The orientation step reads the located execution policy

The goal string's orientation instruction SHALL direct the session to read the execution-policy file resolved by the existing self-locating clause during orientation, combined with the tasks.md head read inside the same single orientation Bash command (preserving the existing "exactly one Bash orientation command before any Skill invocation" requirement), so the behavioral directives the condition points at (dispatch table, premise verification, doubt cycle, CODEX paths) enter context once as a file read. When the policy file is unresolvable, the session proceeds on the condition's own inline gates per the existing policy-file-unresolvable requirement — the orientation read is best-effort, never blocking.

#### Scenario: Orientation loads the policy once

- **WHEN** a generated /goal string boots a fresh session and the self-locating clause resolves `rules/execution-policy.md`
- **THEN** the session reads that file during orientation, before its first worker dispatch, and does not re-read it as a condition every turn

#### Scenario: Unresolvable policy does not block orientation

- **WHEN** neither `$CLAUDE_PLUGIN_ROOT` nor the cache fallback yields the policy file
- **THEN** orientation completes on the tasks.md read alone and the session proceeds using the condition's inline roster and gates

### Requirement: Orientation command omits the duplicated tasks.md read
Because the goal string carries a `<TASK_DIGEST>`, the goal template's kickoff orientation command SHALL NOT include a tasks.md preview read (e.g. `head -40 .../tasks.md`); opsx:apply still reads tasks.md when implementing.

#### Scenario: Fresh goal session kickoff
- **WHEN** an unattended session boots from an emitted goal string
- **THEN** the orientation command reads the policy file but not tasks.md, and task orientation comes from the embedded digest

### Requirement: E2E roster clause is conditional on a detected browser surface
The goal generator SHALL detect whether the change has Playwright/browser targets (`HAS_E2E`: tasks or proposal reference Playwright, `.spec.js`/`.spec.ts`, or browser-journey work) and SHALL emit the `RED/E2E Playwright → dhpk:e2e-runner` roster clause only when `HAS_E2E` is true.

#### Scenario: Pure backend change
- **WHEN** the change's tasks.md and proposal.md contain no Playwright or spec-file references
- **THEN** the emitted goal roster omits the e2e-runner clause

#### Scenario: Change includes Playwright journeys
- **WHEN** tasks.md references `.spec.ts` journeys
- **THEN** the emitted goal roster includes the e2e-runner clause

### Requirement: Emitted goals carry explicit-repo gitnexus guidance in multi-repo environments
The goal template SHALL include a guidance line instructing the executing session to pass an explicit `repo="<project>"` parameter on gitnexus MCP calls (impact, detect_changes, query) whenever more than one repository is indexed, so calls do not fail with a multiple-repositories error and burn retry turns.

#### Scenario: Goal string includes the repo guidance
- **WHEN** `opsx-apply-goal` emits a goal string
- **THEN** the string contains guidance to pass `repo="<project name>"` on gitnexus calls when multiple repositories are indexed

#### Scenario: Executing session avoids the ambiguity retry
- **WHEN** an unattended session following the goal calls `gitnexus_impact` in an environment with several indexed repos
- **THEN** the call carries the `repo` parameter on the first attempt
