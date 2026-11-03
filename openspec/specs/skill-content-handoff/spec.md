# skill-content-handoff Specification

## Purpose

Define an opt-in, data-only `.scratch/<slug>/` convention that lets one skill's
report reach a later skill or session without creating a skill dependency,
gate, or routing input.

## Requirements

### Requirement: Handoff files use one fixed path per producer

A skill that saves handoff content SHALL write it to
`.scratch/<slug>/<fixed-name>.md` relative to the project root, where
`<fixed-name>` is declared once by that producing skill and `<slug>` defaults
to the producer's documented key and is overridable by the user (REQ-1).

#### Scenario: Issue analysis uses its default slug

- **WHEN** a user asks `issue-analyze` to save its analysis of issue 42
- **THEN** the content targets `.scratch/issue-42/issue-analysis.md`

#### Scenario: User overrides the slug

- **WHEN** the user names the slug `auth-redesign` for the same save
- **THEN** the content targets `.scratch/auth-redesign/issue-analysis.md`

### Requirement: Handoff front-matter is free text

A handoff file SHALL begin with front-matter containing only `producer`,
`created`, `status`, and `next`, and every value SHALL be free text for a human
reader (REQ-2).

#### Scenario: A saved file carries the four keys

- **WHEN** a producer saves a handoff file
- **THEN** its front-matter has exactly the keys `producer`, `created`,
  `status`, and `next`

### Requirement: Handoff files are written only on request

A producer SHALL write or emit a handoff file only when the user explicitly
asks to save or hand off the result. Without that request the producer SHALL
return its normal chat output, and the absence of a handoff file SHALL NOT
change any skill's behavior (REQ-3).

#### Scenario: No request, no file

- **WHEN** `proposal-analyze` runs without a save request
- **THEN** it returns the roadmap in chat and creates nothing under `.scratch/`

### Requirement: Handoff files never control execution

No skill, `flow-guide` action, hook, or script SHALL read `.scratch/` to gate,
route, authorize, or select a next action. A handoff file is data only and
grants no execution authority (REQ-4).

#### Scenario: Flow Guide ignores the scratch directory

- **WHEN** `flow-guide` computes `next`, `route`, or `close` in a repository
  that contains `.scratch/` files
- **THEN** its result is identical to the result without those files

### Requirement: Read-only producers do not gain write authority

A producer whose description is read-only SHALL NOT receive a Write tool for
this convention. When asked to save, it SHALL emit the complete file content
with its target path for the Host to write (REQ-5).

#### Scenario: Issue analysis emits content

- **WHEN** a user asks `issue-analyze` to save its analysis
- **THEN** the skill outputs the target path and full file content, and its
  allowed tools still exclude Write

### Requirement: Producers name the intended consumer

Each producer SHALL state in its own skill text which consumer the saved file
is shaped for, without loading or requiring that consumer (REQ-6).

#### Scenario: Proposal analysis names its consumer

- **WHEN** a reader opens the `proposal-analyze` save instructions
- **THEN** they name the intended consumer and contain no instruction to load
  another skill

### Requirement: Apply resume uses one Host-neutral path

`opsx-apply-resume` SHALL save to `.scratch/<change-id>/apply-resume.md` on
every Host. On resume, when that file is absent, it SHALL read
`.claude/artifacts/apply-resume/latest.md` and then
`.dhpk/artifacts/apply-resume/latest.md` as legacy fallbacks (REQ-7).

#### Scenario: Save on one Host, resume on another

- **WHEN** Claude Code saves progress for change `c1` and Codex CLI resumes it
- **THEN** both resolve `.scratch/c1/apply-resume.md`

#### Scenario: Legacy handoff still resumes

- **WHEN** only `.claude/artifacts/apply-resume/latest.md` exists
- **THEN** resume reads it as the handoff
