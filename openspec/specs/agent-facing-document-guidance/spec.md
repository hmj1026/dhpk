# agent-facing-document-guidance Specification

## Purpose

TBD - created by archiving change repair-open-issues-and-agent-guidance. Update Purpose after archive.

## Requirements

### Requirement: Agent-facing documents expose a short context pointer

Every new or materially changed agent-facing skill, command, or procedure SHALL state its trigger/use context and its immediate non-use boundary in the always-loaded description or opening section. The pointer SHALL route to the detailed instructions without duplicating them.

#### Scenario: Agent chooses between neighboring skills

- **WHEN** a request matches two adjacent workflows
- **THEN** the descriptions identify the decisive trigger and the `When NOT to Use` boundary before the agent loads detailed mechanics

### Requirement: Detailed guidance uses progressive disclosure and one source of truth

Agent-facing guidance SHALL put the primary path and required decisions in the main file, move optional mechanics/examples to a co-located reference, and link to an authoritative existing document instead of copying it. For execution-policy rules the authoritative source is `rules/execution-policy.md`; for distribution-surface ownership the authoritative source is `docs/distribution-surfaces.md`. A proposed addition that produces no behavioral knowledge delta SHALL be pruned.

#### Scenario: Optional procedure is not needed

- **WHEN** an agent can complete the primary workflow without an advanced reference
- **THEN** the main skill remains sufficient and the optional reference is not required to be loaded

#### Scenario: Existing policy already owns a rule

- **WHEN** a new skill needs an execution-policy rule
- **THEN** it links to `rules/execution-policy.md` and does not create a second conflicting copy

#### Scenario: Distribution ownership is referenced

- **WHEN** a procedure describes generated or installed distribution surfaces
- **THEN** it links to `docs/distribution-surfaces.md` and does not restate its inventory as an independent source

### Requirement: Authoritative source and format are verified before authoring

Before materially changing an agent-facing skill, command, or operational document, the author SHALL resolve the current authoritative technical source through Context7 when the relevant library, framework, SDK, API, or CLI is indexed. When no suitable Context7 entry exists, the author SHALL use the owning official documentation. The author SHALL record the source identity, version or retrieval date, query or URL, claims covered, and the applicable repository/consumer format validator before declaring the content verified. Unresolved source or format questions SHALL remain explicitly marked and SHALL NOT be presented as confirmed guidance.

#### Scenario: Context7 has an authoritative entry

- **WHEN** a skill documents a library, SDK, framework, API, or CLI with a matching Context7 entry
- **THEN** the author queries the relevant version/topic, records the source and query in the change evidence, and aligns examples and format with that result

#### Scenario: Context7 has no suitable entry

- **WHEN** the relevant technical source is absent or ambiguous in Context7
- **THEN** the author uses the owning official documentation, records its URL/version/date, and does not fill the gap from model memory alone

#### Scenario: Skill format is changed

- **WHEN** frontmatter, invocation metadata, section structure, or reference links are added or changed
- **THEN** the author runs the applicable repository lint/strict validator and the official consumer validator when available, records exit status, and blocks completion on a format failure

#### Scenario: Source cannot be verified

- **WHEN** no authoritative source or applicable format validator can be identified
- **THEN** the change records `NOT VERIFIED` with the unresolved claim and requires an owner decision before the text is published as normative guidance

### Requirement: Completion is stated as checkable evidence

Each agent-facing workflow SHALL define completion evidence, verification commands or observations, and the handoff state that permits the next workflow. Wording SHALL prevent an agent from treating a plan, recommendation, or generated script as an applied change.

#### Scenario: Plan hands off to implementation

- **WHEN** a planning workflow has produced a reviewed plan but no code or artifact application
- **THEN** its completion statement says the plan is ready for the implementation entry and does not claim the change is complete

#### Scenario: Generated procedure awaits a human

- **WHEN** a procedure contains interactive dashboard, credential, migration, or cutover steps
- **THEN** completion requires the human's confirmation and recorded outcome rather than the agent simulating execution

### Requirement: Human-only procedures have an explicit wizard boundary

Agent-facing setup guidance SHALL require repository inspection, a staged list of destinations and secret classifications, a human confirmation gate, and static validation of any generated script. Agents SHALL not execute the interactive or credential-bearing procedure autonomously.

#### Scenario: Setup requires a dashboard action

- **WHEN** the requested setup cannot be completed through repository-local deterministic commands
- **THEN** the agent prepares an inspectable, confirmation-gated procedure and waits at the human-action boundary

#### Scenario: Generated shell procedure is reviewed

- **WHEN** a human receives a generated setup script
- **THEN** the handoff includes syntax/static checks and destination tracing, while leaving execution to the human

### Requirement: Every agent-facing source surface has a contract disposition

The repository SHALL apply the writing-for-agents contract to every canonical skill, registered agent, rule, command, and repository guidance root. Each file SHALL be marked as updated, already compliant, or intentionally exempt in the implementation evidence. The pass SHALL preserve existing invocation classes, route targets, agent roster/model/tool boundaries, rule precedence, command flags, and Claude/Codex support tiers unless a separate requirement explicitly changes them.

#### Scenario: Canonical inventory is audited

- **WHEN** the document pass is complete
- **THEN** all canonical skills, agents, rules, commands, `AGENTS.md`, `CLAUDE.md`, and `codex/AGENTS.md` have a recorded disposition and none is silently omitted

#### Scenario: Existing document is already compliant

- **WHEN** a file already exposes a clear pointer, boundary, SSOT, and completion contract
- **THEN** the evidence records it as compliant without adding boilerplate or changing its semantics

#### Scenario: Normalization risks a runtime contract

- **WHEN** a proposed prose edit would change invocation metadata, a route-table target, an agent role boundary, rule precedence, command flags, or support tier
- **THEN** the edit is stopped or split into a separately specified behavior change rather than being smuggled into document cleanup

### Requirement: Root guidance is a minimal linked index

Repository root `AGENTS.md` and `CLAUDE.md` SHALL keep only universal project constraints and a concise pointer index; branch-specific implementation, testing, security, Git Flow, and platform mechanics SHALL live in linked topic documents. `codex/AGENTS.md` SHALL remain the Codex-specific projection and capability contract rather than duplicating Claude-only lifecycle details. Every link introduced or retained by the pass SHALL resolve in the repository.

#### Scenario: Agent loads root guidance

- **WHEN** an agent reads a root guidance file
- **THEN** it can identify the project, universal gates, and the exact linked document to load for the current branch without reading unrelated mechanics

#### Scenario: Claude and Codex boundaries differ

- **WHEN** a rule depends on Claude hooks, Codex roles, or a platform-specific installer
- **THEN** the owning guidance file states the boundary and links to the platform-specific contract instead of presenting the behavior as universal

### Requirement: Contract checks cover all document classes

The repository SHALL provide deterministic checks for the contract fields that each document class can express: skills expose trigger/non-use/output/verification and valid references; agents expose role scope, available tools/model, completion evidence, and handoff; rules expose SSOT/precedence ownership; commands expose route/invocation/failure/completion; root guidance exposes universal constraints and valid topic links. Checks SHALL report relative paths and SHALL fail on broken links or semantic drift in registered routes/rosters.

#### Scenario: Full contract check runs

- **WHEN** the complete source inventory is checked
- **THEN** the result reports category counts and zero unresolved P0/P1 contract findings, while leaving advisory findings visible

#### Scenario: Registered semantics remain stable

- **WHEN** contract normalization changes prose or section order
- **THEN** route-table targets, invocation metadata, agent roster/model/tool fields, rule precedence, command flag contracts, and support-tier markers compare equal before and after
