# deep-reasoner Specification

## Purpose
TBD - created by archiving change dhpk-orchestration-workers. Update Purpose after archive.
## Requirements
### Requirement: Read-only deep-reasoning worker with a conclusion contract
The `deep-reasoner` agent SHALL perform reasoning-heavy work — root-cause analysis, algorithm design, complex debugging, design synthesis — using read-only tools (Read, Grep, Glob, Bash, `mcp__gitnexus__impact`, `mcp__gitnexus__query`). Its tool list SHALL NOT include Edit or Write. Its final output SHALL follow the conclusion contract: (1) conclusion, (2) key evidence with `file:line` references, (3) recommended next actions precise enough for `fast-worker` or the orchestrator to apply without re-deriving the analysis.

The "stated as fact, not a hedge" discipline applies to claims the agent can verify by reading and reasoning over the code. It does NOT extend to runtime/browser/environment behavior claims the agent cannot itself execute or observe (e.g. how a page actually scrolls, renders, or times in a live browser). Such a claim SHALL be explicitly labeled "untested hypothesis" rather than stated as fact, and the Next actions SHALL recommend re-dispatching to an executable probe — `e2e-runner` or a scratch runnable probe — to confirm it before it is treated as a conclusion.

#### Scenario: Root-cause analysis of a failing test
- **WHEN** the orchestrator dispatches `deep-reasoner` with a failing-test description and repo paths
- **THEN** the agent returns a root-cause conclusion with evidence and a concrete fix spec, and performs no Edit/Write

#### Scenario: Output is actionable without re-analysis
- **WHEN** `deep-reasoner` returns its conclusion
- **THEN** the recommended actions name target files and the exact change intent, sufficient as a `fast-worker` task spec

#### Scenario: Runtime/browser claim is labeled a hypothesis, not a fact
- **WHEN** a `deep-reasoner` conclusion rests on a claim about browser/runtime behavior (e.g. scroll position, render timing, environment-dependent effects) that the agent did not itself execute or observe
- **THEN** the conclusion labels that claim "untested hypothesis" rather than stating it as fact, and Next actions recommend re-dispatching `e2e-runner` or a scratch probe to confirm it

#### Scenario: Code-verifiable claim still states fact, not a hedge
- **WHEN** a `deep-reasoner` conclusion rests on a claim the agent verified by reading the code (e.g. a comparison operator, a missing null check, a query's WHERE clause)
- **THEN** the conclusion states it as fact, unhedged, per the existing conclusion-contract discipline

### Requirement: Defers DDD and cross-module design to architect
The `deep-reasoner` agent SHALL NOT own DDD-layer placement or cross-module architecture decisions. When the dispatched question is primarily such a design decision, it SHALL state that `architect` is the right agent and return early rather than produce a competing design.

#### Scenario: Dispatched a DDD layering question
- **WHEN** the task is "which layer should this new service live in"
- **THEN** the agent recommends dispatching `dhpk:architect` and does not produce its own layering verdict

### Requirement: Default model opus, overridable per dispatch
The `deep-reasoner` agent frontmatter SHALL declare `model: opus` as the shipped default. The orchestrator MAY override the model on any single dispatch via the Agent call `model` param, per the `orchestration-model-config` capability.

#### Scenario: No override configured
- **WHEN** no `deep_reasoner_model` userConfig is set
- **THEN** dispatches run on the frontmatter default (opus)

### Requirement: Codex isolation invariant
The `deep-reasoner` agent SHALL NOT list any `mcp__codex__*` tool. Codex
participation uses the separately selected `codex-reasoner` backend via
`--reasoner=codex`, or an explicit `--second-opinion=codex-exec`/`codex-bridge`
route; the retired `CODEX=on`/`--codex` flags do not dispatch a review peer.

#### Scenario: Codex-free session
- **WHEN** `deep-reasoner` runs in a default (codex-free) session
- **THEN** its transcript contains zero `mcp__codex__*` tool calls

### Requirement: Registered in plugin.json and INDEX with addition-gate justification
The agent SHALL appear in `.claude-plugin/plugin.json` `agents[]` and in `agents/INDEX.md`, including the component-addition-gate justification: why `general-purpose` (no dhpk policy context, model-tier misallocation, no output contract) and `architect` (design-domain-scoped) cannot cover this need.

#### Scenario: After plugin install
- **WHEN** the dhpk plugin is installed
- **THEN** `dhpk:deep-reasoner` is available as a subagent_type in Claude Code
