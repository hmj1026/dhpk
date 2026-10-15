# skill-capability-families Specification

## Purpose

Define a compact, ownership-aware skill interface that lets users and agents select a task-shaped capability without learning dhpk's former implementation-level skill names.

## Requirements

### Requirement: Family interfaces are separate from public catalog membership

Capability-family interfaces SHALL retain their task boundary, finite mode or
selector set, and output contract while placing mode- or selector-specific
mechanics behind conditional references. Public workflow membership and its
count SHALL be determined by the accepted inventory selection for the target
publication; the existence or number of family directories SHALL NOT act as a
publication quota. The standalone `git-smart-commit` skill SHALL remain a
separately owned capability and SHALL NOT be replaced by a family; its public
selection is decided independently.

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
  authority contract rather than inventing a `commit-craft` family, while
  publication membership continues to follow the accepted inventory selection

#### Scenario: A family interface is not selected for publication

- **WHEN** an accepted publication selection omits a retained family interface
- **THEN** generation follows that selection and does not infer membership from
  the family directory, historical family count, or predecessor mapping

### Requirement: Family modes preserve predecessor behavior and authority

The family interfaces SHALL provide these modes and selectors: `skill-scope` has `health`, `judge`, `stocktake`, and `scout`; `flow-guide` has `route`, `rules`, `next`, and `close`, plus a read-only `help` metadata action that is not a workflow mode; `flow-drive` has no modes and exposes one explicit implementation entry for confirmed specifications; `change-verdict` has `code`, `pr`, `security`, `tests`, `docs`, and `risk`, plus `pending` and `deps` actions with the authority contract below; `code-trace` has `explore`, `diagnose`, `history`, and `select-tool`; `laravel` has selectors `5.4`, `6`, `7`, `8`, `9`, `10`, `11`, and `mix`; `phpunit` has selectors `9`, `10`, and `11`; and `harness-govern` has modes `health`, `budget`, `fill`, `revise`, and `sync`. A mode or selector SHALL preserve the applicable predecessor's authorization boundary and terminal evidence. These interface contracts do not require every family to be selected as a public workflow.

SCF-REQ-007: `change-verdict`'s six existing modes, `pending`, and default `deps` audit SHALL remain read-only. Only an explicit user request for dependency fix/remediation SHALL authorize workspace writes, limited to that dependency remediation; the request SHALL NOT require repeated authorization for the same bounded fix or grant arbitrary source repair. Fix execution SHALL be followed by an independent security verdict and SHALL NOT itself clear a gate. `pending` SHALL delegate to an available `code-reviewer`; its absence SHALL return `UNAVAILABLE`. Description, authority instructions, inventory usage, and action authority SHALL consistently distinguish audit from remediation instead of retaining a blanket read-only promise or marking default audit workspace-write.

#### Scenario: Read-only verdict is selected

- **WHEN** `change-verdict` selects `code`, `pr`, `security`, `tests`, `docs`, `risk`, `pending`, or `deps` without explicit remediation authority
- **THEN** it reads and reports evidence without editing files, clearing sentinels, staging changes, invoking a writer, or producing an approval unsupported by the selected checks

#### Scenario: Mutating family requires explicit invocation

- **WHEN** work requires `flow-drive` or `harness-govern`
- **THEN** the family remains explicit-only and the model may recommend it without starting it absent direct human invocation or an already authorized explicit router delegation

#### Scenario: Flow guide help is metadata-only

- **WHEN** a user requests `flow-guide` `help` for a skill, action, or selector
- **THEN** it returns the inventory-owned usage metadata without editing files, changing workflow state, or treating `help` as a fourth workflow mode

#### Scenario: Flow drive receives a confirmed specification

- **WHEN** `flow-drive` receives a confirmed specification or OpenSpec change
- **THEN** it begins the explicit implementation entry without requiring or accepting a mode selector

#### Scenario: Pending reviewer is unavailable

- **WHEN** `pending` has no available permitted `code-reviewer`
- **THEN** it reports `UNAVAILABLE` without substituting self-review or clearing a gate

#### Scenario: Explicit dependency remediation is requested

- **WHEN** a user explicitly requests `deps fix` or equivalent dependency remediation
- **THEN** only bounded dependency changes are authorized, no repeated confirmation is required for that scope, and a separate independent security verdict follows the fix

#### Scenario: Remediation completes but independent review does not pass

- **WHEN** the fix command succeeds but independent security review fails or is unavailable
- **THEN** remediation execution and the non-pass verdict remain separate and no gate PASS is reported

### Requirement: Predecessor mapping is closed and normative

