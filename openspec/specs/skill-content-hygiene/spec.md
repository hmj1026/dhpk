# skill-content-hygiene Specification

## Purpose

Keep shared skill guidance single-sourced, mechanically verifiable where it
has machine-readable contracts, and readable to people who use it.

## Requirements

### Requirement: Shared boilerplate blocks have exactly one normative home

The auto-loop banner, the codex-family Key-Rules trio (independent research / threadId / gate sentinels), and the feature-dev/bug-fix shared workflow blocks (fast-worker override handling, prohibited actions, codex-mode preamble, Test+Review phase, review-loop gate) SHALL each exist as full text in exactly one file; every other occurrence SHALL be a one-line citation of that home.

#### Scenario: Auto-loop banner deduplicated

- **WHEN** the repo is grepped for the auto-loop banner text after this change
- **THEN** the full banner exists in one normative home and the former 11 carriers contain at most a one-line cite

#### Scenario: Codex command wrappers cite review-common

- **WHEN** a codex-* command file is read
- **THEN** its Key-Rules section cites `skills/codex-code-review/references/review-common.md` instead of restating the trio

#### Scenario: feature-dev and bug-fix share one Test+Review source

- **WHEN** the Test+Review phase text is located after this change
- **THEN** it exists once (as a shared reference) and both skills cite it; neither carries a divergent copy

### Requirement: Deterministic prose rituals are script-backed

A skill or command step whose logic is fully deterministic (fixed command sequences, manifest-based detection, measurement thresholds) SHALL delegate to a script rather than restating the logic as prose. Specifically: the precommit commands SHALL delegate ecosystem detection and step ordering solely to the `precommit` Skill's package-local `scripts/precommit-runner.js`; the release flow's fixed git/gh sequence SHALL run via a release-runner script; feature-verify's health probe and API-exec harness SHALL be scripts. Whether to add a test for a script follows the risk-based script testing policy.

#### Scenario: precommit prose fallback removed

- **WHEN** `commands/precommit.md` and `commands/precommit-fast.md` are read after this change
- **THEN** neither contains the ecosystem-detection fallback table; both forward to the canonical `$precommit` Skill, whose package-local `precommit-runner.js` runs with `--mode full` or `--mode fast`

#### Scenario: Release sequence scripted

- **WHEN** the release-creator flow reaches the mechanical git/gh steps
- **THEN** it invokes the release-runner script with resolved tokens; config resolution and changelog authoring remain prose/judgment

### Requirement: Skill metadata and resources retain machine-readable validation

Shared validators SHALL continue to parse skill frontmatter and check structural metadata contracts. Resource-integrity tools SHALL continue to verify that required referenced resources resolve. These checks SHALL use small fixtures for parser behavior and SHALL NOT assert the prose, headings, examples, section order, or body length of an individual skill.

#### Scenario: Frontmatter structure is valid

- **WHEN** the skill validator reads a skill with valid frontmatter
- **THEN** it validates the machine-readable fields without enforcing a body-length budget

#### Scenario: Long skill prose passes structural validation

- **WHEN** a skill body exceeds a former line budget but its machine-readable metadata is valid
- **THEN** validation does not fail due to line count

#### Scenario: Resource integrity remains enforced

- **WHEN** a shipped skill references a required resource that does not resolve
- **THEN** the shared resource-integrity validator reports the unresolved reference
