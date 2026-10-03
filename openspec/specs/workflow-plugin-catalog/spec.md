# workflow-plugin-catalog Specification

## Purpose

Define the reviewed inventory-owned marketplace catalog, contained resource ownership, approved public identities, licensing exclusions, and workflow authority boundaries.

## Requirements

### Requirement: Every existing capability receives an explicit disposition

The publication selection SHALL account for every active canonical stable ID in the current distribution inventory. Approved removals SHALL remain traceable through retirement records rather than a fixed historical catalog count. Each capability MUST map to a public workflow,
conditional reference or branch, internal resource, or reviewed retirement.
Consolidation MUST preserve distinct behavior, version-specific safety,
resource ownership, and meaningful test coverage unless an explicit retirement
decision establishes that the behavior is no longer required. Generated
copies SHALL NOT be counted as additional capabilities.

#### Scenario: A specialist becomes a conditional reference

- **WHEN** a stack skill is removed from public discovery
- **THEN** its stable identity maps to a named owner, declared task/version conditions,
  bundled resource, and verification evidence, or to an approved retirement

#### Scenario: A capability has no successor evidence

- **WHEN** the disposition ledger omits an active baseline ID or loses unique behavior
- **THEN** catalog acceptance fails and identifies the unowned capability

### Requirement: Public workflows cover general tasks with conditional specialization

Default marketplace publication adapters SHALL derive the same selected common public workflow names and stable IDs from the reviewed selection. Bundled references and branches SHALL retain their declared owners and version conditions without becoming extra public entries. Host-only entries SHALL be selected separately by their declared surface. Explicit compatibility profiles remain separate supported selections; their directory counts MUST NOT become a fixed marketplace quota. Bundling a reference MUST NOT imply its deferred native task resolver or conditional-loading procedure has been implemented.

#### Scenario: A version-specific reference is bundled

- **WHEN** a capability is selected as a bundled reference
- **THEN** its stable identity, owner, source path, and declared version conditions remain in the disposition ledger without adding a public selector

#### Scenario: A Host ships an unexplained additional entry

- **WHEN** one retained Host exposes an extra public workflow without a distinct contract
- **THEN** cross-Host catalog validation rejects that entry

### Requirement: Candidate selection and broader renaming are evidence-led

Final publication membership SHALL use the reviewed selection ledger rather than treating an initial trial list as a fixed quota. Existing approved public names SHALL remain the naming baseline; broader task-oriented renames require user selection. Names MUST remain unique within the selected catalog and preserve stable identity and invocation class. Publication MUST exclude unresolved external ownership or licensing and record the exclusion and available owned alternative. Representative consumer evidence SHALL identify the workflows actually probed rather than claim every selected workflow has complete native acceptance.

#### Scenario: A publication name collides

- **WHEN** two selected stable IDs expose the same public name or an unapproved runtime alias
- **THEN** selection validation fails before package generation

#### Scenario: A task-oriented name has not been selected

- **WHEN** a proposed name such as `plan-work` appears in the recommendation list
- **THEN** generators retain the approved public name until the user selects a replacement

#### Scenario: An external wrapper has unresolved licensing

- **WHEN** an external-package-owned reference or wrapper lacks publication permission
- **THEN** its inclusion is blocked or explicitly excluded with an owned native alternative

### Requirement: Workflow authority does not imply publication actions

Workflow completion SHALL be defined by task outputs and scoped verification.
Commit, push, PR creation, release, deployment, and external messaging MUST
NOT become implicit completion actions. Read-only guidance, verdicts, and
verification MUST retain their authority boundary after consolidation.

#### Scenario: Implementation verification completes

- **WHEN** a workflow finishes an authorized code change and its checks
- **THEN** it reports the change and evidence without automatically committing, pushing, or publishing it

#### Scenario: A verifier finds a failure

- **WHEN** a read-only verification branch encounters a failed check
- **THEN** it reports the failure without silently running a fixing precommit pipeline
