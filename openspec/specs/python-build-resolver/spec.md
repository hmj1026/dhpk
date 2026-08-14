# python-build-resolver Specification

## Purpose
TBD - created by archiving change dhpk-add-meta-toolkit-agents. Update Purpose after archive.
## Requirements
### Requirement: Agent is triggered by Python build failures via AI-judgment back-stop
The `python-build-resolver` agent SHALL be invoked by Claude when Bash output contains a Python build failure pattern: `ruff` lint errors, `mypy` type errors, `pytest` failures (including `pytest-asyncio` scope errors), or `pip install` / `uv` resolution failures. This is an AI-judgment back-stop, not a sentinel.

#### Scenario: mypy type error in bash output
- **WHEN** a Bash tool call returns output containing `error:` lines typical of mypy
- **THEN** Claude invokes `dhpk:python-build-resolver` to diagnose and fix

#### Scenario: ruff lint failure in bash output
- **WHEN** a Bash tool call returns output containing ruff lint errors
- **THEN** Claude invokes `dhpk:python-build-resolver` to apply ruff-compliant fixes

#### Scenario: pytest-asyncio event loop scope error
- **WHEN** pytest output contains `ScopeMismatch` or `event_loop` related asyncio errors
- **THEN** Claude invokes `dhpk:python-build-resolver` to fix the scope annotation

### Requirement: Agent fixes the build in at most 3 attempts
The `python-build-resolver` agent SHALL attempt to fix the failing command. After each fix it SHALL re-run the original failing command to verify. If the build still fails after 3 consecutive attempts, the agent SHALL stop and escalate to the user with a summary of what was tried.

#### Scenario: Fix succeeds on first attempt
- **WHEN** the fix resolves the build error
- **THEN** agent reports success and stops; no further attempts made

#### Scenario: 3 attempts all fail
- **WHEN** 3 consecutive fix attempts each result in a continued build failure
- **THEN** agent stops, outputs a summary of all attempted fixes and remaining errors, and asks the user for direction — it does NOT make a 4th attempt

### Requirement: Agent uses surgical edits — minimum code changes
The `python-build-resolver` agent SHALL apply the minimum edit required to fix the reported error. It SHALL NOT reformat unrelated code, reorganize imports beyond what the failing linter demands, or change logic outside the reported error scope.

#### Scenario: mypy error in one function
- **WHEN** mypy reports an error in function `foo`
- **THEN** agent edits only `foo` (and its type annotations); no other functions are touched

### Requirement: Route-table advisory pattern for Python build failures
`route-table.json` SHALL include an ERE pattern matching common Python build failure phrases, routing to `dhpk:adaptive-dev-workflow` as a hint. This advisory fires before the user explicitly invokes the agent.

#### Scenario: User types "fix mypy errors"
- **WHEN** the user submits a prompt matching `fix\s+(mypy|ruff|pytest)` (case-insensitive)
- **THEN** `userpromptsubmit-skill-hint.sh` emits an advisory mentioning adaptive-dev-workflow

### Requirement: Agent registered in plugin.json and INDEX.md
The `python-build-resolver` agent SHALL appear in `.claude-plugin/plugin.json` `agents[]` and in `agents/INDEX.md` so it is available as `dhpk:python-build-resolver` after plugin install.

#### Scenario: After plugin install, subagent_type is available
- **WHEN** dhpk plugin is installed
- **THEN** `dhpk:python-build-resolver` is available as a subagent_type in Claude Code
