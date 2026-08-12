# rules-ssot-dedup Specification

## Purpose
TBD - created by archiving change do-flags-and-harness-consolidation. Update Purpose after archive.
## Requirements
### Requirement: The `${CLAUDE_PLUGIN_ROOT}` caveat has one SSOT home
The interpolation-token caveat currently stated in three files (`rules/execution-policy.md`, `skills/dhpk-execution-policy/references/review-gate-mechanics.md`, and — embedded in a table row without a sync marker — `skills/execution-checklist/SKILL.md`) SHALL live in exactly one SSOT location; the other two locations SHALL carry a one-line pointer instead of the full text, and the keep-in-sync HTML comment markers (present in the first two files) SHALL be removed.

#### Scenario: Single full statement remains
- **WHEN** the repository is searched for the caveat's distinctive phrasing
- **THEN** exactly one file carries the full text and the other former mirrors carry pointers only

### Requirement: tool-routing decision tree drift is reconciled
The decision tree duplicated between `rules/tool-routing.md` (compact card) and `skills/tool-routing/references/decision-tree.md` (rich prose) SHALL be diffed once; any semantic divergence SHALL be reconciled with the rules file as authoritative, and the skill reference SHALL state that the compact card in `rules/tool-routing.md` is the SSOT for routing order. Command entry points SHALL normalize flags into one immutable route result and SHALL reference this SSOT rather than restating competing precedence or dispatch rules.

#### Scenario: Divergence resolves toward the rule
- **WHEN** the two decision trees disagree on a routing order or tie-breaker
- **THEN** the skill reference is updated to match `rules/tool-routing.md` and gains an SSOT pointer line

#### Scenario: Command prose duplicates a conflicting route
- **WHEN** `commands/do.md` contains a precedence or dispatch rule that differs from the deterministic route result or SSOT
- **THEN** policy validation fails with both locations

#### Scenario: Flags produce one normalized route
- **WHEN** a command invocation includes worker, reasoner, architect, OpenSpec, or Codex flags
- **THEN** the parser emits one normalized route result consumed by workflow policy

### Requirement: Opsx save and resume preserve live worktree state without implicit commit
The opsx handoff contract SHALL treat the live worktree and task artifacts as the source of truth. Commit, memory posting, precommit, and optional providers SHALL be explicit gates; changing sessions SHALL not be described as reverting or deleting uncommitted files.

#### Scenario: Resume without commit
- **WHEN** a user starts a new session with uncommitted task artifacts still present in the worktree
- **THEN** resume reads those artifacts and does not require or imply a commit

#### Scenario: Optional provider is unavailable
- **WHEN** compact, memory, or precommit capability is absent
- **THEN** the handoff records the unavailable optional gate and still preserves the live-state handoff

#### Scenario: User explicitly requests a commit
- **WHEN** the user authorizes a commit as a separate action
- **THEN** the workflow may run the commit gate without making it a prerequisite for saving or resuming
