# {PROJECT_NAME}

## Project Context

- Framework: {FRAMEWORK}
- Database: {DATABASE}
- Configuration: {CONFIG_FILE}
- Bootstrap: {BOOTSTRAP_FILE}

## Verification Commands

- Test: `{TEST_COMMAND}`
- Lint: `{LINT_FIX_COMMAND}`
- Build: `{BUILD_COMMAND}`
- Typecheck: `{TYPECHECK_COMMAND}`

## Required Checks

Before reporting a change complete, run the detected test, lint, build, and
typecheck commands when they are available. Preserve the project's existing
review, security, and deployment boundaries.

<!-- block:node-ts -->
### Node.js / TypeScript

Use the detected package manager for scripts and keep generated files out of
source edits.
<!-- /block -->

<!-- block:python -->
### Python

Use the detected environment and run the project's test and lint commands.
<!-- /block -->

<!-- block:go -->
### Go

Run the module's test and vet/build commands before handoff.
<!-- /block -->

<!-- block:rust -->
### Rust

Run the Cargo test, lint, and build commands selected during detection.
<!-- /block -->

<!-- block:ruby -->
### Ruby

Use the project's Bundler commands for tests and linting.
<!-- /block -->

<!-- block:java -->
### Java

Use the detected Maven or Gradle commands for tests and builds.
<!-- /block -->

## Manual Follow-ups

- Ticket pattern: {TICKET_PATTERN}
- Issue tracker: {ISSUE_TRACKER_URL}
- Target branch: {TARGET_BRANCH}
