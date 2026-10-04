# marketplace-submission-readiness Specification

## Applicability policy (#848/#854)

The applicable installation, structural, and package contract is the default
acceptance boundary. Native workflow, rendered discovery, context measurement,
and full Host observation are required only for an affected integration,
activation defect, or explicit native request. Required failures remain
blocking; excluded or historical `NOT_RUN`, `UNAVAILABLE`, and `BLOCKED` results
remain visible and are never synthesized as `PASS`. Ownership, compatibility,
coexistence, rollback, publication, and manual authorization requirements remain
in force.

## Purpose

Define the engineering deliverables and reproducible validation needed to hand off a skills-only OpenAI plugin submission, keeping platform account operations, scans, approval, and publication separate from local engineering evidence.

## Requirements

### Requirement: Submission ZIP contains a portable self-contained skills-only plugin

The submission artifact SHALL contain the accepted portable root `plugin.json`
and selected `skills/<name>/SKILL.md` packages with contained, readable UTF-8
resources. It MUST NOT ship the legacy OpenAI manifest, executable compatibility
install routes, lifecycle hooks, apps declarations, MCP declarations, or UI
screenshots. All bundled skills and declared resources MUST validate; an invalid
sibling cannot be silently omitted while the submission artifact is reported
as passing. Consumers MUST not depend on a source checkout or undeclared local
credentials, extra packages, dhpk rules, or custom-agent installation.

#### Scenario: A resource points outside the artifact

- **WHEN** a skill instruction resolves a supporting resource outside the extracted package
- **THEN** artifact validation fails with the skill and escaping or missing resource

#### Scenario: Unsupported content is bundled

- **WHEN** a candidate ZIP contains hooks, apps, or MCP declarations
- **THEN** the skills-only submission gate rejects the artifact

### Requirement: Archive and listing validation use current official constraints

The build SHALL produce a repeatable ZIP with release identity, selected stable
IDs, inventory and source provenance, and an artifact digest. Validation MUST
check the official schema and archive/listing limits current at release time,
including entry containment, readability, compressed/extracted size, entry
count, display/description fields, starter prompts, and supplied URLs.
Determinism MUST control archive ordering and metadata as well as file content.

#### Scenario: Identical release inputs are rebuilt

- **WHEN** the same accepted sources, selection, version, and build inputs generate two ZIPs
- **THEN** their archive digest and extracted files match

#### Scenario: A listing field exceeds the current limit

- **WHEN** a listing field violates the release-time official constraint
- **THEN** validation fails with the field, measured value, and applicable rule

### Requirement: Engineering handoff includes policy materials and consumer evidence

Handoff SHALL include the validated exact ZIP, metadata, privacy and support
materials with their publication status, third-party licensing review, release
notes, a user-operated submission checklist, and runtime/discovery evidence.
Before actual submission, privacy policy publication and usable support contact
MUST satisfy the official policy even where ZIP URL fields are schema-optional.
Selected workflows MUST have representative direct, indirect, follow-up,
negative, and boundary probes on Codex; ChatGPT Work SHALL be listed as
unverified in the handoff and checklist; retained Host catalog and coexistence evidence SHALL identify the actual tested configurations and any explicitly accepted, round-scoped exceptions. An exception MUST remain SKIPPED or NOT_RUN, MUST identify its follow-up, and MUST NOT change a strict runtime or discovery-budget evaluator into PASS.

Any schema-v2 consumer acceptance in the handoff SHALL identify its selected
surface scope and present required-check acceptance separately from raw runtime
observations. An installation `PASS` with runtime `NOT_RUN` establishes only
the selected installation contract; it MUST NOT satisfy a separately required
native probe or be described as completed Host-runtime evidence. The
[consumer acceptance contract](../../../docs/contracts/consumer-acceptance.md)
owns this result boundary.

#### Scenario: ZIP URL fields are absent

- **WHEN** a skills-only artifact passes schema without privacy/support URLs
- **THEN** the checklist still requires policy publication and usable support and does not claim a policy exemption

#### Scenario: Runtime evidence uses another artifact

- **WHEN** a probe tests a package with a different digest or selected catalog
- **THEN** it does not satisfy the delivered ZIP's runtime acceptance

#### Scenario: Installation acceptance is not native-runtime evidence

- **WHEN** a selected consumer installation passes while its raw runtime observation is `NOT_RUN`
- **THEN** the handoff reports installation acceptance and runtime observation independently and does not claim that a native probe passed

### Requirement: Engineering closure and platform milestones are independent

Engineering closure SHALL cover the explicitly accepted, implemented release scope and submission-preparation deliverables. Unimplemented retirement, migration, role adaptation, and unavailable native observations MUST have separate follow-up ownership. The closure record SHALL distinguish PASS from accepted round-scoped exceptions; it MUST NOT imply the complete retained-Host baseline passed.
Account verification, portal upload, platform scans, actual submit, approval,
and publication SHALL be tracked separately as user-operated steps. Each
unexecuted step MUST be NOT_RUN. Local schema or runtime PASS MUST NOT imply
platform scan PASS, approval, or publication, and a missing required engineering
probe MUST NOT be waived by the platform boundary.

#### Scenario: Engineering is accepted before portal upload

- **WHEN** all required engineering evidence and the complete preparation handoff are accepted
- **THEN** this requirement can close while portal operations remain NOT_RUN in their separate milestone

#### Scenario: A required engineering probe is unavailable

- **WHEN** selected-workflow or coexistence acceptance remains BLOCKED or NOT_RUN
- **THEN** engineering cannot close solely because a ZIP was built; any explicitly accepted exception remains labeled and separately tracked

### Requirement: Submission scope does not acquire MCP obligations implicitly

The release SHALL remain skills-only. MCP-specific review cases, demo recording,
OAuth, domain verification, and remote endpoint requirements MUST NOT be imposed
as this release's engineering gates. A later remote-tool product decision
requires a separately reviewed submission route rather than promising that MCP
can be added to this published skills-only plugin.

#### Scenario: A future request needs remote tools

- **WHEN** a subsequent feature requires an MCP server
- **THEN** planning rechecks the then-current platform route separately and preserves this release's skills-only artifact contract

### Requirement: Deferred acceptance work retains independent closure criteria

Engineering closeout SHALL separate missing native observations, post-publication cutover and route retirement, and native workflow or optional-role corrections into independently tracked work. Each accepted round-scoped exception MUST identify the unavailable capability, the preserved evidence status, the follow-up scope, and the evidence required to close it. Removed Review Gate or A1–A7 obligations MUST NOT be reconstructed as deferred release prerequisites. Tracking documents MUST distinguish a local planning artifact from a versioned delivery record.

#### Scenario: Claude quota prevents native observation

- **WHEN** static validation passes but the native workflow probe cannot run
- **THEN** the round records native SKIPPED and its observation follow-up without claiming native PASS or weakening the canonical evaluator

#### Scenario: A legacy route still executes

- **WHEN** a replacement cutover and retirement have not been implemented
- **THEN** the current compatibility contract remains accepted behavior and retirement stays in its separate follow-up
