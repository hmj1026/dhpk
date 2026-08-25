# skill-retirement-migration Specification

## Purpose
Define an alias-free, inventory-owned retirement contract that preserves successor guidance, installation ownership safety, deterministic projections, and explicit rollback behavior.

## Requirements

### Requirement: Retired skills have stable migration identities
Every retired skill SHALL have one non-discovery-visible inventory record containing its former stable ID, former public name, canonical path, prior surfaces, retirement release, reason, rollback pin, and one or more replacement rows. Each replacement row SHALL declare `skill`, `agent`, or `model-default` plus an identity or mode when applicable. Retirement records MUST NOT be materialized as skill packages or discovery aliases.

#### Scenario: Skill successor is another skill or mode
- **WHEN** a caller resolves a retired Bug, Feature, post-development test, or brainstorm identifier
- **THEN** the diagnostic names the former identity and its inventory-owned successor skill, mode, or agent route without publishing the former package

#### Scenario: Skill retires to model-default behavior
- **WHEN** a caller resolves `dhpk-de-ai-flavor`
- **THEN** the diagnostic identifies an intentional model-default retirement and does not invent a successor skill

### Requirement: Retired invocation fails closed with guidance
Dhpk-owned dispatch, helper, package, and installation interfaces that can intercept a retired stable ID or public name SHALL reject or annotate it with a stable retirement diagnostic and successor guidance. Unknown identifiers SHALL remain distinguishable from retired identifiers. Direct host Skill invocation bypasses repository-owned seams and SHALL be documented as unsupported after alias-free retirement.

#### Scenario: Retired ID reaches a dhpk-owned interface
- **WHEN** a dhpk-owned dispatcher, helper, package, or installation interface receives a retired stable ID or public name
- **THEN** it exits non-zero and reports the retirement release, replacement kind, and successor identity or model-default guidance

#### Scenario: Unknown ID reaches a standard dispatcher
- **WHEN** a standard dispatcher receives an identifier absent from both active and retired inventory records
- **THEN** it returns an unknown-identifier diagnostic rather than a retirement diagnostic

#### Scenario: Direct host invocation bypasses dhpk interfaces
- **WHEN** a host attempts to invoke the removed public name without passing through a dhpk-owned seam
- **THEN** documentation allows the host-owned unknown-skill response and points operators to migration documentation rather than requiring an alias

### Requirement: Retirement reconciliation preserves unowned work
Upgrade and reconciliation paths SHALL remove a retired installed entry only when the receipt proves dhpk ownership and the observed fingerprint still matches the receipt. Modified, retargeted, or unowned entries MUST remain unchanged and SHALL be reported as conflicts or orphans.

#### Scenario: Owned unchanged retired entry is present
- **WHEN** an installed retired entry is receipt-owned and its observed fingerprint equals the recorded fingerprint
- **THEN** reconciliation removes that entry and updates the receipt without touching unrelated paths

#### Scenario: Retired entry was modified or is unowned
- **WHEN** an installed path for a retired identity is modified, retargeted, or lacks matching ownership evidence
- **THEN** reconciliation preserves the path, reports its ownership classification and fingerprint evidence, and does not claim a clean migration

### Requirement: Successor behavior and route closure precede deletion
Canonical deletion SHALL occur only after each non-model-default successor owns the migrated unique behavior, every live route and reference resolves to an active identity, repository reference validation passes, inventory generation preserves the retirement ledger, projection provenance includes its identity, and generated surfaces contain neither the retired package nor a discovery alias.

#### Scenario: A successor still delegates to a retired skill
- **WHEN** an active skill, command, agent, rule, route table, test, or generated projection still delegates to a retired identity
- **THEN** retirement validation fails and canonical deletion is not accepted

#### Scenario: Retirement closure is complete
- **WHEN** migrated behavior is present under active successors, all live references resolve, and deterministic projections are regenerated
- **THEN** validation accepts the canonical removal and reports the retired identities separately from active counts

### Requirement: Rollback is version pinning rather than hidden aliasing
Rollback for an alias-free retirement SHALL use the last compatible release package and its receipts. The retiring release MUST NOT retain hidden canonical sources or discovery-visible aliases solely for rollback.

#### Scenario: Operator requests rollback
- **WHEN** an operator must restore a retired workflow after installing the retiring release
- **THEN** guidance pins release `0.46.1` and applies its receipt-bound installation path instead of reconstructing an alias in the new release

### Requirement: Context evidence remains stage-honest
Retirement reporting SHALL distinguish static canonical and discovery-description reductions from installed and live consumer evidence. A reduced inventory or generated package SHALL NOT be reported as observed runtime context savings.

#### Scenario: Static retirement validation passes without a live consumer probe
- **WHEN** canonical counts, description totals, and generated projections pass but no exact-artifact consumer probe ran
- **THEN** the report records structural/package results and leaves runtime evidence as `NOT_RUN`, `UNAVAILABLE`, `NOT_CONFIGURED`, or `BLOCKED`
