# Audit Runtime Compatibility Specification

## Purpose

Define the stable caller-visible contracts of DHPK's audit and skill-stocktake tools while their implementations are independently rewritten.

## Requirements

### Requirement: REQ-1 Audit CLI arguments and report values remain compatible

The audit command SHALL preserve its accepted positional scope and `--scope`, `--format`, and `--root` options, including supported `--option=value` forms, and SHALL retain the `AUDIT_ROOT` override. It SHALL continue to support text and JSON output and expose the `buildReport` and `parseArgs` module exports. JSON reports SHALL retain `scope`, `root_dir`, `target_mode`, `rubric_version`, `overall_score`, `max_score`, `categories`, `checks`, and `top_actions`; characterized inputs SHALL produce the same deterministic scoring and report values.

#### Scenario: Caller uses each supported argument form

- **WHEN** a caller supplies a supported positional or flag form and selects text or JSON output
- **THEN** argument parsing and output behave as before, and module consumers can call both named exports

#### Scenario: Audit report is compared with an independent fixture

- **WHEN** the same characterized repository fixture is audited before and after the rewrite
- **THEN** the public JSON fields, rubric version, scores, categories, checks, and top actions match the characterized expected values

### Requirement: REQ-2 Stocktake wrappers preserve inputs and result fields

The `scan.sh`, `quick-diff.sh`, and `save-results.sh` entrypoints SHALL preserve their argument behavior and the `SKILL_STOCKTAKE_GLOBAL_DIR`, `SKILL_STOCKTAKE_PROJECT_DIR`, and `SKILL_STOCKTAKE_OBSERVATIONS` environment overrides while delegating stocktake behavior to a package-local runtime. Scan output SHALL retain its summary and `skills` array. Quick-diff SHALL read `evaluated_at` from its input result file and emit an array of changed or new records containing `path`, `mtime`, and `is_new` fields.

#### Scenario: Installed-skill locations are overridden

- **WHEN** a caller runs a stocktake entrypoint with the supported environment overrides
- **THEN** the scan and quick-diff operations use those locations and emit their existing result fields

#### Scenario: No skill has changed since evaluation

- **WHEN** the quick-diff entrypoint reads a result timestamp newer than each previously known skill file's modification time and no new skills have been added
- **THEN** the output array is empty

#### Scenario: A previously unknown skill is found

- **WHEN** a skill path is absent from the previous result file
- **THEN** it is included with `is_new` true regardless of its modification time

### Requirement: REQ-3 Saving results validates before mutation

The result-save entrypoint SHALL read evaluated results from standard input, merge them according to the existing result-file behavior, and record a UTC evaluation timestamp. Invalid input SHALL produce no standard output, SHALL return a failure status, and SHALL leave the prior result file unchanged.

#### Scenario: Valid evaluations are merged

- **WHEN** valid evaluation JSON is provided on standard input with a result-file path
- **THEN** the result file contains the merged evaluations and an updated UTC timestamp

#### Scenario: Invalid evaluations are rejected without changing the file

- **WHEN** malformed or semantically invalid JSON is provided on standard input
- **THEN** the command emits no standard output, reports failure, and preserves the result file byte-for-byte

### Requirement: REQ-4 Required attribution stays with retained content

Any third-party code, resource, or dependency that remains in the rewritten tools or their packages SHALL retain its required attribution or license notice at the owning source or package location. The change SHALL NOT create a separate documentation provenance report.

#### Scenario: A third-party component remains in a package

- **WHEN** a rewritten tool still contains or distributes a third-party component
- **THEN** its existing required notice remains alongside the component or at its current package-level license location
