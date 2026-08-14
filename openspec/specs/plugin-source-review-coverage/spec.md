# plugin-source-review-coverage Specification

## Purpose
TBD - created by archiving change dhpk-advice-20260707-fixes. Update Purpose after archive.
## Requirements
### Requirement: Plugin-source self-edits arm the applicable review sentinel

When the working repository IS the dhpk plugin source (rather than a consumer project that installs dhpk under `.claude/`), an edit to the plugin's own harness files at their repo-root locations — `agents/`, `rules/`, `skills/`, `agent-traps/`, `commands/` `*.md` — SHALL arm the applicable review sentinel (`.pending-doc-review` for these markdown harness files), the same way a consumer project's `.claude/{agents,rules,skills,…}/**/*.md` edit does today. The current post-edit doc-review trigger matches only `.claude/{…}/`, `openspec/`, and `docs/`, so plugin-source self-edits to `agents/…`, `rules/…`, `skills/…` arm nothing and their review gate is AI-judgment-only. Coverage MAY be delivered as an added trigger branch (repo-root harness dirs) active in plugin-source mode, or as a dedicated plugin-dev hook profile — either way a plugin-source harness edit is no longer review-gate-blind. `.claude/artifacts/**` remains exempt (the self-edit re-trigger guard), and non-harness repo-root files (e.g. `README.md`, `tests/`, `scripts/`) are unaffected by this branch.

#### Scenario: Editing the plugin's own agents/ or rules/ file arms doc-review
- **WHEN** a file such as `agents/deep-reasoner.md` or `rules/execution-policy.md` is edited while the working repo is the dhpk plugin source
- **THEN** the `.pending-doc-review` sentinel arms for that file, so the doc-review gate is enforced by the sentinel rather than left to orchestrator judgment

#### Scenario: Consumer-mode behavior is unchanged
- **WHEN** dhpk runs in a consumer project (its harness lives under `.claude/`)
- **THEN** the existing `.claude/{…}/**/*.md` trigger behavior is unchanged — this coverage only adds the repo-root harness dirs in plugin-source mode

#### Scenario: Artifacts stay exempt in plugin-source mode
- **WHEN** a file under `.claude/artifacts/**` is written while the repo is the plugin source
- **THEN** no sentinel arms (the existing self-edit re-trigger guard still applies)
