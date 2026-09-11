# edit-guard-precision Specification

## Purpose

Define precise, context-aware edit protection for lint configuration and dotenv
files without blocking legitimate session scratchpad work.

## Requirements

### Requirement: Lint-config protection honors an active OpenSpec change's tasks.md

Before blocking an edit to a protected lint/formatter config file, `pre-edit-guard.sh` SHALL check whether the file's basename is listed in any active (non-archived) `openspec/changes/*/tasks.md`; on a match it SHALL allow the edit and print a one-line notice naming the change. The `DHPK_PROTECT_LINT_CONFIGS=0` escape SHALL keep working.

#### Scenario: tasks.md-listed config edit is allowed

- **WHEN** an active change's tasks.md mentions `eslint.config.mjs` and the session edits that existing file
- **THEN** the edit proceeds with a notice such as `[edit-guard] lint config allowed: listed in <change>/tasks.md`

#### Scenario: Unlisted config edit is still blocked

- **WHEN** no active change's tasks.md mentions `eslint.config.mjs` and the session edits it
- **THEN** the guard blocks with exit 2 as today

### Requirement: The sensitive .env pattern matches real dotenv basenames only and exempts the session scratchpad

The `.env` block pattern SHALL be anchored so only files whose basename is `.env` or starts with `.env.` match (suffix coincidences like `verify.env` SHALL NOT match), and paths under session scratchpad roots (`/tmp/claude-*`, `/private/tmp/claude-*`) SHALL be exempt entirely. The `.env.example|.sample|.dist|.template` allowlist and the `.git/` protection SHALL be preserved.

#### Scenario: verify.env is not blocked

- **WHEN** the session writes `scripts/verify.env` in the repo or `verify.env` anywhere
- **THEN** the guard does not block on the `.env` rule

#### Scenario: Scratchpad .env is exempt

- **WHEN** the session writes `/private/tmp/claude-501/<session>/scratchpad/.env`
- **THEN** the guard allows the write

#### Scenario: Real repo .env still blocked

- **WHEN** the session writes `<repo>/.env` or `<repo>/config/.env.production`
- **THEN** the guard blocks with exit 2
