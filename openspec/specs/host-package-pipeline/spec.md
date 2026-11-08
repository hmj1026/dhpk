# host-package-pipeline Specification

## Purpose

Publish every generated Host package with a Package Receipt (agent, Cursor, Codex, AGY) through one pipeline for adapter assembly and artifact-store publication, while each Host keeps the plan entries and compile options that define its plan fingerprint (#1242).

## Requirements

### Requirement: One pipeline publishes Host packages

The agent, Cursor, Codex, and AGY package generators SHALL publish through one pipeline that owns adapter assembly (stage-root guard, render outputs, optional late-bound derived outputs), the artifact store (surface owner, store root, ownership verifier), and materialization. Each generator keeps its plan entries and compile options, which differ in ways that feed the plan fingerprint, and shares the skill entry field list through the pipeline.

#### Scenario: A minimal Host publishes through the pipeline

- **WHEN** a Host supplies two planned files, a receipt, and a passing validator
- **THEN** the package, including its receipt files, is published under the output directory by the artifact store

#### Scenario: Late-bound receipt

- **WHEN** a Host supplies its receipt as a function
- **THEN** the pipeline calls it with the fingerprints the store observed and publishes what it returns

#### Scenario: Validation failure keeps the previous package

- **WHEN** the Host validator rejects the staged package
- **THEN** materialization fails and the previously published package is unchanged

#### Scenario: Foreign output is refused

- **WHEN** the output directory holds a package owned by another surface
- **THEN** materialization fails without changing it

### Requirement: Behavior preservation

Moving the generators onto the pipeline SHALL NOT change any byte of a generated package.

#### Scenario: Regeneration

- **WHEN** every package is regenerated from the same clean commit
- **THEN** package verification reports no difference
