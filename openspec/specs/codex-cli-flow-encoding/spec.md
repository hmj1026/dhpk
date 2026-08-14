# codex-cli-flow-encoding Specification

## Purpose
TBD - created by archiving change codex-flow-parity-and-do-openspec-flag. Update Purpose after archive.
## Requirements
### Requirement: Codex CLI receives instruction-based main-flow discipline

dhpk's main-flow discipline SHALL be expressed for Codex CLI as instruction-based content
in `codex/AGENTS.md` (and, where registration is needed, `config.toml.example`), because
Codex CLI has no hooks, slash commands, or sentinel-review mechanism. This content
SHALL cover: how to select a workflow from a natural-language task without slash commands,
which review role to invoke after code edits (in place of the sentinel gate), and a map
from the dhpk agent roster to the available Codex roles. It SHALL NOT fabricate
hook/slash/sentinel mechanisms that Codex does not support.

#### Scenario: Routing guidance exists for Codex
- **WHEN** a Codex CLI user reads `codex/AGENTS.md`
- **THEN** it describes how to map a task to a workflow instruction-style (no reliance on
  `/dhpk:do` or other slash commands)

#### Scenario: Review discipline expressed without sentinels
- **WHEN** a Codex user finishes a code edit
- **THEN** `codex/AGENTS.md` instructs invoking the appropriate review role (e.g. the
  code-reviewer role via `/agent`), standing in for the Claude sentinel gate
- **AND** the guidance does not claim Codex fires PostToolUse/Stop hooks or `.pending-*`
  sentinels

#### Scenario: Agent roster mapping is documented
- **WHEN** a Codex user wants a specialist role
- **THEN** `codex/AGENTS.md` provides a map from dhpk agent names to the codex roles that
  are available after sync
- **AND** roles that are Claude-only (excluded from the curated fork) are identified as
  unavailable in Codex

#### Scenario: Key-Differences table is present
- **WHEN** a Codex user reads `codex/AGENTS.md`
- **THEN** it contains a "Key Differences from Claude Code" table (no hooks, AGENTS.md-only,
  instruction-based invocation vs slash commands, multi-agent `/agent` vs Task subagents),
  mirroring ECC's proven `.codex/AGENTS.md` structure
- **AND** it states that `sandbox_mode` is the only hard enforcement primitive Codex offers,
  and that review/security discipline is therefore instruction-based

### Requirement: Generated roles are registered for Codex discovery

Each generated codex agent role SHALL be discoverable by Codex CLI after
`install-codex-skills.sh` runs — either through the synced `.codex/agents/` tree or an
explicit `config.toml.example` registration — without requiring the user to hand-edit role
wiring.

#### Scenario: New roles are available after sync
- **WHEN** a user runs `install-codex-skills.sh` (or `--update`) after this change ships
- **THEN** the curated codex agent roles are present under `.codex/agents/`
- **AND** entering Codex CLI exposes them for invocation with no manual configuration
