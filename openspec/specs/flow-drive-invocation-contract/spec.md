# flow-drive-invocation-contract Specification

## Purpose

Define Flow Drive's portable native task entry and read-only help boundary.

## Requirements

### Requirement: Explicit task input and read-only help

Flow Drive SHALL accept one bounded task as text, a task-file path, or a
confirmed specification/change ID. Its only invocation option SHALL be
read-only `--help`. Help SHALL describe the task entry and migration path
without changing the consumer project. Missing, ambiguous, or unreadable task
input and missing acceptance or write-scope decisions SHALL be reported before
dependent edits.

#### Scenario: A bounded task is supplied

- **WHEN** one task input identifies its intended outcome and scope
- **THEN** the current Host and Model perform the task within the user's
  authorization and the consumer project's conventions

#### Scenario: Help is requested

- **WHEN** the user invokes `$flow-drive --help`
- **THEN** the current invocation and migration information are shown without
  project changes

#### Scenario: A retired invocation option is supplied

- **WHEN** a retired Flow Drive selector or option is used as invocation syntax
- **THEN** the invocation is identified as unsupported, points to the migration
  reference and pinned legacy release, and does not begin task writes

#### Scenario: A flag appears inside task content

- **WHEN** a task, task file, or confirmed specification mentions text such as
  `--worker=codex` as content to inspect or modify
- **THEN** that text remains task data and is not parsed as a Flow Drive option

### Requirement: Native execution preserves task authority and evidence

Flow Drive SHALL use the current Host and Model's ordinary tools. It SHALL
confirm the intended outcome, acceptance criteria, requested scope, and user
authority; honor the consumer project's Project Convention; keep edits within
the authorized scope; and report the verification actually observed or a
precise blocker. Missing tools, failed checks, and unavailable verification
SHALL remain visible as gaps rather than being described as passes.

#### Scenario: A dependent write lacks a prerequisite

- **WHEN** a necessary cause, decision, acceptance criterion, or write scope is
  unresolved
- **THEN** Flow Drive resolves the material prerequisite or reports a blocker
  before dependent writes

#### Scenario: Verification cannot run or fails

- **WHEN** an applicable verification check is unavailable or returns failure
- **THEN** the outcome reports that observed result and any remaining gap

### Requirement: The canonical directory is independently usable

The canonical Flow Drive directory SHALL contain only its skill entry,
supported Host metadata, distribution declaration, and migration reference.
Using it SHALL NOT require a dhpk checkout or build, resource synchronization,
a sibling public skill, an invocation parser, an external CLI runner, or a
Flow Drive-specific execution receipt. Shared dispatch support used by other
roles SHALL be owned and distributed outside the Flow Drive directory.

#### Scenario: The source directory is copied by itself

- **WHEN** a consumer copies the complete canonical Flow Drive directory into
  its native skill location
- **THEN** the task entry and its migration reference remain available without
  resolving any dhpk checkout or sibling skill

### Requirement: Retired interfaces have one migration source

The migration reference SHALL list retired Flow Drive invocation options,
aliases, and programmatic runner API; state their current unsupported
disposition; and identify the pinned `v0.66.7` release for users who require
those interfaces. The current Flow Drive package SHALL NOT carry a second
compatibility engine. This change SHALL NOT claim to fix defects in the older
parser or runner.

#### Scenario: A user needs a retired interface

- **WHEN** a user requires a retired option or programmatic API
- **THEN** the migration reference directs them to the pinned legacy release
  and explains the current interface boundary
