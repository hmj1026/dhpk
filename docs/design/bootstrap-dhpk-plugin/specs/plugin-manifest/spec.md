## ADDED Requirements

### Requirement: Plugin manifest declares plugin identity and metadata

The plugin SHALL live at `plugins/dhpk/.claude-plugin/plugin.json` (NOT the repo root) and provide `name: "dhpk"`, `displayName`, `version` (semver, starting `0.1.0`), `description`, `author`, `keywords`, and `$schema` pointing at the Claude Code plugin manifest JSON schema.

#### Scenario: Validate passes on fresh plugin

- **WHEN** `claude plugin validate /home/paul/projects/dhpk/plugins/dhpk --strict` is run AND `claude plugin validate /home/paul/projects/dhpk --strict` is run (marketplace)
- **THEN** both commands exit 0 with no warnings or errors

#### Scenario: Plugin name namespaces components

- **WHEN** the plugin is installed and the user opens `/agents`
- **THEN** each plugin-shipped agent appears with the prefix `dhpk:` (e.g. `dhpk:code-reviewer`)

### Requirement: Manifest declares hooks entry point

The manifest SHALL declare `hooks: "./hooks/hooks.json"` so plugin-shipped hooks load on enable.

#### Scenario: Hooks file is resolved

- **WHEN** the plugin is enabled in a project
- **THEN** the hooks defined in `./hooks/hooks.json` register against the listed lifecycle events (PreToolUse, PostToolUse, SessionStart, Stop)

### Requirement: Manifest exposes userConfig for project-level overrides

The manifest SHALL define a `userConfig` block with these keys, in this exact shape, with these defaults:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `hook_profile` | string | `"standard"` | One of `minimal | standard | strict`; controls hook verbosity |
| `review_agents` | string (multiple) | `["code-reviewer", "database-reviewer", "security-reviewer"]` | Three-element list of agent names invoked by sentinel reminders |
| `docker_containers` | string (multiple) | `[]` | Container names checked at SessionStart; empty list disables the check |
| `modules` | string (multiple) | `[]` | Activates per-stack-version modules from `modules/<name>/`; ships: `php-5.6`, `yii-1.1`, `phpunit-5.7`. See `modules-architecture` spec. |
| `review_trigger_extra_paths` | string (multiple) | `[]` | Extra path prefixes for review triggers, each entry prefixed `code:` / `db:` / `sec:` |

#### Scenario: Defaults apply when user provides nothing

- **WHEN** a project installs the plugin without specifying any `--plugin-option`
- **THEN** the three default review agent names are exported into hook scripts and `docker_containers` is empty so the docker check is skipped

#### Scenario: User override propagates to hook subprocesses

- **WHEN** the plugin is installed with `--plugin-option review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj`
- **THEN** `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj` is exported to hook script subprocesses
- **AND** the stop-review reminder names those agents in its output

### Requirement: Manifest declares explicit module skills paths

In addition to the default `./skills/` directory, the manifest SHALL declare each shipped stack module's skills directory in the `skills` array. For v0.1.0:

```json
"skills": [
  "./skills/",
  "./modules/php-5.6/skills/",
  "./modules/yii-1.1/skills/",
  "./modules/phpunit-5.7/skills/"
]
```

Without this declaration, module skills are not discovered (Claude Code does not glob).

#### Scenario: All module skills are discoverable after install

- **WHEN** the plugin is installed and `claude plugin details dhpk` is inspected
- **THEN** module-shipped skills (`dhpk:php-pro`, `dhpk:php56-yii-dev`, `dhpk:yii1-security-audit`, `dhpk:phpunit-batch-refactor`, `dhpk:legacy-code-characterization`) appear alongside core skills

### Requirement: Marketplace manifest enables installation by name

The repo root SHALL provide a `.claude-plugin/marketplace.json` declaring a single-entry marketplace named `dhpk`, with one plugin entry: `{ "name": "dhpk", "source": "./plugins/dhpk", "description": "..." }`. The `source` field must be a relative path starting with `./` pointing at a subdirectory (the marketplace validator rejects `"source": "."`).

#### Scenario: Local marketplace add succeeds

- **WHEN** the user runs `claude plugin marketplace add /home/paul/projects/dhpk`
- **THEN** the marketplace `dhpk` becomes available and lists `dhpk` as an installable plugin

#### Scenario: Install by qualified name works

- **WHEN** the user runs `claude plugin install dhpk@dhpk`
- **THEN** the plugin installs to the user scope and is reported as enabled by `claude plugin list`
