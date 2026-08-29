# codex-cli-flow-encoding Specification

## Purpose
TBD - created by archiving change codex-flow-parity-and-do-openspec-flag. Update Purpose after archive.
## Requirements
### Requirement: Codex CLI receives instruction-based main-flow discipline

Codex SHALL receive main-flow discipline through explicit `$dhpk-do` plus
instruction fallback in `codex/AGENTS.md`. Guidance SHALL distinguish Codex
built-in commands/hooks from unsupported dhpk custom slash commands and Claude
sentinels, map discovered roles, and report unavailable capability honestly.

#### Scenario: Routing guidance exists for Codex
- **WHEN** `dhpk-do` is discovered
- **THEN** guidance names `$dhpk-do <task>` as the single entry and never claims `/dhpk:do` exists in Codex

#### Scenario: Review discipline expressed without sentinels
- **WHEN** Codex completes an edit
- **THEN** guidance requires the applicable discovered review role without claiming Claude sentinels enforce it

#### Scenario: Agent roster mapping is documented
- **WHEN** a specialist is needed
- **THEN** discovered roles and unavailable Claude-only roles are distinguished

#### Scenario: Key-Differences table is present
- **WHEN** a reader compares hosts
- **THEN** the table distinguishes built-in commands/hooks, `$dhpk-do`, `/agent`, sandbox enforcement, and instruction fallbacks

#### Scenario: Portable entry is unavailable
- **WHEN** `$dhpk-do` is not discovered
- **THEN** instruction routing remains available without a false callable claim

### Requirement: Generated roles are registered for Codex discovery

Each curated Codex role or skill with a declared direct-publication outcome
SHALL be discoverable after sync through its declared tree/native registration.
A capability-gated or shared-runner outcome SHALL remain explicit in the
coverage matrix and SHALL NOT require a native role file. Discovery for one
component type SHALL NOT prove another callable.

#### Scenario: New roles are available after sync
- **WHEN** install/update runs after publication
- **THEN** directly published curated roles exist under `.codex/agents/` and
  `dhpk-do` under `.codex/skills/` with separate identities
- **AND** a capability-gated `codex-reviewer` shared-runner outcome is not
  misreported as a missing native role or callable Codex-host target
