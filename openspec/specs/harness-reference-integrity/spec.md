# harness-reference-integrity Specification

## Purpose
TBD - created by archiving change harness-consistency-audit. Update Purpose after archive.
## Requirements
### Requirement: Rule-file references resolve

Every `@rules/<file>` reference in shipped harness markdown (`skills/`, `commands/`, `agents/`, `rules/`, `modules/*/{skills,commands,agents}/`) SHALL resolve to an existing file under `rules/`. The reference-integrity check SHALL fail when a referenced rule file does not ship.

#### Scenario: A skill references a rule that does not ship

- **WHEN** a shipped SKILL.md contains `@rules/auto-loop.md` and `rules/auto-loop.md` does not exist
- **THEN** the reference-integrity check reports the file, line, and missing target, and exits non-zero

#### Scenario: All rule references resolve

- **WHEN** every `@rules/<file>` reference points at a file present in `rules/`
- **THEN** the reference-integrity check passes for the rule-reference class

### Requirement: Slash-command references resolve

Every `/dhpk:<name>` reference in shipped harness markdown SHALL resolve to a registered command (`commands/<name>.md` or a registered module command) or a shipped skill (`skills/<name>/SKILL.md` or a registered module skill). Imperative handoff phrases such as `invoke`, `run`, or `use` followed by a named capability SHALL resolve through the same canonical registry. The check SHALL fail on a reference whose target does not exist, unless the reference is listed in an explicit whitelist of intentional examples or an explicit alias map resolves it to a canonical target.

#### Scenario: Docs reference a command name that does not resolve

- **WHEN** shipped markdown references `/dhpk:setup` and no registered command or skill named `setup` exists
- **THEN** the reference-integrity check reports the dangling reference and exits non-zero

#### Scenario: An intentional example is whitelisted

- **WHEN** a doc illustrates a hypothetical command listed in the whitelist
- **THEN** the reference-integrity check skips it and does not fail

#### Scenario: A natural-language handoff names a missing capability

- **WHEN** a workflow says to invoke `compact-save` but no skill or command with that canonical name is registered
- **THEN** validation reports the line and requires a supported replacement or an explicit optional-capability gate

#### Scenario: A legacy alias has a canonical replacement

- **WHEN** a workflow names `opsx-post-obs` and the registry defines `dhpk-opsx-post-observation`
- **THEN** validation requires the canonical name or an alias-map entry that resolves to it

### Requirement: Script path references resolve

Explicit repo-path references of the form `scripts/…`, `hooks/…`, or `${CLAUDE_PLUGIN_ROOT}/<path>` in shipped harness markdown SHALL resolve to existing files in the repository. The check SHALL fail on a path reference whose target does not exist, unless whitelisted as a consumer-side illustration.

#### Scenario: A command references a deleted script

- **WHEN** a shipped command references `scripts/lib/pre-route.sh` and that file has been removed
- **THEN** the reference-integrity check reports the dangling path and exits non-zero

### Requirement: Shipped assets carry no predecessor-brand strings

Shipped harness assets (`skills/`, `commands/`, `agents/`, `rules/`, `modules/*/**`, and `docs/` excluding `docs/design/` history) SHALL NOT contain the predecessor brand on a `sd0x` word boundary (covering `sd0x-dev-flow`, `.sd0x`, and `sd0x_version`). The reference-integrity check SHALL fail on any such occurrence outside a two-part whitelist: (a) CHANGELOG history and frozen `docs/design/` provenance, and (b) an enumerated set of intentional back-compat legacy-read references (the installer reads the pre-rename manifest path/key once for migration).

#### Scenario: A command still names the pre-rename plugin

- **WHEN** a shipped command globs `~/.claude/plugins/**/sd0x-dev-flow/...` or writes `.sd0x/install-state.json`
- **THEN** the reference-integrity check reports the file, line, and brand string, and exits non-zero

#### Scenario: CHANGELOG history is exempt

- **WHEN** `CHANGELOG.md` or a `docs/design/**` artifact records the historical `sd0x-dev-flow` name
- **THEN** the check treats it as whitelisted and does not fail

#### Scenario: An enumerated back-compat legacy-read is exempt

- **WHEN** a shipped installer skill reads the legacy `.sd0x/install-state.json` / `sd0x_version` for one-time migration and that line is listed in the guard's back-compat whitelist
- **THEN** the check treats it as whitelisted and does not fail

### Requirement: Reference integrity is wired into the test suite

The reference-integrity check SHALL run as part of the repository's standard test entry point (`node tests/run-all.js`), so CI fails on any dangling reference introduced by a change.

#### Scenario: CI catches a newly introduced dangling reference

- **WHEN** a pull request adds a skill referencing a non-existent rule file and CI runs the test suite
- **THEN** the suite fails with the reference-integrity finding
