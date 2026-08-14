# fast-worker Specification

## Purpose
TBD - created by archiving change dhpk-orchestration-workers. Update Purpose after archive.
## Requirements
### Requirement: Executes a precise implementation spec
The `fast-worker` agent SHALL accept a task spec consisting of (1) target file list, (2) exact change intent per file, and (3) a verification command. It SHALL apply the changes with Edit/Write/Bash, using surgical edits only — no opportunistic refactors, no formatting sweeps, no changes outside the spec's scope.

#### Scenario: Boilerplate implementation from a fix spec
- **WHEN** dispatched with files, change intent, and `npm test` as the verification command
- **THEN** the agent edits exactly the specified files and runs `npm test`

#### Scenario: Scope discipline
- **WHEN** the agent notices unrelated dead code adjacent to a specified edit
- **THEN** it mentions the observation in its report but does not touch it

### Requirement: Verifies and reports with an edited-file list
After applying changes, the `fast-worker` agent SHALL run the provided verification command and report: pass/fail status with relevant output, the complete list of files it edited, and any deviations from the spec. The edited-file list is mandatory so the orchestrator can enforce post-implementation review gates even when subagent tool calls do not trigger the project's post-edit hooks.

#### Scenario: Verification fails
- **WHEN** the verification command fails after the edits
- **THEN** the agent reports the failure output and stops after at most 3 fix attempts (same contract as the build-resolver family), escalating with a summary

#### Scenario: Report enables gate enforcement
- **WHEN** the agent returns its report
- **THEN** the orchestrator can derive which reviewer gates apply from the edited-file list alone

### Requirement: Escalates on ambiguous specs instead of guessing
When the task spec is underspecified — missing target files, ambiguous change intent, or no runnable verification command — the `fast-worker` agent SHALL stop and return the specific questions blocking execution rather than inventing an interpretation.

#### Scenario: Missing verification command
- **WHEN** dispatched without a verification command and none is derivable from the repo's obvious test config
- **THEN** the agent returns a question naming the gap instead of editing blind

### Requirement: Default model sonnet, overridable per dispatch
The `fast-worker` agent frontmatter SHALL declare `model: sonnet` as the shipped default. The orchestrator MAY override the model on any single dispatch via the Agent call `model` param, per the `orchestration-model-config` capability.

#### Scenario: Project pins worker to haiku
- **WHEN** `fast_worker_model=haiku` is configured
- **THEN** dispatches pass `model: haiku` on the Agent call

### Requirement: Codex isolation invariant and registration
The `fast-worker` agent SHALL NOT list any `mcp__codex__*` tool, and SHALL appear in `.claude-plugin/plugin.json` `agents[]` and `agents/INDEX.md` with the component-addition-gate justification.

#### Scenario: After plugin install
- **WHEN** the dhpk plugin is installed
- **THEN** `dhpk:fast-worker` is available as a subagent_type in Claude Code

### Requirement: Verification greps over special-character content use fixed-string matching

When `fast-worker` (or a skill it emits a verification command for) verifies an edit by grepping for a string that contains shell-special or multibyte/CJK characters — `$` (as in `${CLAUDE_PLUGIN_ROOT}`), the section sign `§`, fullwidth punctuation (`，（）——`), or other non-ASCII — the grep SHALL use fixed-string matching (`grep -F`), not a basic or extended regular expression. Under some locales (e.g. `zh_TW.UTF-8`) a BRE `$` combined with a multibyte character silently matches zero times even when the string is present, producing a false-negative verification. A verification grep that returns zero matches for content the worker believes it just wrote SHALL be re-checked with `grep -F` (or `grep -Fc` on a fixed substring) before being reported as a failure.

#### Scenario: Grep over a ${...}/§ string uses fixed-string matching
- **WHEN** the verification command greps for a string containing `${CLAUDE_PLUGIN_ROOT}` or `§`
- **THEN** it uses `grep -F` (fixed-string), so a present string is not missed due to a BRE/locale interaction

#### Scenario: A zero-match verification is re-checked with -F before reporting failure
- **WHEN** a verification grep returns zero matches for content the worker believes it wrote
- **THEN** the worker re-runs the check with `grep -F` (or `grep -Fc` on a fixed substring) and only reports failure if the fixed-string check also fails
