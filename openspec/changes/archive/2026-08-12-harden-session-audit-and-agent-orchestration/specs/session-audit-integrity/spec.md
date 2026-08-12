## ADDED Requirements

### Requirement: Runtime findings use typed evidence predicates
The session audit SHALL classify records by source and runtime record type before finding detection. A finding SHALL require a typed failure predicate such as a non-zero exit, structured error status, hook-timeout status, or an explicitly registered equivalent. Text found only in user prompts, inherited instructions, memory, historical summaries, or successful hook output SHALL NOT create a runtime failure finding.

#### Scenario: Successful hook contains historical timeout wording
- **WHEN** a hook record has `type=hook_success`, exit code 0, and stdout containing the words `timed out`
- **THEN** the detector emits no hook-timeout runtime finding

#### Scenario: Structured non-zero hook failure is present
- **WHEN** a hook record identifies a hook failure with a non-zero exit status
- **THEN** the detector emits a finding tied to that record and its stable event identity

#### Scenario: User prompt repeats a pending reminder
- **WHEN** a user prompt or inherited child prompt contains `sentinel pending` but no typed runtime failure record exists
- **THEN** the text is retained as context evidence and is not counted as an independent runtime failure

### Requirement: Source coverage is explicit and complete before an audit claims completeness
The collector SHALL discover the configured Codex home, the active Orca account home(s) explicitly selected by the host configuration under `~/.config/orca/codex-accounts/<account>/home/sessions`, Claude project transcripts, and every declared optional source. It SHALL NOT wildcard-scan unrelated account homes. The report SHALL expose `scanComplete`, `sourceCoverageComplete`, `malformedCount`, `unsupportedCount`, and omitted-source reasons independently. `partial=false` SHALL NOT imply `sourceCoverageComplete=true` when a known source is omitted or unsupported.

#### Scenario: Configured active Orca Codex sessions are discovered
- **WHEN** the host configuration selects an Orca account containing session JSONL under its account home
- **THEN** the source inventory includes that account's sessions with a redacted account identifier

#### Scenario: Unselected Orca account is not scanned
- **WHEN** another account home exists under `codex-accounts/` but is not selected by the host configuration
- **THEN** the collector omits it and records no false completeness claim about that unselected account

#### Scenario: A known store cannot be read
- **WHEN** a declared session store is present but unreadable
- **THEN** the report records an omitted-source reason and marks source coverage incomplete without claiming a clean scan

#### Scenario: All declared sources are scanned
- **WHEN** every declared source is scanned and no unsupported record kind remains
- **THEN** `sourceCoverageComplete` is true independently of the malformed-record count

### Requirement: Verification is bound to the finding symptom
Each finding definition SHALL provide a stable fingerprint, an observable reproduction assertion, and a consumer-gate assertion. Verification SHALL be marked `verified` only when the reproduction observes the finding's expected symptom and the consumer gate observes the expected absence or remediation state. Tool availability, generic help output, date scans, and exit status alone SHALL not verify a finding.

#### Scenario: Generic commands cannot verify a sentinel finding
- **WHEN** a finding has reproduction `--help` and a consumer gate that only reruns a date scan
- **THEN** verification remains `unverified` or `blocked` because no sentinel symptom assertion was evaluated

#### Scenario: Reproduction and consumer assertions pass
- **WHEN** the finding-specific reproduction observes the expected failure and the consumer gate observes its documented remediation
- **THEN** the finding becomes `verified` with both assertion results recorded

#### Scenario: One assertion fails
- **WHEN** either the symptom reproduction or consumer-gate assertion fails
- **THEN** the finding cannot be marked `verified` and the report records which assertion failed

### Requirement: Agent inventory counts identify unique roles separately from installation rows
The audit SHALL report installation rows, unique canonical role identities, and excluded index/cache rows as separate fields. A displayed agent count SHALL declare which identity scope it measures and SHALL exclude `INDEX` or other non-role records from unique-role counts.

#### Scenario: Multiple cached copies exist
- **WHEN** one role appears in several plugin versions or publication surfaces
- **THEN** installation rows may increase while the unique canonical-role count remains one

#### Scenario: An index record is encountered
- **WHEN** an `INDEX` file is included in an installation inventory
- **THEN** it is reported as an excluded non-role row and does not increase the unique-role count

### Requirement: Audit candidates preserve provenance without overstating failures
The collector SHALL retain raw candidate provenance, including source path, record identity, role/task identity, and reason for classification, while distinguishing `candidate`, `unverified`, `verified`, `blocked`, and `false-positive-suppressed` states. Historical or ambiguous evidence SHALL remain inspectable but SHALL NOT be summarized as a confirmed runtime failure.

#### Scenario: Ambiguous text match is retained
- **WHEN** text matches a finding pattern but no typed failure predicate is present
- **THEN** the candidate is retained with an ambiguity reason and excluded from confirmed-failure totals

#### Scenario: Confirmed failure is deduplicated
- **WHEN** the same event is repeated in parent and child records with one stable task identity
- **THEN** it counts once in confirmed occurrences and retains parent/child provenance links
