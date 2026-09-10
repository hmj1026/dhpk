# command-preflight Specification

## Purpose
Ensure PR creation performs a deterministic branch preflight and references
only skills that are actually shipped by the plugin.
## Requirements
### Requirement: create-pr verifies commits ahead of base before invoking gh
The create-pr command SHALL run `git rev-list --count <base>..HEAD` (base = the repo's default/target branch) during its context gathering and SHALL abort with a clear message before any `gh pr create` call when the count is 0.

#### Scenario: Zero-ahead branch fast-fails
- **WHEN** the current branch has no commits ahead of the base branch
- **THEN** create-pr aborts with a message like `No commits between <base> and HEAD — nothing to open a PR for` and does not call gh

#### Scenario: Branch with commits proceeds
- **WHEN** the current branch is ahead of base by ≥1 commit
- **THEN** the normal create-pr flow continues

### Requirement: create-pr does not reference nonexistent skills
The create-pr command file SHALL NOT instruct following a skill that does not exist in the plugin.

#### Scenario: Dangling skill reference removed
- **WHEN** `commands/create-pr.md` is validated
- **THEN** it contains no reference to a `create-pr` skill directory absent from the repo
