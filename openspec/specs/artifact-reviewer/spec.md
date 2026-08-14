# artifact-reviewer Specification

## Purpose
TBD - created by archiving change dhpk-add-meta-toolkit-agents. Update Purpose after archive.
## Requirements
### Requirement: Sentinel fires when DSL artifact is edited
The system SHALL write `.pending-artifact-review` to `.claude/artifacts/sessions/` whenever a `.md` file containing a YAML frontmatter block (`---` delimiter) is edited via `Edit` or `Write` tool. The sentinel SHALL NOT fire for plain markdown files without frontmatter (e.g., README.md, CODEMAPS).

#### Scenario: Agent markdown edited with frontmatter
- **WHEN** a `.md` file containing `---` frontmatter is saved via Edit/Write
- **THEN** `.pending-artifact-review` is written with a timestamp + relative path line

#### Scenario: Plain markdown without frontmatter is edited
- **WHEN** a `.md` file WITHOUT `---` frontmatter is saved via Edit/Write
- **THEN** `.pending-artifact-review` is NOT written

### Requirement: Stop hook reminds about pending artifact review
The system SHALL block the Stop event (exit 2) when `.pending-artifact-review` exists and has not yet been cleared, displaying a message identifying the count of pending files.

#### Scenario: Sentinel exists when Claude tries to stop
- **WHEN** `.pending-artifact-review` exists at stop time
- **THEN** stop hook exits 2 with a WARN message listing the pending agent name

#### Scenario: Stop proceeds after review completes
- **WHEN** `.pending-artifact-review` has been cleared
- **THEN** stop hook exits 0 without blocking

### Requirement: Agent validates frontmatter correctness
The `artifact-reviewer` agent SHALL read all files listed in `.pending-artifact-review` and check each one for:
- Required frontmatter fields present (at minimum: `name`, `description` for agents; SKILL.md structure for skills)
- `name` value uses kebab-case format
- No disallowed frontmatter keys for the artifact type

#### Scenario: Agent finds a missing required field
- **WHEN** artifact-reviewer runs on a file missing a required frontmatter field
- **THEN** it reports the missing field as a FINDING with file path and field name

#### Scenario: Agent finds all fields present and correct
- **WHEN** artifact-reviewer runs on a file with valid frontmatter
- **THEN** it reports PASS for that file

### Requirement: Hook owns sentinel lifecycle after review
After completing review, the `artifact-reviewer` agent SHALL write its canonical review artifact and final verdict without invoking `clear-sentinel.sh`. The `subagent-stop-verify.sh` hook SHALL clear `.pending-artifact-review` only after a successful stop with a fresh, matching artifact; a missing, stale, malformed, or failed review SHALL leave the sentinel armed and the review obligation unresolved.

#### Scenario: Reviewer closes without touching its sentinel
- **WHEN** artifact-reviewer finishes its run with a fresh, parseable review artifact
- **THEN** artifact-reviewer makes no `clear-sentinel.sh` call and `subagent-stop-verify.sh` clears `.pending-artifact-review` on the successful stop

#### Scenario: Review failure leaves the sentinel armed
- **WHEN** artifact-reviewer returns a failed, malformed, stale, or missing review artifact
- **THEN** `subagent-stop-verify.sh` does not clear `.pending-artifact-review` and the review obligation remains pending

### Requirement: New sentinel slot registered in payload.sh
The `.pending-artifact-review` sentinel SHALL be registered in `payload.sh`'s four lockstep arrays (`SENTINEL_NAMES`, `SENTINEL_LABELS`, `SENTINEL_SHORT_NAMES`, `_dhpk_default_agents`) so the pre-commit sentinel gate and stop hook correctly identify it.

#### Scenario: Pre-commit gate detects artifact review pending
- **WHEN** a git commit is attempted while `.pending-artifact-review` exists
- **THEN** `pretool-sentinel-gate.sh` emits an advisory (or block) about pending artifact review

#### Scenario: Unknown sentinel name rejected by clear-sentinel.sh
- **WHEN** `clear-sentinel.sh` is called with a name NOT in `SENTINEL_NAMES`
- **THEN** it exits 2 with an error — no silent no-op

### Requirement: Agent registered in plugin.json and INDEX.md
The `artifact-reviewer` agent SHALL appear in `.claude-plugin/plugin.json` `agents[]` and in `agents/INDEX.md` so it is available as `dhpk:artifact-reviewer` subagent_type after plugin install.

#### Scenario: After plugin install, subagent_type is available
- **WHEN** dhpk plugin is installed
- **THEN** `dhpk:artifact-reviewer` is available as a subagent_type in Claude Code