The alias-free family consolidation SHALL use exactly this stable-ID mapping for
family predecessors; the complete second-wave retirement set, including
non-family replacements, is defined by `skill-retirement-migration`. No
implementation step may infer additional family predecessors or modes. The
mapping is the historical ownership and behavior record for the revised Flow
interfaces and the Laravel, PHPUnit, and harness families. It does not require
each mapped successor to remain a current public entry or make any predecessor
an invokable alias:

| Predecessor stable ID | Successor family | Mode or selector |
|---|---|---|
| `skill-health-check` | `skill-scope` | `health` |
| `skill-judge` | `skill-scope` | `judge` |
| `skill-stocktake` | `skill-scope` | `stocktake` |
| `skill-scout` | `skill-scope` | `scout` |
| `create-skill` | model default (`skill-forge` retired in 0.65.0) | — |
| `rules-distill` | model default (`skill-forge` retired in 0.65.0) | — |
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

- **WHEN** a retirement, profile replacement, source deletion, or generated projection adds, omits, or remaps a predecessor from this matrix
- **THEN** validation fails with the predecessor, expected family, and expected mode or selector

#### Scenario: A retired predecessor remains historical

- **WHEN** migration evidence consults `create-skill` or `rules-distill` after
  `skill-forge` has been retired
- **THEN** the existing model-default disposition and retirement note remain
  authoritative, and neither `skill-forge` nor its predecessor names are
  restored as active entries or aliases

### Requirement: External-package skills remain outside family rebirth

A skill family SHALL be classified as external-package-owned when an upstream package publishes the same skill identity or primary workflow and owns its tool or lifecycle contract. External-package-owned stable IDs SHALL remain outside first-party consolidation, successor mapping, and alias-free retirement. A DHPK-owned adapter that merely calls an external tool SHALL remain first-party.

#### Scenario: GitNexus skill is considered for consolidation

- **WHEN** a consolidation candidate is one of `gitnexus-cli`, `gitnexus-debugging`, `gitnexus-exploring`, `gitnexus-guide`, `gitnexus-impact-analysis`, or `gitnexus-refactoring`
- **THEN** the candidate is excluded and its canonical package, active identity, and publication membership remain unchanged

#### Scenario: First-party router can use an external adapter

- **WHEN** `code-trace` selects the DHPK-owned `select-tool` mode
- **THEN** it may recommend an available external tool through the existing routing policy without copying or redefining that external package's skill contract

### Requirement: Reborn skill content follows the agent-writing contract

Each reborn skill SHALL be authored as a new family interface using the
repository's writing-for-agents guidance. Shared steps and completion criteria
SHALL stay in `SKILL.md`; substantial mode- or selector-specific procedures
SHALL be disclosed through references loaded only for the selected mode or
selector; copied predecessor prose and duplicate policy SSOTs SHALL fail
review.

#### Scenario: A family has multiple substantial modes

- **WHEN** a family mode contains procedure or reference material not needed by every other mode
- **THEN** the entrypoint links that material behind a mode-specific context pointer and does not preload sibling modes

### Requirement: Flow families expose bounded parameter discovery

The `flow-guide` family SHALL expose read-only `help` for its own grammar and
for another Codex-visible Skill. The `flow-drive` family SHALL expose one
explicit implementation entry for a confirmed specification or OpenSpec
change, SHALL use the inventory Usage Grammar for parameter discovery, and
SHALL not add a workflow mode or independent help owner.

#### Scenario: User reviews flow-guide parameters

- **WHEN** a user invokes `$flow-guide help flow-guide`
- **THEN** the result shows the finite actions, route-only `--go` option,
  query input, authority, and examples without executing a route

#### Scenario: User reviews flow-drive parameters

- **WHEN** a user invokes `$flow-guide help flow-drive`
- **THEN** the result shows the required confirmed-spec-or-change-id input,
  Worker Selector syntax, explicit worker-target syntax, architecture
  switches, and explicit-only authority without starting implementation

#### Scenario: User invokes flow-drive without a confirmed specification

- **WHEN** `flow-drive` receives no confirmed specification or OpenSpec change
  identity
- **THEN** it reports the bounded input failure and does not reinterpret the
  request as route selection, proposal authoring, or help execution

#### Scenario: A caller attempts to add a flow-drive mode

- **WHEN** a proposed usage contract adds a mode selector to `flow-drive`
- **THEN** family validation rejects it and preserves the single explicit
  implementation entry

### Requirement: Self-contained skill consolidation has a closed ownership mapping

SCF-REQ-001: The self-contained consolidation SHALL use exactly this stable-ID predecessor mapping. Each successor SHALL directly own its internal capabilities and SHALL NOT invoke a removed predecessor at runtime. Internal references/scripts SHALL NOT become separately discovered skills. New successor stable IDs and inventory public names SHALL be `swift`, `react`, `nextjs`, `python`, `js-static-checks`, `php`, and `yii1`; `opsx-apply-resume` and `change-verdict` SHALL retain their existing identities. Provider namespaces SHALL remain governed by existing projection rules.

