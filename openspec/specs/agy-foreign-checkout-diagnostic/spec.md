# agy-foreign-checkout-diagnostic Specification

## Purpose

Define read-only ownership diagnostics for AGY targets that cannot be safely
treated as receipt-owned package installations.

## Requirements

### Requirement: AGY target inspection is read-only and machine-readable

The AGY installer SHALL expose `plan` and `status` actions that validate the
source package and inspect the requested target without creating directories,
copying files, changing receipts, or invoking AGY. With `--json`, the result
MUST contain `surface`, `action`, `status`, `state`, `classification`,
`source`, `target`, `diff`, `next_action`, and `mutation.performed: false`.

#### Scenario: Plan inspects a foreign target

- **WHEN** an operator runs `install-agy-plugin.js plan --json` against an
  existing target
- **THEN** the command emits the complete diagnostic report and leaves the
  target, source, and receipt byte-identical

#### Scenario: Status is an alias for the same evidence

- **WHEN** an operator runs the `status` action with the same source and target
- **THEN** it returns the same classification and diff evidence as `plan` and
  performs no mutation

### Requirement: Foreign Git checkouts are classified fail-closed

Inspection SHALL classify a physical `.git` marker without a valid receipt
owned by the `agy-plugin` surface as `FOREIGN_CHECKOUT` and `BLOCKED`, even if
some source files are byte-identical. The report MUST include source package
version/fingerprint, target manifest name/version when readable, receipt
presence/validity, and the Git marker result.

#### Scenario: Foreign checkout has no receipt

- **WHEN** the target contains `.git/`, a target `plugin.json` with another
  version, and no valid `provenance.json`
- **THEN** the report is `BLOCKED` with classification `FOREIGN_CHECKOUT` and
  does not claim AGY ownership

#### Scenario: Receipt-owned target is not foreign merely because it has Git

- **WHEN** the target contains `.git/` but its valid `agy-plugin` receipt and
  fingerprints match the installed package
- **THEN** inspection reports the receipt-owned state rather than
  `FOREIGN_CHECKOUT`

### Requirement: Diff evidence is bounded and deterministic

Inspection SHALL compare only source inventory paths using physical regular
files. It MUST report sorted same/changed/missing counts and bounded previews;
it MUST NOT follow target symlinks or recursively inspect target-only trees.

#### Scenario: Source and foreign target differ

- **WHEN** source files are compared with a foreign target
- **THEN** the report includes stable counts and capped changed/missing path
  previews without copying any target content

#### Scenario: Target path is symlinked

- **WHEN** a source-relative target path or one of its ancestors is a symlink
- **THEN** that path is reported as unsafe/changed and inspection does not read
  bytes through the link

### Requirement: Blocked reports provide an explicit owner action

The report SHALL provide a non-empty `next_action` when inspection cannot
establish a clean receipt-owned target, directing the owner to independently
back up, move, or retire the foreign/changed target before a clean install.
The diagnostic SHALL NOT offer an automatic adoption or overwrite command.

#### Scenario: Operator receives foreign-checkout guidance

- **WHEN** classification is `FOREIGN_CHECKOUT`
- **THEN** `next_action` explicitly requires an independent owner backup/move/
  retirement and a later clean install, while `mutation.performed` remains
  false
