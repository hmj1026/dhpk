# planner-agent-dispatch Specification

## Purpose
TBD - created by archiving change add-planner-agent-do-plan-dispatch. Update Purpose after archive.
## Requirements
### Requirement: `/dhpk:do --plan` parsing and scope gate

`commands/do.md` Step 0 SHALL parse an optional `--plan[=<model>[:<effort>]]` flag from the incoming request the same way it parses `--codex` today: detected, stripped from the request text before route-table matching, and carried forward as `PLAN=on` (with any explicit `<model>`/`<effort>` override) into Step 3. Planner dispatch SHALL activate only when the resolved route target is one of the implementation-class routes — `dhpk:adaptive-dev-workflow` or `dhpk:opsx-apply-goal`. When `PLAN=on` resolves to any other route, `/dhpk:do` SHALL print a one-line ignore message and proceed with that route unaffected; `scripts/lib/route-table.json` and `scripts/lib/pre-route.sh` SHALL remain unchanged.

#### Scenario: --plan flag is stripped before route matching
- **WHEN** a user runs `/dhpk:do --plan "implement feature X"`
- **THEN** the route-table matcher receives the cleaned query without the `--plan` token, and the route resolves exactly as it would without the flag present

#### Scenario: --plan activates on an implementation-class route
- **WHEN** `--plan` is set and the resolved route target is `dhpk:adaptive-dev-workflow` or `dhpk:opsx-apply-goal`
- **THEN** `/dhpk:do` carries `PLAN=on` forward into Step 3 and assembles a plan brief for `dhpk:planner` before invoking the target skill

#### Scenario: --plan is ignored on a non-implementation route
- **WHEN** `--plan` is set but the resolved route target is not one of the four implementation-class skills
- **THEN** `/dhpk:do` prints a one-line message stating the flag was ignored and proceeds with the resolved route unaffected, with no `dhpk:planner` dispatch

#### Scenario: Model/effort override syntax is parsed
- **WHEN** a user runs `/dhpk:do --plan=fable:medium "fix bug Y"` and the route resolves to `dhpk:adaptive-dev-workflow`
- **THEN** `/dhpk:do` parses `fable` as the model override and `medium` as the effort override and carries both forward for the `dhpk:planner` dispatch

### Requirement: Planner reply contract — verdict-first-line, coded findings, token cap, END sentinel

Every reply from `dhpk:planner` SHALL begin with a `VERDICT:` line as the first line of the reply: for a pre-implementation plan consult the verdict SHALL be one of `ENDORSE`, `AMEND`, `REPLACE`; for a post-implementation warm review the verdict SHALL be one of `SHIP`, `FIX-THEN-SHIP`, `RECONSULT`. Findings SHALL use the coded vocabulary (NIL/BOUND/RACE/AUTHZ/VALID/ERRPATH/INVARIANT/LEAK/TYPE/DEADCODE/REGRESS/PERF for code-level findings; SEQ/SCOPE/SIMPLER for plan-level findings; `FREE:` as a catch-all for findings outside the coded vocabulary), reported by exception. The total reply SHALL NOT exceed 400 tokens. The literal string `END` SHALL be the last line of every reply. A reply missing the trailing `END` line SHALL be treated by the dispatching orchestrator as truncation: the orchestrator SHALL re-consult `dhpk:planner` exactly once, and if the re-consult also lacks `END`, SHALL proceed with a disclosed degradation notice (stating the reply could not be confirmed complete) rather than silently trusting a possibly-truncated verdict.

#### Scenario: Plan-consult verdict vocabulary
- **WHEN** `dhpk:planner` responds to a pre-implementation plan critique, blind-sketch, or dual-plan consult
- **THEN** the first line of the reply is `VERDICT: ENDORSE`, `VERDICT: AMEND`, or `VERDICT: REPLACE`

#### Scenario: Warm-review verdict vocabulary
- **WHEN** `dhpk:planner` responds to a post-implementation warm diff review
- **THEN** the first line of the reply is `VERDICT: SHIP`, `VERDICT: FIX-THEN-SHIP`, or `VERDICT: RECONSULT`

#### Scenario: Reply ends with the literal END sentinel
- **WHEN** any `dhpk:planner` reply completes normally
- **THEN** the last line of the reply is the literal string `END`

#### Scenario: Missing END triggers one re-consult then disclosed degradation
- **WHEN** a `dhpk:planner` reply is received without a trailing `END` line
- **THEN** the orchestrator re-consults `dhpk:planner` exactly once; if the re-consult also lacks `END`, the orchestrator proceeds with a disclosed degradation notice instead of silently trusting the possibly-truncated verdict

#### Scenario: Reply stays within the token cap
- **WHEN** `dhpk:planner` composes a reply
- **THEN** the reply reports findings by exception using the coded vocabulary and does not exceed 400 tokens

### Requirement: Plan-brief discipline

Before dispatching `dhpk:planner`, the orchestrator SHALL assemble a plan brief that follows a conclusions-not-context discipline: the brief SHALL NOT exceed 3.5k tokens, SHALL contain intent, the cleaned query, a file map, and load-bearing code excerpts only (not raw exploratory context), and SHALL include a lookup fence directing `dhpk:planner` not to re-discover information the orchestrator has already resolved.