| Predecessor stable ID | Successor stable ID |
| --- | --- |
| `opsx-load-context` | `opsx-apply-resume` |
| `opsx-post-obs` | `opsx-apply-resume` |
| `swift-language` | `swift` |
| `swiftui-architecture` | `swift` |
| `swift-test-strategy` | `swift` |
| `ios-platform` | `swift` |
| `xcode-build-tooling` | `swift` |
| `ios-icon-gen` | `swift` |
| `react-18-notes` | `react` |
| `react-19-notes` | `react` |
| `nextjs-15-5-notes` | `nextjs` |
| `nextjs-16-notes` | `nextjs` |
| `python-pro` | `python` |
| `python-static-checks` | `python` |
| `pytest-async` | `python` |
| `fastapi-pro` | `python` |
| `js-lint-config` | `js-static-checks` |
| `js-static-check-strategy` | `js-static-checks` |
| `php-pro` | `php` |
| `php-modern-pro` | `php` |
| `php-8x-features` | `php` |
| `php56-yii-dev` | `yii1` |
| `yii1-security-audit` | `yii1` |
| `review-pending` | `change-verdict` |
| `dep-audit` | `change-verdict` |

This is a separate closed mapping from the historical predecessor matrix; it SHALL NOT alter or extend that historical wave. `flow-drive`, `dhpk-cli-transport`, `dhpk-cli-dispatch-context`, `dhpk-codex-bridge`, and `dhpk-agy-fast-worker` SHALL be fully excluded from file movement, route changes, helper consolidation, and exposure changes. No universal router or adapter framework SHALL be introduced by this consolidation.

#### Scenario: Selected family replaces its predecessors

- **WHEN** an affected selection installs the consolidated successor
- **THEN** the successor owns the mapped capabilities, old mapped entries are absent from discovery, and internal resources do not appear as peer skills

#### Scenario: Mapping or excluded owner is changed

- **WHEN** consolidation validation encounters an extra/remapped predecessor or a changed excluded skill/selection
- **THEN** it fails with the identity and unexpected change instead of treating directory count as authority to expand scope

### Requirement: Consolidated families preserve specialist task outcomes

SCF-REQ-005: Internal on-demand resources SHALL preserve useful predecessor behavior and verification, including Swift icon generation scripts and asset outputs, Swift testing/build/platform workflows, Python testing/static-check/FastAPI workflows, PHP 5.6/7.4/8.x runtime restrictions, and Yii security. PHP runtime/language routing SHALL belong to `php`; Yii framework/security behavior SHALL belong to `yii1`. Consolidation SHALL NOT erase legacy compatibility or flatten distinct task/version behavior into generic advice.

#### Scenario: Swift icon task is selected

- **WHEN** a caller requests supported icon asset generation through `swift`
- **THEN** the family selects its local icon procedure/scripts and preserves the expected asset outputs and verification without loading every Swift reference

#### Scenario: Python specialist task is selected

- **WHEN** a caller requests testing, static checks, or FastAPI work through `python`
- **THEN** the matching specialist resources and output checks apply rather than one undifferentiated Python procedure

#### Scenario: Legacy PHP or Yii task is selected

- **WHEN** the target is PHP 5.6/7.4/8.x or Yii 1.1
- **THEN** `php` applies the established target runtime restrictions and `yii1` applies framework/security guidance without suggesting unsupported newer-runtime APIs

### Requirement: Opsx directly owns Resume and Save helper behavior

SCF-REQ-006: `opsx-apply-resume` SHALL directly own the complete local procedures/scripts formerly exposed by `opsx-load-context` and `opsx-post-obs`. Resume SHALL retain memory, compact JSON, then handoff fallback, returning `BLOCKED` only when all three provide no usable content. Observation posting SHALL occur only in Save and preserve asynchronous overlap, result collection/waiting before handoff completion, and existing observation-ID/null semantics. Optional-service failure SHALL NOT be confused with required local asset failure or reported as successful saving. Existing safe-destination and write-boundary protections SHALL remain intact.

#### Scenario: Earlier Resume context sources are unavailable

- **WHEN** memory and compact context provide no usable data but a valid handoff does
- **THEN** Resume uses the handoff and reports its context source instead of blocking on the earlier sources

#### Scenario: No Resume context is usable

- **WHEN** memory, compact JSON, and handoff all provide no usable context
- **THEN** Resume returns `BLOCKED` without inventing context

#### Scenario: Optional observation service fails

- **WHEN** Save's optional observation service is denied or unavailable
- **THEN** Save preserves the existing null/failure record and required result-collection semantics without claiming that observation persistence succeeded

#### Scenario: Resume is selected

- **WHEN** the workflow enters Resume rather than Save
- **THEN** it performs no observation-posting side effect
