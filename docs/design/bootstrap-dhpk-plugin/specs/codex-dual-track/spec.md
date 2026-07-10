## ADDED Requirements

### Requirement: Plugin ships Codex content under codex/

The plugin SHALL ship a `codex/` directory at plugin root containing:

- `codex/skills/` — Codex-CLI-format skill mirrors of `skills/` content (frontmatter and structure adjusted for Codex CLI)
- `codex/agents/` — Codex-CLI-format agent definitions: 11 roles total, comprising 4 hand-maintained generic roles (`explorer`, `worker`, `monitor`, `bug-investigator`) plus 7 roles generated from the canonical Claude agents (`architect`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `tdd-guide`, `deep-reasoner`, `doc-reviewer`) by `scripts/gen-codex-agents.js`. Every `codex/agents/*.toml` file MUST declare non-empty `name`, `description`, and `developer_instructions`.
- `codex/config.toml.example` — example Codex CLI configuration with project-specific values redacted
- `codex/README.md` — documentation explaining the dual-track install procedure and the relationship with the install script

Claude Code SHALL NOT auto-load anything inside `codex/` — no manifest entry, hook, rule, or skill references the directory at install time.

#### Scenario: Plugin install does not register Codex content with Claude Code

- **WHEN** the plugin is installed and `/agents`, `/plugin details dhpk` are inspected
- **THEN** no Codex Explorer / Monitor / Worker agents appear in the Claude Code UI

#### Scenario: Codex README documents install flow

- **WHEN** `codex/README.md` is read
- **THEN** it explains: (1) Claude Code ignores `codex/`, (2) how to run `install-codex-skills.sh` from a project root, (3) symlink vs copy modes, (4) how `.dhpk-installed.json` tracks installed version

#### Scenario: Codex agent role files satisfy the required-field contract

- **WHEN** any file under `codex/agents/*.toml` is inspected
- **THEN** it declares non-empty `name`, `description`, and `developer_instructions` fields
- **AND** the `validate_codex` guardrail fails the build if any of the three fields is missing or empty

#### Scenario: Generator produces the 7 canonical-derived roles deterministically

- **WHEN** `node scripts/gen-codex-agents.js` is run against the curated 7-agent allowlist in `agents/`
- **THEN** it (re)writes `codex/agents/{architect,code-reviewer,security-reviewer,database-reviewer,tdd-guide,deep-reasoner,doc-reviewer}.toml`
- **AND** re-running it with no change to the source `agents/<name>.md` files produces byte-identical output
- **AND** it does not modify the 4 hand-maintained roles (`explorer`, `worker`, `monitor`, `bug-investigator`)

### Requirement: install-codex-skills.sh syncs codex/ into project .codex/

`scripts/hooks/install-codex-skills.sh` SHALL, when invoked from a project root:

- Create `.codex/skills/` and `.codex/agents/` if missing
- Symlink (default) or copy (`--copy` flag) each item under `${CLAUDE_PLUGIN_ROOT}/codex/skills/` and `${CLAUDE_PLUGIN_ROOT}/codex/agents/` into the corresponding project `.codex/` location
- Copy `${CLAUDE_PLUGIN_ROOT}/codex/config.toml.example` to `.codex/config.toml.example` (never overwrite an existing `config.toml`)
- Write `.codex/.dhpk-installed.json` with `{"plugin_version": "<from plugin.json>", "installed_at": "<ISO-8601>", "mode": "symlink|copy"}`
- Be idempotent: re-running without `--update` is a no-op when the recorded version matches the plugin's current version; running with `--update` re-syncs and rewrites the manifest

The script SHALL exit non-zero (with a clear stderr message) if invoked outside a directory that looks like a project root (heuristic: has `.git/` OR `.claude/` OR `package.json` OR `composer.json`). The check can be bypassed with `--force`.

#### Scenario: Fresh install creates symlinks

- **WHEN** `install-codex-skills.sh` is run in a project with no `.codex/`
- **THEN** `.codex/skills/<each-skill>` exists as a symlink pointing into `${CLAUDE_PLUGIN_ROOT}/codex/skills/`
- **AND** `.codex/.dhpk-installed.json` exists with mode `"symlink"` and the plugin's current version

#### Scenario: Re-run is a no-op when version unchanged

- **WHEN** `install-codex-skills.sh` is run twice consecutively with the plugin version unchanged
- **THEN** the second run prints `already up-to-date for dhpk vX.Y.Z` and exits 0 without modifying any file

#### Scenario: Update mode resyncs after version bump

- **WHEN** the plugin is updated to a new version AND `install-codex-skills.sh --update` is run
- **THEN** stale symlinks are recreated AND `.dhpk-installed.json` records the new version

#### Scenario: --copy mode creates regular files

- **WHEN** `install-codex-skills.sh --copy` is run
- **THEN** `.codex/skills/<skill>` is a regular directory (not a symlink) AND `.dhpk-installed.json` mode is `"copy"`

#### Scenario: Refuses to run outside a project root

- **WHEN** `install-codex-skills.sh` is run in `$HOME` (no `.git/`, `.claude/`, `package.json`, `composer.json`)
- **THEN** it exits non-zero with a stderr message naming the missing markers and suggesting `--force`

#### Scenario: Does not overwrite existing config.toml

- **WHEN** `install-codex-skills.sh` is run in a project where `.codex/config.toml` already exists
- **THEN** it copies the example as `.codex/config.toml.example` only, leaving the user's `config.toml` untouched
