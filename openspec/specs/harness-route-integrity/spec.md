# harness-route-integrity Specification

## Purpose
TBD - created by archiving change dhpk-harness-integrity-guards. Update Purpose after archive.
## Requirements
### Requirement: Every route-table pattern compiles as a regex

`scripts/validate/validate-harness.sh` SHALL verify that each rule `pattern` in
`scripts/lib/route-table.json` compiles as a valid regular expression. A pattern that fails to
compile SHALL fail the harness structure check.

#### Scenario: A rule has a malformed pattern

- **WHEN** a route-table rule contains a pattern with an unbalanced group
- **THEN** `bash scripts/validate/validate-harness.sh` reports the offending rule and exits with an error

### Requirement: No unintended duplicate route target

`scripts/validate/validate-harness.sh` SHALL detect when two or more route-table rules resolve to
the same skill/command target, and SHALL fail unless that target is on an explicit
duplicate-allowed whitelist.

#### Scenario: Two rules target the same skill

- **WHEN** two route-table rules both target `dhpk:verify` and `dhpk:verify` is not whitelisted
- **THEN** the harness structure check reports the duplicate and exits with an error

### Requirement: English-only rules are surfaced

`scripts/validate/validate-harness.sh` SHALL warn (without failing) for each route-table rule
whose pattern has no Traditional-Chinese alternation, so that gaps in the "bilingual route table"
are visible.

#### Scenario: A rule is English-only

- **WHEN** a rule pattern matches only English phrasing with no `|<zh>` branch
- **THEN** the harness structure check emits a warning naming the rule, and continues

### Requirement: Route targets keep resolving to real assets

`scripts/validate/validate-harness.sh` SHALL continue to verify that every rule's `dhpk:<name>`
target exists as `commands/<name>.md` or `skills/<name>/SKILL.md`.

#### Scenario: A rule points at a missing skill

- **WHEN** a rule targets `dhpk:<name>` and neither `commands/<name>.md` nor `skills/<name>/SKILL.md` exists
- **THEN** the harness structure check reports the missing target and exits with an error
