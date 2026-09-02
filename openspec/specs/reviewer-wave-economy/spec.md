# reviewer-wave-economy Specification

## Purpose
TBD - created by archiving change refine-opsx-orchestration-governance. Update Purpose after archive.
## Requirements
### Requirement: Reviewers run once per implementation wave
The orchestrator SHALL define an implementation wave as the contiguous edit batch completed before a review gate and SHALL dispatch the applicable reviewer set once for that wave. Reviewer applicability SHALL be derived from changed-file scope, not from every individual edit event.

#### Scenario: Mixed documentation and hook wave
- **WHEN** one implementation wave changes agent markdown and hook scripts
- **THEN** the applicable documentation and code/hook reviewers are dispatched once over the complete wave scope

### Requirement: Known-finding re-review is confirm-only
After a review returns findings, the orchestrator SHALL apply the known fixes as one batch and SHALL dispatch at most one follow-up review asking for confirmation of those named findings. The follow-up SHALL not repeat a full review unless new substantive scope was introduced.

#### Scenario: Multiple known findings
- **WHEN** one review identifies three findings and all three are fixed
- **THEN** the reviewer receives one confirm-only re-review for the three named findings

#### Scenario: New scope during a fix batch
- **WHEN** a fix introduces a new substantive behavior change
- **THEN** the new scope starts a separate review decision and is not silently covered by confirm-only wording

### Requirement: Reviewer prompts use a compact shared contract
Every reviewer dispatch prompt SHALL contain only the change scope, specialist charter, required evidence commands, artifact path, verdict format, and explicit confirm-only scope when applicable. Shared policy explanations SHALL be referenced once through the repository contract rather than duplicated in every specialist prompt.

#### Scenario: Prompt length remains bounded
- **WHEN** the full reviewer roster is dispatched for a wave
- **THEN** each prompt contains the common fields and specialist checks without repeating the full execution policy

### Requirement: No-op reviewer recovery is bounded
A reviewer with no evidence of review work or no required artifact SHALL fail the gate, receive at most one corrected retry, and then be replaced or left pending with a recorded reason. A corrected retry SHALL carry the same review-wave identity plus a changed bounded condition, such as a reduced context, corrected namespace, or explicit resumed quota state. The orchestrator SHALL not perform unbounded identical reviewer retries.

#### Scenario: Reviewer exits without an artifact
- **WHEN** a reviewer exits successfully but writes no matching review artifact
- **THEN** the sentinel remains pending, one corrected retry is permitted, and a third identical retry is prohibited

#### Scenario: Reviewer start is never observed
- **WHEN** a reviewer dispatch has no started event within the bounded start window
- **THEN** the attempt is recorded as failed-start and only one corrected retry is allowed

#### Scenario: Quota blocks a reviewer
- **WHEN** a reviewer cannot run because the session quota is exhausted
- **THEN** the attempt is recorded as quota-blocked and resumable, not treated as an ordinary successful retry or completed review

### Requirement: Wave reviewers dispatch as one consolidated parallel batch
All reviewers applicable to an implementation wave (code, database, doc, and any sentinel-armed specialists) SHALL be dispatched in a single parallel round. A second review round for the same wave SHALL require either new substantive scope or an explicit escalation decision.

#### Scenario: Wave touches code, SQL, and docs
- **WHEN** an implementation wave arms `.pending-review`, `.pending-db-review`, and `.pending-doc-review`
- **THEN** code-reviewer, database-reviewer, and doc-reviewer are dispatched together in one parallel batch, not as sequential separate rounds

#### Scenario: Codex-bridge review is escalation-only
- **WHEN** a goal session explicitly requests `--second-opinion=codex-exec`
- **THEN** `codex-bridge` review is dispatched at most once per change and only as an explicit escalation (high-stakes path), never as a default extra round on top of the consolidated batch; retired `CODEX=on`/`--codex` flags do not dispatch it

### Requirement: Review telemetry distinguishes attempts, verdicts, and artifacts
The orchestrator SHALL report reviewer dispatch attempts, started/completed verdicts, fresh artifacts, retries, and unresolved obligations as separate counters keyed by role and review-wave identity. Spawn count alone SHALL not be presented as completed review coverage.

#### Scenario: A dispatch attempt produces no start
- **WHEN** a reviewer spawn is issued but no started event or artifact appears
- **THEN** it increments attempts and failed-start counters but not completed verdicts or fresh artifacts

#### Scenario: One reviewer produces a fresh verdict
- **WHEN** a reviewer starts and writes one fresh artifact with a parseable verdict
- **THEN** attempts, completed verdicts, and fresh artifacts each reflect one event

### Requirement: Re-review requires changed scope or explicit escalation
A confirm-only re-review SHALL carry the prior finding set and the current scope/diff identity. The same role SHALL not be dispatched again for an unchanged wave unless the coordinator records an explicit failed-start, quota, or escalation reason.

#### Scenario: Missing artifact is corrected once
- **WHEN** a reviewer has one missing-artifact attempt and a corrected bounded retry produces a fresh artifact
- **THEN** the retry is linked to the same wave and no identical third attempt is dispatched

#### Scenario: No new scope exists
- **WHEN** a clean verdict already has fresh evidence for the current wave and no files changed
- **THEN** the orchestrator does not dispatch another full review
