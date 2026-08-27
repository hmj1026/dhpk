# orchestration-model-config Specification

## Purpose
TBD - created by archiving change dhpk-orchestration-workers. Update Purpose after archive.
## Requirements
### Requirement: userConfig keys for role models and the dispatch switch
`.claude-plugin/plugin.json` `userConfig` SHALL define three new keys: `deep_reasoner_model` (string, default `opus`), `fast_worker_model` (string, default `sonnet`), and `orchestration_dispatch` (string `on`/`off`, default `on`). The generic pass-through loader (`scripts/hooks/_lib/load-project-config.sh`) SHALL be verified — by test, not by code edit — to export the three keys with the standard layering: project pluginConfigs > global pluginConfigs > shipped default. Its known-keys comment SHALL be updated to mention them.

#### Scenario: Project-level override wins
- **WHEN** the global config sets `deep_reasoner_model=opus` and the project's `settings.local.json` pluginConfig sets `deep_reasoner_model=sonnet`
- **THEN** the effective value is `sonnet`

### Requirement: Session-start surfacing of the effective configuration
`scripts/hooks/session-start.sh` SHALL emit one line — `orchestration: deep=<model> worker=<model>` (plus `dispatch=off` when disabled) — only when at least one value differs from the shipped default or the switch is off. With all defaults, nothing is emitted (token discipline).

#### Scenario: Defaults produce no output
- **WHEN** no orchestration key is overridden
- **THEN** session-start prints no orchestration line

#### Scenario: Override announced
- **WHEN** `fast_worker_model=haiku` is configured
- **THEN** session start includes `orchestration: deep=opus worker=haiku`

### Requirement: Per-dispatch application via the Agent model param
The orchestrator SHALL apply configured role models by passing the `model` param on each worker Agent call when the configured value differs from the agent's frontmatter default. Frontmatter stays the shipped default; no frontmatter templating. Judgment-based single-dispatch escalation (the existing Model tier rule inside execution-policy §Agent dispatch, e.g. raising one HIGH-risk dispatch to opus) remains allowed and takes precedence for that dispatch.

#### Scenario: Configured value applied
- **WHEN** `deep_reasoner_model=sonnet` is announced at session start
- **THEN** deep-reasoner dispatches carry `model: sonnet` on the Agent call

#### Scenario: One-off escalation still allowed
- **WHEN** the worker task is a HIGH-risk diff per the Model tier rule (§Agent dispatch)
- **THEN** the orchestrator may raise that single dispatch's model above the configured value, stating the reason

### Requirement: Validation and fallback for invalid values
Valid model values are the Agent-call model names supported by the running Claude Code (at minimum `haiku`, `sonnet`, `opus`). On an invalid configured value, the orchestrator SHALL warn once per session and fall back to the agent's frontmatter default; it SHALL NOT fail the dispatch.

#### Scenario: Invalid model string
- **WHEN** `fast_worker_model=gpt5` is configured
- **THEN** the session warns once and fast-worker dispatches run on the frontmatter default (sonnet)

### Requirement: Kill switch restores pre-change behavior
When `orchestration_dispatch=off`, all touched flows (adaptive-dev-workflow and opsx-apply-goal output) SHALL behave exactly as before this change: inline implementation, no worker dispatch prohibition, no opsx-apply-goal directive line.

#### Scenario: Off switch regression check
- **WHEN** `orchestration_dispatch=off`
- **THEN** adaptive-dev-workflow's Implement step is "write code directly (TDD)" and opsx-apply-goal `/goal` Part 0 matches pre-change output

