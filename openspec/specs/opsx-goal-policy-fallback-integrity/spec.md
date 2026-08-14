# opsx-goal-policy-fallback-integrity Specification

## Purpose
TBD - created by archiving change harden-opsx-goal-policy-fallbacks. Update Purpose after archive.
## Requirements
### Requirement: Goal orientation resolves a bounded policy candidate chain

The generated `/goal` orientation command SHALL try a readable policy in this order: explicit `CLAUDE_PLUGIN_ROOT`, newest readable installed dhpk cache, the fixed source-checkout pair `./.claude-plugin/plugin.json` and `./rules/execution-policy.md`, then `POLICY-UNRESOLVED`.

#### Scenario: Explicit plugin root wins

- **WHEN** `CLAUDE_PLUGIN_ROOT/rules/execution-policy.md` is readable
- **THEN** the orientation reads that policy and does not use cache or source fallback

#### Scenario: Stale explicit root yields to cache

- **WHEN** the explicit plugin-root policy is missing or unreadable and the newest installed
  cache policy is readable
- **THEN** the orientation reads the cache policy before considering the source checkout

#### Scenario: Self-hosted source checkout resolves

- **WHEN** no explicit or cache policy is readable, the source marker exists at
  `./.claude-plugin/plugin.json`, and `./rules/execution-policy.md` is readable
- **THEN** the orientation reads the repository-local policy and does not emit
  `POLICY-UNRESOLVED`

#### Scenario: Consumer project remains unresolved

- **WHEN** no explicit or cache policy is readable and the fixed source marker/policy pair is
  absent
- **THEN** the orientation emits `POLICY-UNRESOLVED` and continues with inline gates

### Requirement: Policy fallback is fixed-root and scan-free

The source fallback SHALL inspect only the fixed current checkout paths and SHALL NOT scan parent directories, sibling directories, or arbitrary filesystem locations.

#### Scenario: Parent policy exists

- **WHEN** the current checkout has no source marker/policy pair but a parent directory contains
  `rules/execution-policy.md`
- **THEN** the orientation emits `POLICY-UNRESOLVED` and does not read the parent policy

#### Scenario: Known cache lookup remains bounded

- **WHEN** the installed cache candidate is evaluated
- **THEN** the orientation uses only the existing known dhpk cache-root lookup and does not add
  a general filesystem search

### Requirement: Unresolved policy preserves reviewer artifact evidence

When policy resolution emits `POLICY-UNRESOLVED`, both generated goal dispatch modes SHALL state that every reviewer dispatch, including confirm-only review, names the canonical review artifact path, writes a fresh artifact before satisfying the gate, and does not substitute a reply-only confirmation.

#### Scenario: Normal reviewer dispatch in fallback mode

- **WHEN** policy resolution is unresolved and a reviewer is dispatched
- **THEN** the goal includes `.claude/artifacts/reviews/<agent>-{yyyymmdd-HHMMSS}-{slug}.md` and
  requires a fresh written artifact before completion

#### Scenario: Confirm-only reviewer dispatch in fallback mode

- **WHEN** policy resolution is unresolved and a known finding receives a confirm-only review
- **THEN** the same canonical fresh-artifact requirement remains active and reply-only confirmation
  does not satisfy the gate

#### Scenario: Sentinel and verdict boundaries remain unchanged

- **WHEN** the fallback artifact clause is used
- **THEN** existing hook-owned sentinel clearance and `.unresolved-verdict` handling remain the
  authoritative lifecycle and verdict boundaries
