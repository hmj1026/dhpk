# model-economics Specification

## Purpose
TBD - created by archiving change orchestrator-token-economics. Update Purpose after archive.
## Requirements
### Requirement: Model-economics SSOT document

`rules/model-economics.md` SHALL remain the single source of truth for model
tier and cost guidance and SHALL include a Codex projection map separate from
Claude-side dispatch routing. The Codex map SHALL document each direct role's
model, effort, workload rationale, and escalation condition. It SHALL state
that `worker` and `tdd-guide` intentionally use `gpt-5.6-luna` at `max` as a
quality-first exception, while the global default remains `gpt-5.6-luna` at
`medium`.

#### Scenario: Codex tier guidance resolves to one document
- **WHEN** a reader needs the model or effort rationale for a Codex role
- **THEN** the role projection and related guidance point to
  `rules/model-economics.md`
- **AND** dispatch routing is referenced from `execution-policy` rather than
  duplicated

#### Scenario: Maximum-effort exception is documented
- **WHEN** a reader compares `worker` or `tdd-guide` with other high-frequency
  roles
- **THEN** the document explains the quality and retry-cost reason for `max`
  and identifies it as an explicit exception, not the global default

### Requirement: Worker-scoped effort and evidence-gather configuration

`.claude-plugin/plugin.json` SHALL expose three `userConfig` keys (the two effort keys default to current behavior; `evidence_gather` defaults `on` to activate the gather-first lever, with `off` restoring prior behavior):

- `deep_reasoner_effort` — default `high`; applied on the `Agent` call's `effort` param for every `deep-reasoner` dispatch.
- `fast_worker_effort` — default `medium`; applied on the `Agent` call's `effort` param for every `fast-worker` dispatch.
- `evidence_gather` — default `on`; when `off`, the evidence-gather-before-reasoning lever is disabled.

These SHALL reuse the existing configured-role mechanism: the value is passed on the `Agent` call, agent frontmatter is never edited, an invalid value warns once per session and falls back to the frontmatter default (never failing the dispatch), and the effective values are announced at session start only when they differ from the shipped defaults. No `reviewer_model` or reviewer-effort key is added — reviewers keep the sonnet floor and the review gate is unchanged.

#### Scenario: Effort override is applied per dispatch without editing frontmatter
- **WHEN** `fast_worker_effort=low` is configured and a `fast-worker` dispatch occurs
- **THEN** the orchestrator passes `effort=low` on that `Agent` call and the agent's frontmatter file is left unmodified

#### Scenario: All-defaults path stays silent
- **WHEN** none of the three keys differs from its shipped default
- **THEN** session start emits no additional announcement for them (token discipline preserved)

#### Scenario: Invalid effort value falls back, never fails
- **WHEN** an effort key holds a value the running Claude Code does not support
- **THEN** the dispatch warns once per session and falls back to the agent frontmatter's effort, and the dispatch still runs

### Requirement: harness-budget reports tier economics

`skills/harness-budget` SHALL include a tier-economics detection pass that, for each `agents/*.md`, reads the `model:` and `effort:` frontmatter and flags cost-posture mismatches — for example a read-only discovery role on opus, a mechanical role at `high` effort, or a high-frequency reviewer on an expensive tier. The pass SHALL complement, not replace, the existing token-size audit, and its output SHALL include a per-role tier/effort table with a cost-posture verdict.

#### Scenario: Expensive-tier discovery role is flagged
- **WHEN** `harness-budget` runs against an agent set containing a read-only discovery role pinned to opus
- **THEN** the tier-economics pass flags it as a cost-posture mismatch in its per-role table

#### Scenario: Size audit is preserved
- **WHEN** the tier-economics pass runs
- **THEN** the existing token-size audit (bloated descriptions, heavy files, MCP over-subscription) still runs and reports alongside it

### Requirement: Tier map covers CLI-backed fast-worker variants
`rules/model-economics.md` SHALL extend the tier map with the two CLI-backed mechanical implementers — `codex-fast-worker` (backend: codex CLI, default `gpt-5.6-luna` @ `xhigh`) and `agy-fast-worker` (backend: agy CLI, default `Gemini 3.6 Flash (High)`) — each with a one-line "why" (offload mechanical batches to an external-budget backend; agy as the cheap high-throughput tier, codex xhigh as the strong mechanical tier). The entries SHALL note that these two roles are runtime-tunable via the `codex_fast_worker_*` / `agy_fast_worker_model` userConfig keys and SHALL reference the execution-policy dispatch table for routing without restating it.

Because **this requirement** names a shipped default inline as normative text, it is itself a lockstep declaration site and SHALL move with that default. The general obligation covering all such sites lives in the `orchestration-model-config` capability; this clause is an instance of it, not an independent authority.

#### Scenario: Tier rationale resolves to one document
- **WHEN** a reader needs the cost rationale for choosing `agy-fast-worker` over `fast-worker`
- **THEN** `rules/model-economics.md` carries the CLI-backed rows and the dispatch table is referenced, not duplicated

#### Scenario: Tunable roles enumerated accurately
- **WHEN** the document lists which roles are runtime-tunable via userConfig
- **THEN** the list includes the CLI-backed workers alongside `deep_reasoner_*`/`fast_worker_*`

#### Scenario: Shipped rule file does not contradict its governing requirement
- **WHEN** a shipped default model string changes and `rules/model-economics.md` is updated to match
- **THEN** this requirement's own quoted default is updated in the same change, so the rule file never ships in violation of the requirement that governs its content

### Requirement: Codex role model and effort metadata follows the approved map

The generator runtime metadata and committed Codex role files SHALL use this
map:

| Roles | Model | Effort |
|---|---|---|
| `architect`, `bug-investigator`, `deep-reasoner`, `security-reviewer`, `migration-reviewer`, `planner`, `spec-miner` | `gpt-5.6-sol` | `high` |
| `code-reviewer` | `gpt-5.6-terra` | `medium` |
| `database-reviewer`, `frontend-reviewer`, `e2e-runner` | `gpt-5.6-terra` | `high` |
| `explorer` | `gpt-5.6-terra` | `medium` |
| `worker`, `tdd-guide` | `gpt-5.6-luna` | `max` |
| `doc-reviewer` | `gpt-5.6-luna` | `medium` |
| `monitor` | `gpt-5.6-luna` | `low` |

#### Scenario: Role metadata matches the approved map
- **WHEN** runtime contract tests inspect every direct role
- **THEN** each role's model and effort equal the map above
- **AND** no active Codex role uses GPT-5.5

#### Scenario: Global defaults do not erase role exceptions
- **WHEN** a role file explicitly sets model or effort
- **THEN** its explicit values take precedence over the global defaults
- **AND** the global defaults are `gpt-5.6-luna` and `medium`

### Requirement: Model selection accounts for token and retry cost

The model policy SHALL prefer the cheapest model expected to pass the role's
acceptance contract, shall reserve `max` for quality-first work with a stated
reason, and shall consider total accepted-outcome cost (including retries and
parallel subagent work) rather than sticker price alone. It SHALL NOT invent a
Codex custom-agent token-limit field that the runtime does not support.

#### Scenario: High-frequency review avoids unnecessary frontier cost
- **WHEN** a normal code review has no high-risk escalation trigger
- **THEN** it runs on the approved Terra/medium baseline
- **AND** a higher-cost escalation is reserved for a documented risk condition

#### Scenario: Quality-first implementation keeps max effort
- **WHEN** `worker` or `tdd-guide` is dispatched for implementation/test-first
  work
- **THEN** it uses Luna/max as the approved quality-first exception
