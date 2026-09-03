# skill-capability-families Specification

## Purpose
Define a compact, ownership-aware skill interface that lets users and agents select a task-shaped capability without learning dhpk's former implementation-level skill names.

## Requirements

### Requirement: First-party workflows are exposed through six capability families

dhpk SHALL expose exactly six reborn first-party capability families: `skill-scope`, `skill-forge`, `flow-guide`, `flow-drive`, `change-verdict`, and `code-trace`. Each family SHALL publish one discriminating description, a finite mode set, and one output contract while placing mode-specific mechanics behind conditional references.

#### Scenario: User requests a first-party workflow
- **WHEN** a request matches one of the declared family modes
- **THEN** routing selects one family and one mode without requiring the user to know a retired predecessor name

#### Scenario: Request crosses family interfaces
- **WHEN** a request contains work owned by more than one family
- **THEN** the selected family returns an ordered handoff or bounded composition instead of silently absorbing the neighboring interface

### Requirement: Family modes preserve predecessor behavior and authority

The family interfaces SHALL provide these modes: `skill-scope` has `health`, `judge`, `stocktake`, and `scout`; `skill-forge` has `create` and `distill-rules`; `flow-guide` has `classify`, `policy`, `next`, and `checklist`; `flow-drive` has `route` and `implement`; `change-verdict` has `code`, `pr`, `security`, `tests`, `docs`, and `risk`; `code-trace` has `explore`, `diagnose`, `history`, and `select-tool`. A mode SHALL preserve the applicable predecessor's authorization boundary and terminal evidence.

#### Scenario: Read-only verdict is selected
- **WHEN** `change-verdict` selects any mode
- **THEN** it reads and reports evidence without editing files, clearing sentinels, staging changes, invoking a writer, or producing an approval unsupported by the selected checks

#### Scenario: Mutating family requires explicit invocation
- **WHEN** work requires `skill-forge` or `flow-drive`
- **THEN** the family remains explicit-only and the model may recommend it without starting it absent direct human invocation or an already authorized explicit router delegation

### Requirement: Predecessor mapping is closed and normative

The alias-free consolidation SHALL use exactly this stable-ID mapping; no implementation step may infer additional predecessors or modes:

| Predecessor stable ID | Successor family | Mode |
|---|---|---|
| `skill-health-check` | `skill-scope` | `health` |
| `skill-judge` | `skill-scope` | `judge` |
| `skill-stocktake` | `skill-scope` | `stocktake` |
| `skill-scout` | `skill-scope` | `scout` |
| `create-skill` | `skill-forge` | `create` |
| `rules-distill` | `skill-forge` | `distill-rules` |
| `adaptive-dev-workflow` | `flow-guide` | `classify` |
| `dhpk-execution-policy` | `flow-guide` | `policy` |
| `next-step` | `flow-guide` | `next` |
| `execution-checklist` | `flow-guide` | `checklist` |
| `do` | `flow-drive` | `route` |
| `implement` | `flow-drive` | `implement` |
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

#### Scenario: Consolidation input differs from the matrix
- **WHEN** a retirement, profile replacement, source deletion, or generated projection adds, omits, or remaps a predecessor from this matrix
- **THEN** validation fails with the predecessor, expected family, and expected mode

### Requirement: External-package skills remain outside family rebirth

A skill family SHALL be classified as external-package-owned when an upstream package publishes the same skill identity or primary workflow and owns its tool or lifecycle contract. External-package-owned stable IDs SHALL remain outside first-party consolidation, successor mapping, and alias-free retirement. A DHPK-owned adapter that merely calls an external tool SHALL remain first-party.

#### Scenario: GitNexus skill is considered for consolidation
- **WHEN** a consolidation candidate is one of `gitnexus-cli`, `gitnexus-debugging`, `gitnexus-exploring`, `gitnexus-guide`, `gitnexus-impact-analysis`, or `gitnexus-refactoring`
- **THEN** the candidate is excluded and its canonical package, active identity, and publication membership remain unchanged

#### Scenario: First-party router can use an external adapter
- **WHEN** `code-trace` selects the DHPK-owned `select-tool` mode
- **THEN** it may recommend an available external tool through the existing routing policy without copying or redefining that external package's skill contract

### Requirement: Reborn skill content follows the agent-writing contract

Each reborn skill SHALL be authored as a new family interface using the repository's writing-for-agents guidance. Shared steps and completion criteria SHALL stay in `SKILL.md`; substantial mode-specific procedures SHALL be disclosed through references loaded only for the selected mode; copied predecessor prose and duplicate policy SSOTs SHALL fail review.

#### Scenario: A family has multiple substantial modes
- **WHEN** a family mode contains procedure or reference material not needed by every other mode
- **THEN** the entrypoint links that material behind a mode-specific context pointer and does not preload sibling modes