#### Scenario: Brief stays within the token budget
- **WHEN** the orchestrator assembles a plan brief for `dhpk:planner`
- **THEN** the brief does not exceed 3.5k tokens

#### Scenario: Brief contains required fields
- **WHEN** the orchestrator assembles a plan brief
- **THEN** the brief includes intent, the cleaned query, a file map, and load-bearing code excerpts, and omits raw exploratory context that does not serve those fields

#### Scenario: Brief includes a lookup fence
- **WHEN** the orchestrator assembles a plan brief
- **THEN** the brief includes a lookup fence instructing `dhpk:planner` not to re-discover information the orchestrator already resolved

### Requirement: Bounded discovery for planner consults

`dhpk:planner` SHALL have no search tools of its own. When unknown-location discovery is required during a consult, `dhpk:planner` SHALL spawn the built-in `Explore` agent, capped at 2 spawns per consult, and SHALL NOT spawn any write-capable child agent. `dhpk:planner`'s own direct file reads SHALL be capped at 12 per consult.

#### Scenario: Discovery uses the built-in Explore agent, capped at 2 spawns
- **WHEN** `dhpk:planner` needs to locate code not already resolved in the plan brief
- **THEN** it spawns the built-in `Explore` agent rather than any other search or write-capable agent, and does not exceed 2 `Explore` spawns within the consult

#### Scenario: Direct reads are capped at 12
- **WHEN** `dhpk:planner` performs its own direct file reads during a consult
- **THEN** the number of direct reads does not exceed 12 within that consult

#### Scenario: No write-capable child agent is spawned
- **WHEN** `dhpk:planner` needs additional context during a consult
- **THEN** it does not spawn any agent capable of Edit/Write operations

### Requirement: Model/effort resolution precedence

The model and effort used for a `dhpk:planner` dispatch SHALL be resolved with the following precedence: (1) an explicit `--plan=<model>[:<effort>]` flag override on the triggering `/dhpk:do` invocation; (2) the `planner_model`/`planner_effort` userConfig keys when set; (3) the default `opus`/`high`. When the resolved model or effort differs from the `opus`/`high` default, the session SHALL announce the non-default value at session start.

#### Scenario: Per-invocation flag wins
- **WHEN** a `/dhpk:do --plan=fable:medium` invocation runs and `planner_model`/`planner_effort` userConfig keys are also set
- **THEN** the `dhpk:planner` dispatch uses `fable`/`medium` from the flag, not the userConfig values

#### Scenario: userConfig wins over the built-in default
- **WHEN** no `--plan` model/effort override is given and `planner_model`/`planner_effort` userConfig keys are set to non-default values
- **THEN** the `dhpk:planner` dispatch uses the userConfig values

#### Scenario: Default applies when nothing is overridden
- **WHEN** no `--plan` override and no `planner_model`/`planner_effort` userConfig keys are set
- **THEN** the `dhpk:planner` dispatch uses `opus` at `high` effort

#### Scenario: Non-default resolution is announced at session start
- **WHEN** `planner_model` or `planner_effort` userConfig resolves to a value other than `opus`/`high`
- **THEN** `session-start.sh` announces the non-default value

### Requirement: Verdict fold-in and warm-review obligation

When a pre-implementation `dhpk:planner` consult returns `ENDORSE`, the orchestrator SHALL pass the original plan through to the target implementation skill unchanged. When it returns `AMEND`, the orchestrator SHALL append the returned deltas to the task brief handed to the implementation skill. When it returns `REPLACE`, the orchestrator SHALL substitute the returned plan for the original outright. When a pre-implementation consult occurred, the orchestrator SHALL record and surface a warm-review obligation in `/dhpk:do`'s output. Because no Stop-hook or goal-session integration currently re-fires the planner, `commands/do.md` and `agents/planner.md` SHALL describe honoring that obligation as a **manual orchestrator re-invocation** of `dhpk:planner` at task end, and SHALL NOT state or imply that the warm review resumes automatically (no "the driver resumes you" phrasing). The automatic re-engagement mechanism remains explicitly out of scope.

#### Scenario: ENDORSE passes the plan through unchanged
- **WHEN** `dhpk:planner` returns `VERDICT: ENDORSE`
- **THEN** the orchestrator dispatches the target implementation skill with the original plan unchanged

#### Scenario: AMEND appends deltas
- **WHEN** `dhpk:planner` returns `VERDICT: AMEND` with delta findings
- **THEN** the orchestrator appends the returned deltas to the task brief handed to the target implementation skill, rather than discarding or fully replacing the original plan

#### Scenario: REPLACE substitutes the plan
- **WHEN** `dhpk:planner` returns `VERDICT: REPLACE` with a substitute plan
- **THEN** the orchestrator uses the returned plan in place of the original when dispatching the target implementation skill

#### Scenario: A pre-implementation consult records a warm-review obligation
- **WHEN** a pre-implementation `dhpk:planner` consult has occurred for a task
- **THEN** the `/dhpk:do` output records and surfaces the warm-review obligation (the dispatch itself is not enforced by this change)

#### Scenario: The warm review is described as manual, not automatic
- **WHEN** a contributor reads the warm-review obligation wording in `commands/do.md` or `agents/planner.md`
- **THEN** it describes the post-implementation warm review as a manual orchestrator re-invocation of `dhpk:planner`, with no phrasing implying automatic resumption
