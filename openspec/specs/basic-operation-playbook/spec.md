# basic-operation-playbook Specification

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

Define paired basic-operation guides that route installation, maintenance, verification, and release preparation using the current supported surfaces and explicit evidence boundaries.

## Requirements

### Requirement: The basic-operation guide presents a surface-first decision path

The paired `docs/basic-operations.md` and `docs/basic-operations.zh-TW.md` guides SHALL distinguish Claude marketplace, `--plugin-dir` development, `scripts/install.sh` convenience installation, supported project-local Codex sync, Cursor sync, and experimental native Codex and AGY adapters. The guide SHALL lead readers from install and verification to the correct invocation surface instead of treating management commands as skill execution, and SHALL name the exact four-capability clean-install default.

#### Scenario: New user installs dhpk

- **WHEN** a reader follows the basic-operation guide from an empty project
- **THEN** the guide gives one supported Claude install path, the immediate setup/verification steps, and a separate optional Codex path with its support tier

#### Scenario: User already has Codex projection

- **WHEN** a reader updates a project that has a project-local `.codex` receipt
- **THEN** the guide tells the reader to update Claude first, use a persistent plugin root in a normal terminal, and choose `--migrate --update` when the receipt or names predate consolidation

### Requirement: The guide reflects the evidence-backed daily dhpk workflow

The guide SHALL express the recommended sequence: inspect repository/session state, choose the host-appropriate `flow-guide`, `flow-drive`, or explicit family-skill route, use TDD and impact checks before implementation edits, satisfy review/verification gates, and hand off with a single next command. For unclear multi-session work it SHALL point to the wayfinder/OpenSpec planning boundary; for confirmed changes it SHALL distinguish `opsx:new`/`opsx:ff`, `opsx:apply`, verification, and archive.

#### Scenario: User starts a new feature or bug request

- **WHEN** the destination is clear and the work fits one normal session
- **THEN** the guide points to the matching feature/bug route and its required test/review gates without adding unnecessary planning ceremony

#### Scenario: User has an unclear multi-session change

- **WHEN** ownership or destination is unclear and the work will span sessions
- **THEN** the guide points to a decision checkpoint and OpenSpec proposal/specification before implementation, and does not describe the plan as a completed fix

#### Scenario: OpenSpec implementation is finished

- **WHEN** code and tests pass but apply checkboxes or archive evidence are missing
- **THEN** the guide states that the lifecycle is not complete and points to verify/apply/archive as the remaining handoff

### Requirement: Operational examples remain safe and current

Operational examples SHALL not rely on an unset `CLAUDE_PLUGIN_ROOT` in a normal terminal, shall label snapshot-specific versions/counts as dated evidence or omit them, and shall state the current safety boundaries for official Claude validation, Codex ownership/collisions, copy/symlink updates, native Codex support, and ignored OpenSpec artifacts. The guide SHALL link behavior to the concrete SSOTs `rules/execution-policy.md`, `docs/configuration.md`, `docs/skill-platform-migration.md`, `manifests/distribution-inventory.json`, the relevant OpenSpec specs, and the installer scripts rather than restating their full implementation details.

#### Scenario: Reader copies a normal-terminal Codex command

- **WHEN** the reader runs the command outside a Claude Code plugin session
- **THEN** the command uses an explicit persistent `DHPK_ROOT` (or equivalent) and does not expand an unavailable `CLAUDE_PLUGIN_ROOT`

#### Scenario: Reader verifies an installation

- **WHEN** repository validators pass but the official Claude validator or installed consumer surface has not been checked
- **THEN** the guide identifies the missing evidence and does not claim the installation is fully verified

#### Scenario: Reader encounters a collision or stale receipt

- **WHEN** project-local Codex entries are edited, unowned, legacy, or ambiguous
- **THEN** the guide tells the reader to preserve/report them and use the explicit migration/update path rather than silently overwriting them

#### Scenario: Reader uses copy mode

- **WHEN** the reader selects Codex copy mode and later changes canonical dhpk content
- **THEN** the guide states that copy mode requires an explicit `--update` reconciliation and points to fingerprint/diff verification, while symlink mode follows the source path

#### Scenario: Reader sees native Codex installation success

- **WHEN** `codex plugin` reports a native package installed
- **THEN** the guide still labels native Codex as experimental and points to `install-codex-skills.sh` as the supported project-local path

#### Scenario: Reader plans with ignored OpenSpec artifacts

- **WHEN** `openspec validate` passes for a change under the ignored `openspec/changes/` directory
- **THEN** the guide distinguishes validation from version-control delivery and explains that explicit force-add/export is required when the artifacts must be handed off

### Requirement: English and Traditional Chinese operation guides stay paired

The English and Traditional Chinese guides SHALL contain the same section structure, command semantics, support-tier claims, warnings, and verification steps. Links to the configuration, migration, routing, execution-policy, distribution-inventory, installer, and OpenSpec sources SHALL resolve from both locales, and changes to one guide SHALL trigger a parity check.

#### Scenario: A command contract changes

- **WHEN** an installation, invocation, migration, or lifecycle command changes
- **THEN** both basic-operation guides are updated in the same change and their links/anchors are checked

#### Scenario: A reader chooses either locale

- **WHEN** a reader opens the English or Traditional Chinese guide
- **THEN** both guides lead to the same supported behavior and do not present conflicting support tiers or completion claims

### Requirement: Marketplace preparation does not retire current installation routes

The bilingual guides SHALL distinguish the portable OpenAI submission candidate from a published daily installation route. They SHALL identify the candidate as unpublished until platform publication is verified, preserve current compatibility installation instructions, and disclose that the replacement cutover executor and legacy-route retirement remain unimplemented. Local developer installation and static package validation MUST NOT imply platform approval or publication.

#### Scenario: A consumer follows the guide before publication

- **WHEN** the candidate has not been published in the platform directory
- **THEN** the guide describes the preparation and developer route and retains current compatibility procedures without claiming the cutover has shipped

### Requirement: Context and discovery measurement remains explicit research

The paired guides SHALL describe context and discovery baselines as optional
research rather than prerequisites for ordinary installation or consumer
acceptance. When a reader explicitly requests a performance, cost, discovery,
or related defect study, the guides SHALL point to the existing strict
measurement contract, preserve its eight-scope and missing-evidence semantics,
and distinguish its result from installation acceptance, native-runtime
observation, and Host support or availability. A request to measure SHALL NOT
by itself authorize a real Host or model workflow.

#### Scenario: Reader follows the ordinary verification route

- **WHEN** a reader verifies a selected installation without requesting a
  context or discovery study
- **THEN** the guide does not require a full baseline or cross-Host model
  workflow for that acceptance result

#### Scenario: Reader explicitly requests context or discovery research

- **WHEN** a reader's task explicitly requires context, discovery, performance,
  cost, or related defect measurements
- **THEN** the guide directs the reader to the strict eight-scope measurement
  contract and states that each required scope needs its own passing evidence

#### Scenario: A research result is reported

- **WHEN** a measurement report covers only the requested research scope
- **THEN** the guide does not present it as installation success, native-runtime
  verification, or a change in Host support or availability
