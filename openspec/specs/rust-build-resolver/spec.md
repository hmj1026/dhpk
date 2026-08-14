# rust-build-resolver Specification

## Purpose
TBD - created by archiving change dhpk-add-meta-toolkit-agents. Update Purpose after archive.
## Requirements
### Requirement: Agent is triggered by Rust/Cargo build failures via AI-judgment back-stop
The `rust-build-resolver` agent SHALL be invoked by Claude when Bash output contains a Rust/Cargo build failure pattern: `cargo build` or `cargo test` compilation errors, rustc error codes (`E0xxx`), strict-concurrency / Sendable / lifetime errors, or `cargo` dependency resolution failures. This is an AI-judgment back-stop, not a sentinel.

#### Scenario: Cargo compile error in bash output
- **WHEN** a Bash tool call returns output containing `error[E` lines from rustc
- **THEN** Claude invokes `dhpk:rust-build-resolver` to diagnose and fix

#### Scenario: Cargo dependency resolution failure
- **WHEN** `cargo build` output contains `failed to select a version for` or similar dependency conflict
- **THEN** Claude invokes `dhpk:rust-build-resolver` to resolve the Cargo.toml conflict

#### Scenario: Lifetime / borrow-checker error
- **WHEN** rustc output contains `cannot borrow` or `does not live long enough`
- **THEN** Claude invokes `dhpk:rust-build-resolver` to apply the minimum lifetime annotation fix

### Requirement: Agent fixes the build in at most 3 attempts
The `rust-build-resolver` agent SHALL attempt to fix the failing `cargo` command. After each fix it SHALL re-run the original failing command to verify. If the build still fails after 3 consecutive attempts, the agent SHALL stop and escalate to the user with a summary of what was tried.

#### Scenario: Fix succeeds on first attempt
- **WHEN** the fix resolves the Cargo build error
- **THEN** agent reports success and stops; no further attempts made

#### Scenario: 3 attempts all fail
- **WHEN** 3 consecutive fix attempts each result in a continued build failure
- **THEN** agent stops, outputs a summary of all attempted fixes and remaining errors, and asks the user for direction — it does NOT make a 4th attempt

### Requirement: Agent uses surgical edits — minimum code changes
The `rust-build-resolver` agent SHALL apply the minimum edit required to fix the reported error. It SHALL NOT change unrelated modules, update Cargo.toml beyond what the failing dependency requires, or alter logic outside the reported error scope.

#### Scenario: Lifetime error in one function
- **WHEN** rustc reports a lifetime error in function `bar`
- **THEN** agent edits only the lifetime annotations in `bar`; no other code is touched

### Requirement: Route-table advisory pattern for Rust build failures
`route-table.json` SHALL include an ERE pattern matching common Rust build failure phrases, routing to `dhpk:adaptive-dev-workflow` as a hint.

#### Scenario: User types "fix cargo build error"
- **WHEN** the user submits a prompt matching `fix\s+(cargo|rust)\s+(build|compile|error)` (case-insensitive)
- **THEN** `userpromptsubmit-skill-hint.sh` emits an advisory mentioning adaptive-dev-workflow

### Requirement: Agent registered in plugin.json and INDEX.md
The `rust-build-resolver` agent SHALL appear in `.claude-plugin/plugin.json` `agents[]` and in `agents/INDEX.md` so it is available as `dhpk:rust-build-resolver` after plugin install.

#### Scenario: After plugin install, subagent_type is available
- **WHEN** dhpk plugin is installed
- **THEN** `dhpk:rust-build-resolver` is available as a subagent_type in Claude Code
