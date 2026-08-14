# opsx-goal-condition-economy Specification

## Purpose
TBD - created by archiving change harvest-advice-20260712. Update Purpose after archive.
## Requirements
### Requirement: The emitted goal condition contains only evaluator-scorable material
The `/goal` condition emitted by `skills/opsx-apply-goal` SHALL contain a compact fixed core — one orientation instruction, the opsx:apply kickoff with its hard-rule carve-out and Unknown-skill fallback, a self-locating execution-policy pointer, and a compact worker roster — plus only change-scaled clauses that can be checked from transcript evidence, files, commands, sentinels, verdicts, or bounded turns. Explanations already stored in repository policy or contracts SHALL be referenced, not repeated. Required safety and verification gates SHALL not be omitted for length economy.

#### Scenario: Policy prose is referenced once
- **WHEN** the generator emits a dispatch-enabled goal
- **THEN** Part 0 contains the policy pointer and compact roster without repeating the full execution-policy routing or CODEX explanation

#### Scenario: Every emitted clause is checkable
- **WHEN** the generated condition is inspected
- **THEN** each clause names observable evidence such as a command result, file state, sentinel, verdict, or turn limit

### Requirement: The composed goal length never structurally approaches the cap
The generator SHALL expose a measured budget with a normal target of at most 3,400 UTF-8 bytes and a hard cap of 4,000 bytes. Fixed prose SHALL be short enough that change-scaled verification gates have a documented reserve; representative fixtures SHALL cover the minimum, normal, and maximum gate combinations.

#### Scenario: Representative full variant
- **WHEN** a representative change has one test runner and standard review gates
- **THEN** the measured full goal is at most 3,400 bytes and emits without regeneration

#### Scenario: Maximum supported gate fixture
- **WHEN** all supported test, smoke, artifact, and review gate tokens are present
- **THEN** the fixture either remains at or under 4,000 bytes or fails with the measured hard-stop result; it never silently drops a required gate

### Requirement: Exceeding the length cap is a hard generation error, not a substitution branch
The generator SHALL keep the scratch-file and `wc -c` guard. A composed string exceeding 4,000 UTF-8 bytes SHALL produce the Block A hard-stop notice, no `/goal` output, and a regression signal for the template or gate fixture that caused the excess. No alternate branch may remove required safety or verification content.

#### Scenario: Over-cap generation halts loudly
- **WHEN** a composed goal measures over 4,000 bytes
- **THEN** the skill reports the measured length and blocking cause without emitting a shortened unsafe goal

### Requirement: Goal string carries a bounded task digest
The goal generator SHALL compose a `<TASK_DIGEST>` — open-task section headers or first open task titles, deterministically truncated to at most 200 UTF-8 bytes — from the tasks.md it already read, and embed it in the emitted goal string. The composed goal (including the digest and the CLI-tier and consolidated-review clauses) SHALL still satisfy the existing byte-budget requirement.

#### Scenario: Digest replaces re-orientation
- **WHEN** the generator emits a goal for a change whose tasks.md has open tasks
- **THEN** the goal string contains a `<TASK_DIGEST>` of ≤200 bytes and the budget test fixture remains within the enforced cap

#### Scenario: Oversized task list
- **WHEN** open-task titles exceed 200 bytes
- **THEN** the digest is truncated deterministically (no over-cap emission, no generation error caused by the digest alone)