### Requirement: userConfig keys for CLI-backed fast-worker models
`.claude-plugin/plugin.json` `userConfig` SHALL define the existing CLI-worker model keys and the selector keys `fast_worker_backend` (`claude|codex|agy|auto`, default `claude`), `fast_worker_backend_order` (comma-separated backend names, default `claude,codex,agy`), and `fast_worker_fallback` (`none|claude`, default `none`). It SHALL additionally define the shared and role-specific Codex timeout keys `codex_timeout_secs` (default `360`), `codex_fast_worker_timeout_secs`, `codex_deep_reasoner_timeout_secs`, and `codex_bridge_timeout_secs`. The generic pass-through loader SHALL export them with project-over-global-shipped layering, and its known-keys comment SHALL mention them. Session-start SHALL surface non-default selector or timeout values in one concise line. Invalid selector values SHALL warn once and use shipped defaults; invalid timeout values SHALL fail closed before the affected Codex dispatch.

#### Scenario: Default selection is silent
- **WHEN** no selector or timeout key is overridden
- **THEN** the effective backend is `claude`, fallback is `none`, the Codex timeout is `360`, and session-start prints no selector/timeout line

#### Scenario: Project selector wins
- **WHEN** the global config selects `claude` but the project config sets `fast_worker_backend=agy`
- **THEN** the effective selector is `agy` and session-start reports the non-default choice

#### Scenario: Invalid selector is safe
- **WHEN** a selector contains an unknown backend or fallback mode
- **THEN** the session warns once and uses the shipped default without dispatching an unknown worker

#### Scenario: Project timeout wins
- **WHEN** the global config sets `codex_timeout_secs=900` and the project config sets `codex_timeout_secs=1200`
- **THEN** the effective shared Codex timeout is `1200`

#### Scenario: Role timeout overrides shared timeout
- **WHEN** `codex_timeout_secs=900` and `codex_deep_reasoner_timeout_secs=1800`
- **THEN** deep-reasoner receives `1800` while other Codex roles retain `900`

#### Scenario: Invalid timeout fails closed
- **WHEN** a Codex timeout key contains a malformed value
- **THEN** configuration reports the key and accepted form and prevents that Codex dispatch

#### Scenario: Disabled timeout is explicit
- **WHEN** a Codex timeout key is `0`
- **THEN** the dispatcher intentionally attests no portable runner deadline and the effective diagnostic states that fact; it SHALL NOT substitute a shell timeout tool

### Requirement: CLI-backed worker model defaults are lockstep across all declaration sites
A CLI-backed worker's default model string is declared in more than one file — the `userConfig` schema, the agent definition and its index entry, the wrapper script's usage text, the economics rule table, the configuration docs in every shipped language, the session-start default-detection expression, the test fixtures, **and any spec requirement that quotes the shipped default as normative text** (see the `model-economics` capability, whose tier-map requirement names the default inline). When that default changes, every declaration site SHALL be updated in the same change.

The enumeration above SHALL be read as covering both shipped files and governing spec text. Treating it as a list of shipped files only is the failure mode that let a live spec requirement keep pinning a superseded default while the rule file it governs moved on. In particular, `scripts/hooks/session-start.sh` compares the effective value against the shipped default to decide whether to announce a non-default configuration; leaving a stale literal there SHALL be treated as a defect, because it makes every session report a non-default worker model that is in fact the default.

#### Scenario: Default change updates every site
- **WHEN** the shipped default for a CLI-backed worker model is changed
- **THEN** the `userConfig` default, agent definition, agent index, wrapper usage text, economics table, all localized configuration docs, session-start comparison, test fixtures, and every spec requirement quoting that default as normative text all carry the new value

#### Scenario: Stale session-start literal is a defect
- **WHEN** the default model is changed but the session-start comparison still names the previous value
- **THEN** the session announces a non-default worker model on every start, and this is treated as a defect rather than cosmetic drift

#### Scenario: Spec text quoting a default is a declaration site
- **WHEN** a live spec requirement names a shipped default inline as normative text
- **THEN** that requirement is updated in the same change as the shipped files, so the governed file never contradicts the requirement governing it

#### Scenario: Overrides continue to layer
- **WHEN** a project or global config overrides the worker model after the default changes
- **THEN** the override still wins over the new shipped default with unchanged layering semantics
