## RENAMED Requirements

- FROM: `### Requirement: First-party workflows are exposed through six capability families`
- TO: `### Requirement: First-party workflows are exposed through nine capability families`

## MODIFIED Requirements

### Requirement: First-party workflows are exposed through nine capability families

dhpk SHALL expose exactly nine portable first-party capability families:
`skill-scope`, `skill-forge`, `flow-guide`, `flow-drive`, `change-verdict`,
`code-trace`, `laravel`, `phpunit`, and `harness-govern`. Each family SHALL
publish one discriminating description, a finite mode or selector set, and one
output contract while placing mode- or selector-specific mechanics behind
conditional references. The standalone `git-smart-commit` skill SHALL remain a
prefixed, unchanged capability owner and SHALL NOT be replaced by a family.

#### Scenario: User requests a first-party workflow

- **WHEN** a request matches one of the declared family modes or selectors
- **THEN** routing selects one family and one mode or selector without requiring
  the user to know a retired predecessor name

#### Scenario: Request crosses family interfaces

- **WHEN** a request contains work owned by more than one family
- **THEN** the selected family returns an ordered handoff or bounded composition
  instead of silently absorbing the neighboring interface

#### Scenario: Standalone commit owner is selected

- **WHEN** a user explicitly requests commit grouping or commit execution
- **THEN** routing selects `git-smart-commit` with its existing public name and
  authority contract rather than inventing a `commit-craft` family

### Requirement: Family modes preserve predecessor behavior and authority

The family interfaces SHALL provide these modes and selectors: `skill-scope`
has `health`, `judge`, `stocktake`, and `scout`; `skill-forge` has `create` and
`distill-rules`; `flow-guide` has `route`, `rules`, `next`, and `close`, plus a
read-only `help` metadata action that is not a workflow mode; `flow-drive` has
no modes and exposes one explicit implementation entry for confirmed
specifications; `change-verdict` has `code`, `pr`, `security`, `tests`, `docs`,
and `risk`; `code-trace` has `explore`, `diagnose`, `history`, and `select-tool`;
`laravel` has selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, and `mix`;
`phpunit` has selectors `9`, `10`, and `11`; and `harness-govern` has modes
`health`, `budget`, `fill`, `revise`, and `sync`. A mode or selector SHALL
preserve the applicable predecessor's authorization boundary and terminal
evidence.

#### Scenario: Read-only verdict is selected

- **WHEN** `change-verdict` selects any mode
- **THEN** it reads and reports evidence without editing files, clearing
  sentinels, staging changes, invoking a writer, or producing an approval
  unsupported by the selected checks

#### Scenario: Mutating family requires explicit invocation

- **WHEN** work requires `skill-forge`, `flow-drive`, or `harness-govern`
- **THEN** the family remains explicit-only and the model may recommend it
  without starting it absent direct human invocation or an already authorized
  explicit router delegation

#### Scenario: Flow guide help is metadata-only

- **WHEN** a user requests `flow-guide` `help` for a skill, action, or selector
- **THEN** it returns the inventory-owned usage metadata without editing files,
  changing workflow state, or treating `help` as a fourth workflow mode

#### Scenario: Flow drive receives a confirmed specification

- **WHEN** `flow-drive` receives a confirmed specification or OpenSpec change
- **THEN** it begins the explicit implementation entry without requiring or
  accepting a mode selector

### Requirement: Predecessor mapping is closed and normative

The alias-free family consolidation SHALL use exactly this stable-ID mapping for
family predecessors; the complete second-wave retirement set, including
non-family replacements, is defined by `skill-retirement-migration`. No
implementation step may infer additional family predecessors or modes. The
mapping preserves the existing family ownership while routing the revised Flow
interfaces and the new Laravel, PHPUnit, and harness families:

