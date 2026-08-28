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

The model-economics SSOT SHALL name external roles with the canonical
vocabulary (`codex-worker`, `codex-reasoner`, `codex-reviewer`, and
`agy-worker`) and SHALL keep provider, model, effort, workload rationale, and
escalation condition as separate fields. Legacy names MAY appear only in a
bounded migration note. Model selection and runtime success SHALL remain
separate concerns.

#### Scenario: Role rationale is unambiguous

- **WHEN** an operator compares Codex worker and reviewer tiers
- **THEN** the economics table identifies their distinct mode/authority and
  does not infer runtime execution from the role label

#### Scenario: Legacy name is not a second authority

- **WHEN** a documentation or config search finds `codex-fast-worker`
- **THEN** it is either a compatibility note or historical fixture, not a
  competing model-economics definition

#### Scenario: Tier rationale resolves to one document

- **WHEN** a reader needs the cost rationale for choosing `agy-worker` over
  `fast-worker`
- **THEN** `rules/model-economics.md` carries the provider-specific row and
  routing is referenced rather than duplicated

#### Scenario: Tunable roles enumerated accurately

- **WHEN** the document lists runtime-tunable roles
- **THEN** it includes canonical external workers alongside the existing
  deep-reasoner and fast-worker configuration keys

#### Scenario: Shipped rule file does not contradict its governing requirement

- **WHEN** a canonical external role's default model changes
- **THEN** the quoted requirement and the rule table are updated together

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
