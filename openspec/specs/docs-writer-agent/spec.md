# docs-writer-agent Specification

## Purpose

Define a shared documentation-authoring role that Claude and Codex can both dispatch. The role writes or revises assigned documentation from confirmed sources and stays separate from stale-doc refresh and policy review.

## Requirements

### Requirement: Docs writer edits only assigned documentation from confirmed sources

The `docs-writer` agent SHALL write or revise only the documentation files the parent assigns. Every material claim SHALL rest on a confirmed source: implementation, an accepted specification, recorded test results, or existing documentation. When a source is missing or sources conflict, the agent SHALL return the gap to the parent instead of inventing behavior.

#### Scenario: Conflicting source evidence

- **WHEN** the specification and the implementation disagree about a behavior the document must describe
- **THEN** the agent reports the conflict with both sources and does not choose a behavior on its own

#### Scenario: Unassigned file needs an update

- **WHEN** a linked document outside the assigned set becomes inconsistent
- **THEN** the agent reports the file and the inconsistency without editing it

### Requirement: Docs writer reports sources and checks

The `docs-writer` agent SHALL report the following in its final reply:
- the edited paths
- the sources behind material claims
- the link and cross-file consistency checks it performed
- any unresolved facts

It SHALL NOT claim that a documentation change proves implementation, installation, or runtime acceptance.

#### Scenario: Completion report

- **WHEN** the agent finishes an assigned QA manual revision
- **THEN** the reply lists the edited file, the source for each corrected behavior, and the remaining open questions

### Requirement: Docs writer and doc-updater have distinct triggers

The agent descriptions SHALL state disjoint triggers:
- `docs-writer` handles authoring or revising assigned documentation from supplied sources.
- `doc-updater` handles detecting and refreshing documentation made stale by a structural, route, setup, distribution, or configuration change.

#### Scenario: Assigned manual revision

- **WHEN** the parent needs a QA manual revised from new test results
- **THEN** the routing guidance selects `docs-writer`, not `doc-updater`
