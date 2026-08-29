# do-worker-reasoner-flags Specification

## Purpose
TBD - created by archiving change do-flags-and-harness-consolidation. Update Purpose after archive.
## Requirements
### Requirement: `--worker` flag replaces `--fast-worker` with hard removal

`dhpk-do` through either host entry and `dhpk:opsx-apply-goal` SHALL accept
`--worker=<claude|codex|agy|auto>`, strip it before matching, and preserve
precedence flag > userConfig > Claude default. Legacy `--fast-worker` SHALL
remain ordinary query text with no alias. The context name remains
`WORKER_OVERRIDE`.

#### Scenario: New flag resolves the backend
- **WHEN** either entry receives `--worker=codex`
- **THEN** selector resolves Codex subject to availability and query excludes the flag

#### Scenario: Legacy flag is not recognized
- **WHEN** `--fast-worker=codex` occurs
- **THEN** it remains ordinary query text

#### Scenario: No dangling references remain
- **WHEN** implementation completes
- **THEN** no live command, skill, rule, README, or goal template describes `--fast-worker` as supported

### Requirement: `--reasoner` flag selects the deep-reasoning backend

`dhpk-do` SHALL accept
`--reasoner=<claude|codex>[:<model>[:<effort>]]`, strip it, and preserve explicit
segments > backend config > defaults. Invalid backend warns and falls back to
configured/default resolution. Non-implementation routes emit one ignore line.
Missing Codex executable may use the existing Claude-reasoner fallback with
requested/selected evidence; auth, model, task, and execution failures remain
`BLOCKED`.

#### Scenario: Bare codex backend uses defaults
- **WHEN** `--reasoner=codex` has no configured override
- **THEN** documented Codex defaults are used

#### Scenario: Full segment override
- **WHEN** `--reasoner=codex:gpt-5.6-sol:medium` occurs
- **THEN** those values override configuration

#### Scenario: Unsupported backend warns and falls back
- **WHEN** backend is `agy`
- **THEN** one warning is emitted and configured/default resolution proceeds

#### Scenario: Non-implementation route ignores the flag
- **WHEN** the target is not implementation-class
- **THEN** one ignore line is emitted and routing proceeds

#### Scenario: Missing codex CLI falls back to claude reasoner
- **WHEN** Codex executable is missing
- **THEN** Claude reasoner is selected with requested/selected backend evidence
- **AND** other Codex failures do not fall back
