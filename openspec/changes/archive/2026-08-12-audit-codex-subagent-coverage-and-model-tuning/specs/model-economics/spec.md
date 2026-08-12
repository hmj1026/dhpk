## MODIFIED Requirements

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

## ADDED Requirements

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
