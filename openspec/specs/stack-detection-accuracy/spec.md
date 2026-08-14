# stack-detection-accuracy Specification

## Purpose
TBD - created by archiving change tune-goal-fastworker-and-reviewer-integrity. Update Purpose after archive.
## Requirements
### Requirement: Reviewer runtime fallback stack detection is root-manifest-first

Runtime fallback stack detection used by reviewer/trap-sheet loading SHALL be owned by `agent-traps/_common/trap-sheet-loader.md`, with duplicated reviewer prose synchronized to that contract. A root `package.json` SHALL emit the generic `js` signal. A `vue` key in `dependencies`, `devDependencies`, or `peerDependencies` SHALL additionally emit `vue`; `next` and `react` remain covered by `js` because versioned Next/React modules are explicitly configured, not inferred by this fallback. PHP SHALL emit only from a root `composer.json` or PHP files directly under the repository root (`./*.php`). Detection SHALL NOT recursively derive signals from `node_modules/`, `vendor/`, or other vendored trees. Explicit `DHPK_ACTIVE_MODULES` SHALL retain precedence.

SessionStart's configured module activation is not an automatic detector and SHALL remain unchanged: the set of modules activated for a session SHALL continue to come from configuration alone, never from detected evidence. SessionStart MAY additionally **validate** the configured set against detected project evidence and advise the user when the two contradict, but SHALL NOT derive, add, remove, or activate any module from that evidence. Validation is advisory only; any change to the configured set requires an explicit user action.

#### Scenario: Next.js repo is not misdetected as PHP

- **WHEN** detection runs in a repository whose root `package.json` depends on `next` and whose only PHP files live under `node_modules/`
- **THEN** fallback detection emits `js` and emits neither `php` nor a versioned Laravel module

#### Scenario: Genuine polyglot repo enables both profiles

- **WHEN** a repository has both a root `composer.json` and a root `package.json` with framework dependencies
- **THEN** detection enables both the PHP and JS module profiles

#### Scenario: Vendored signals are ignored

- **WHEN** framework markers exist only under `vendor/` or `node_modules/`
- **THEN** those markers contribute nothing to the detected profile

#### Scenario: Configured modules retain precedence

- **WHEN** `DHPK_ACTIVE_MODULES` is explicitly set for the session
- **THEN** reviewer/trap-sheet loading uses that configured set instead of deriving a replacement from repository manifests

#### Scenario: SessionStart validation does not change the activated module set

- **WHEN** SessionStart validation finds that the configured module set contradicts the project's detected evidence
- **THEN** the modules activated for that session are still exactly the configured ones, and the contradiction is surfaced as advice rather than applied
