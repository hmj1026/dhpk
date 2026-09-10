# skill-content-hygiene Specification

## Purpose
Keep shared skill guidance single-sourced, mechanically verifiable, and within
the repository's discovery and content-size budgets.
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
A skill or command step whose logic is fully deterministic (fixed command sequences, manifest-based detection, measurement thresholds) SHALL delegate to a script rather than restating the logic as prose. Specifically: the precommit commands SHALL delegate ecosystem detection and step ordering solely to `scripts/precommit-runner.js`; the release flow's fixed git/gh sequence SHALL run via a release-runner script; feature-verify's health probe and API-exec harness SHALL be scripts. Every new script SHALL have a test per the script test coverage policy.

#### Scenario: precommit prose fallback removed
- **WHEN** `commands/precommit.md` and `commands/precommit-fast.md` are read after this change
- **THEN** neither contains the ecosystem-detection fallback table; both invoke `precommit-runner.js` (differing only by `--mode`)

#### Scenario: Release sequence scripted
- **WHEN** the release-creator flow reaches the mechanical git/gh steps
- **THEN** it invokes the release-runner script with resolved tokens; config resolution and changelog authoring remain prose/judgment

#### Scenario: New scripts are tested
- **WHEN** `node tests/run-all.js` runs after this change
- **THEN** each newly added script has a discoverable `tests/<stem>*.test.js` that passes

### Requirement: SKILL.md size budget is CI-enforced with a shrink-only allowlist
`scripts/ci/validate-skills.js` SHALL warn for SKILL.md files over 150 total lines and fail over 250 total lines (basis: `wc -l`, strictly greater-than), except for files on a checked-in grandfathered allowlist re-derived from that basis at seed time; the check SHALL fail if the allowlist grows or a delisted file regresses.

#### Scenario: New oversized skill fails CI
- **WHEN** a new skill with a 300-line SKILL.md (not allowlisted) is added and `validate-skills.js` runs
- **THEN** validation fails naming the file and the budget

#### Scenario: Grandfathered file passes until demoted
- **WHEN** an allowlisted 300-line SKILL.md is unchanged
- **THEN** validation passes; once its demotion drops it below 250 it is removed from the allowlist and may not return

#### Scenario: Demotions land in this change
- **WHEN** the demotion tasks complete
- **THEN** `feature-verify`, `rules-distill`, and `codex-code-review` SKILL.md files are ≤250 total lines, `issue-analyze` is ≤180 total lines, and the moved content is present under each skill's `references/`
