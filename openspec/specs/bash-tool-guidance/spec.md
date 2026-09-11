# bash-tool-guidance Specification

## Purpose

Define the repository's canonical Bash working-directory hygiene and GitNexus
repository-context guidance for interactive and unattended workflows.

## Requirements

### Requirement: Rules document Bash cwd-reset hygiene

`rules/execution-policy.md` SHALL contain a Bash-hygiene subsection stating that the shell working directory resets between Bash calls and directing use of absolute paths, `npm --prefix <dir>`, and `git -C <dir>` instead of `cd`-dependent command chains.

#### Scenario: Guidance present in rules

- **WHEN** `rules/execution-policy.md` is read
- **THEN** it contains the cwd-reset statement and the absolute-path / `npm --prefix` / `git -C` directives

### Requirement: Unattended goal sessions carry the same Bash hygiene and gitnexus repo pre-fill

The opsx-apply-goal template SHALL include the Bash-hygiene rule, and multi-repo gitnexus examples in `rules/tool-routing.md` SHALL show the `repo="<project>"` parameter pre-filled.

#### Scenario: Goal string includes hygiene line

- **WHEN** an opsx-apply-goal `/goal` string is generated
- **THEN** it contains the cwd-reset / absolute-path guidance line

#### Scenario: tool-routing example pre-fills repo

- **WHEN** `rules/tool-routing.md`'s gitnexus example is read
- **THEN** the example invocation includes an explicit `repo` parameter