| Predecessor stable ID | Successor family | Mode or selector |
|---|---|---|
| `skill-health-check` | `skill-scope` | `health` |
| `skill-judge` | `skill-scope` | `judge` |
| `skill-stocktake` | `skill-scope` | `stocktake` |
| `skill-scout` | `skill-scope` | `scout` |
| `create-skill` | `skill-forge` | `create` |
| `rules-distill` | `skill-forge` | `distill-rules` |
| `adaptive-dev-workflow` | `flow-guide` | `route` |
| `dhpk-execution-policy` | `flow-guide` | `rules` |
| `next-step` | `flow-guide` | `next` |
| `execution-checklist` | `flow-guide` | `close` |
| `do` | `flow-guide` | `route` |
| `implement` | `flow-drive` | — |
| `codex-code-review` | `change-verdict` | `code` |
| `pr-review` | `change-verdict` | `pr` |
| `security-review` | `change-verdict` | `security` |
| `test-review` | `change-verdict` | `tests` |
| `doc-review` | `change-verdict` | `docs` |
| `risk-assess` | `change-verdict` | `risk` |
| `code-explore` | `code-trace` | `explore` |
| `bug-investigation` | `code-trace` | `diagnose` |
| `git-investigate` | `code-trace` | `history` |
| `tool-routing` | `code-trace` | `select-tool` |
| `laravel-5.4-notes` | `laravel` | `5.4` |
| `laravel-6-notes` | `laravel` | `6` |
| `laravel-7-notes` | `laravel` | `7` |
| `laravel-8-notes` | `laravel` | `8` |
| `laravel-9-notes` | `laravel` | `9` |
| `laravel-10-notes` | `laravel` | `10` |
| `laravel-11-notes` | `laravel` | `11` |
| `laravel-mix-notes` | `laravel` | `mix` |
| `phpunit-9-modern` | `phpunit` | `9` |
| `phpunit-10-notes` | `phpunit` | `10` |
| `phpunit-11-notes` | `phpunit` | `11` |
| `claude-health` | `harness-govern` | `health` |
| `harness-budget` | `harness-govern` | `budget` |
| `harness-fill` | `harness-govern` | `fill` |
| `harness-revise` | `harness-govern` | `revise` |
| `multi-ai-sync` | `harness-govern` | `sync` |

#### Scenario: Consolidation input differs from the matrix

- **WHEN** a retirement, profile replacement, source deletion, or generated
  projection adds, omits, or remaps a predecessor from this matrix
- **THEN** validation fails with the predecessor, expected family, and expected
  mode or selector

### Requirement: External-package skills remain outside family rebirth

A skill family SHALL be classified as external-package-owned when an upstream
package publishes the same skill identity or primary workflow and owns its tool
or lifecycle contract. External-package-owned stable IDs SHALL remain outside
first-party consolidation, successor mapping, and alias-free retirement. A
DHPK-owned adapter that merely calls an external tool SHALL remain first-party.

#### Scenario: GitNexus skill is considered for consolidation

- **WHEN** a consolidation candidate is one of `gitnexus-cli`,
  `gitnexus-debugging`, `gitnexus-exploring`, `gitnexus-guide`,
  `gitnexus-impact-analysis`, or `gitnexus-refactoring`
- **THEN** the candidate is excluded and its canonical package, active identity,
  and publication membership remain unchanged

#### Scenario: First-party router can use an external adapter

- **WHEN** `code-trace` selects the DHPK-owned `select-tool` mode
- **THEN** it may recommend an available external tool through the existing
  routing policy without copying or redefining that external package's skill
  contract

### Requirement: Reborn skill content follows the agent-writing contract

Each reborn skill SHALL be authored as a new family interface using the
repository's writing-for-agents guidance. Shared steps and completion criteria
SHALL stay in `SKILL.md`; substantial mode- or selector-specific procedures
SHALL be disclosed through references loaded only for the selected mode or
selector; copied predecessor prose and duplicate policy SSOTs SHALL fail review.

#### Scenario: A family has multiple substantial modes

- **WHEN** a family mode contains procedure or reference material not needed by
  every other mode
- **THEN** the entrypoint links that material behind a mode-specific context
  pointer and does not preload sibling modes
