# command-preflight Specification

## Purpose

Ensure PR creation performs a deterministic branch preflight and references
only skills that are actually shipped by the plugin.

## Requirements

### Requirement: create-pr verifies commits ahead of base before invoking gh

The create-pr command SHALL resolve the selected head and base once. An explicit `--head` wins; when it is omitted, the selected head is the current branch. It SHALL count commits with `git rev-list --count <selected-base>..<selected-head>` and SHALL abort with a message naming those refs before any `gh pr create` call when the count is 0. A checkout count SHALL NOT replace the selected range.

#### Scenario: Zero-ahead branch fast-fails

- **WHEN** the selected head has no commits ahead of the selected base
- **THEN** create-pr aborts with a message like `No commits between <selected-base> and <selected-head> — nothing to open a PR for` and does not call gh

#### Scenario: Explicit head is counted instead of the checkout

- **WHEN** the checkout has no commits ahead of the base and the explicit `--head` does
- **THEN** create-pr continues with that selected head

#### Scenario: Branch with commits proceeds

- **WHEN** the selected head is ahead of the selected base by ≥1 commit
- **THEN** the normal create-pr flow continues

### Requirement: create-pr does not reference nonexistent skills

The create-pr command file SHALL NOT instruct following a skill that does not exist in the plugin.

#### Scenario: Dangling skill reference removed

- **WHEN** `commands/create-pr.md` is validated
- **THEN** it contains no reference to a `create-pr` skill directory absent from the repo
