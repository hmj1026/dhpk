# harness-route-integrity Specification

## Purpose
TBD - created by archiving change dhpk-harness-integrity-guards. Update Purpose after archive.
## Requirements
### Requirement: Every route-table pattern compiles as a regex

Harness validation SHALL verify every canonical v2 route has a non-empty
pattern compiled under matcher semantics before projections are accepted.

#### Scenario: A rule has a malformed pattern
- **WHEN** a route pattern has an unbalanced group
- **THEN** validation names the rule and fails

### Requirement: No unintended duplicate route target

The harness SHALL compare normalized target kind plus stable ID and fail an
unwhitelisted duplicate independently of host-formatted invocation syntax.

#### Scenario: Two rules target the same skill
- **WHEN** two rules have the same skill kind/ID and are not whitelisted
- **THEN** validation reports the typed duplicate and fails

### Requirement: English-only rules are surfaced

`scripts/validate/validate-harness.sh` SHALL warn (without failing) for each route-table rule
whose pattern has no Traditional-Chinese alternation, so that gaps in the "bilingual route table"
are visible.

#### Scenario: A rule is English-only

- **WHEN** a rule pattern matches only English phrasing with no `|<zh>` branch
- **THEN** the harness structure check emits a warning naming the rule, and continues

### Requirement: Route targets keep resolving to real assets

Every target SHALL declare a supported kind, safe stable ID, and inventory or
roster asset appropriate to its kind. A `portable_skill_id` SHALL resolve to a
distributed skill paired with the command. Kind SHALL NOT be inferred by
probing similarly named files.

#### Scenario: A rule points at a missing skill
- **WHEN** kind is skill and its ID is absent from active inventory
- **THEN** validation reports the missing typed target and fails

#### Scenario: A command has an invalid portable mapping
- **WHEN** a command's portable skill is absent or unpaired
- **THEN** validation reports both IDs and fails

#### Scenario: Target kind is unknown
- **WHEN** kind is outside skill, command, and agent
- **THEN** validation fails without guessing from the filesystem
