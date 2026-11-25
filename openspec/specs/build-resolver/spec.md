# build-resolver Specification

## Purpose

Provide one public agent for Python, Swift, and Rust build-failure diagnosis
while retaining the existing language-module boundaries and the shared
smallest-fix/re-run/stop contract.

## Requirements

### Requirement: One public resolver routes supported toolchains

The `build-resolver` agent SHALL be the only registered resolver for Python,
Swift, and Rust build failures. Python and Swift routing SHALL require their
active language module; Cargo routing SHALL remain available without a Rust
module. The retired language-specific names SHALL NOT be aliases.

#### Scenario: Python failure with module active

- **WHEN** Bash output contains a Python `ruff`, `mypy`, `pyright`, `pytest`,
  `uv`, `pip`, or `poetry` failure and the Python-compatible module is active
- **THEN** Claude routes to `dhpk:build-resolver` and it loads the Python guide

#### Scenario: Swift failure without module

- **WHEN** Bash output contains `swift build`, `xcodebuild`, or SwiftPM
  resolution failure and the Swift/xcode-tooling module is inactive
- **THEN** the module-gated route does not fire

#### Scenario: Cargo failure without Rust module

- **WHEN** Bash output contains a `cargo build`, `cargo test`, `cargo clippy`,
  rustc diagnostic, or Cargo resolution failure
- **THEN** Claude routes to `dhpk:build-resolver` and it loads the Rust guide

### Requirement: Resolver re-runs the exact failed command

The resolver SHALL apply the smallest intent-preserving fix and SHALL re-run
the original failed command, including its arguments, after every edit. It
SHALL stop after three failed attempts on the same error or when redesign,
environment, credentials, or user action is required, and SHALL hand a green
run to `code-reviewer`.

#### Scenario: Successful repair

- **WHEN** the exact failed command exits zero after a repair
- **THEN** the resolver reports the command and green result and stops

#### Scenario: Repeated failure

- **WHEN** three repair attempts still fail on the same error
- **THEN** the resolver reports all attempts, alternatives, and recommendation
  without making a fourth attempt

### Requirement: Public registration and migration inventory are consistent

The public plugin manifest, agent index, distribution inventory, Codex role map,
and execution-policy toolchain bullets SHALL name `build-resolver`; none SHALL
register the retired role names or compatibility aliases.

#### Scenario: Installed role discovery

- **WHEN** an installation is upgraded from a version containing the three old
  roles
- **THEN** the resolver list contains only `build-resolver`
