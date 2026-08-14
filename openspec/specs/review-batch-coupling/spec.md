# review-batch-coupling Specification

## Purpose
TBD - created by archiving change harden-opsx-goal-policy-fallbacks. Update Purpose after archive.
## Requirements
### Requirement: Documentation review checks normatively coupled documents

The `doc-reviewer` SHALL inspect an already in-scope OpenSpec `spec.md` or `design.md` when it normatively governs an implementation or policy file in the same review batch and a finding pattern is identified.

#### Scenario: Governing spec repeats an implementation omission

- **WHEN** an implementation file and its governing OpenSpec spec are in the same review batch
  and the implementation finding pattern appears in both
- **THEN** the reviewer reports both occurrences in one review artifact with both paths and
  separate evidence

#### Scenario: Governing design repeats a policy contradiction

- **WHEN** a policy file and its governing same-batch `design.md` contain the same normative
  contradiction
- **THEN** the reviewer reports the policy path, design path, relationship, and evidence in the
  same artifact

### Requirement: Coupled-document review is bounded and non-duplicative

The coupled-document check SHALL remain limited to same-batch governing `spec.md` and `design.md` files and SHALL NOT expand review scope, perform repository-wide semantic search, or replace code-reviewer code-quality checks.

#### Scenario: No coupled document is present

- **WHEN** a finding pattern is found but no same-batch spec or design file normatively governs
  the target
- **THEN** the reviewer reports the original finding without inventing a coupled occurrence or
  dispatching another reviewer

#### Scenario: Relationship is ambiguous

- **WHEN** a same-batch document is textually similar but its governing relationship cannot be
  established
- **THEN** the reviewer does not report a coupled finding and records the original evidence only

#### Scenario: Proposal and task files are nearby

- **WHEN** `proposal.md` or `tasks.md` is present in the same change but is not the governing
  spec/design contract for the finding
- **THEN** those files are not treated as coupled review documents by default

### Requirement: Coupled findings preserve the shared reviewer contract

The coupled-document check SHALL use the existing reviewer contract for scope, evidence, canonical artifact, verdict, confirm-only, and bounded retry fields.

#### Scenario: Coupled evidence is reported

- **WHEN** the same finding pattern is confirmed in both coupled paths
- **THEN** the review artifact identifies the original path, coupled path, exact evidence for each,
  and their normative relationship without rewriting either file

#### Scenario: Existing reviewer wave is active

- **WHEN** a coupled finding is discovered during a consolidated review wave
- **THEN** it remains in that reviewer artifact and does not create a second dispatch or a new
  sentinel lifecycle
