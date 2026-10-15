# harness-route-integrity Specification

## Purpose

Defines validation of route-table entries and declared skill handoffs so each route and next action uses a valid, unique, supported target and malformed declarations fail clearly.

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

Declared `dhpk-next` values SHALL resolve the same way (SHF-REQ-003): `none`
is a terminal marker and not a skill; a bare canonical `name` SHALL match a
distributed skill; `name:mode` SHALL match that skill and a mode the target
skill declares in `dhpk-modes` when that field is present. Validation SHALL
NOT treat a similarly named file, retired slash command, or Host-formatted
invocation string as a resolved skill.

#### Scenario: A rule points at a missing skill

- **WHEN** kind is skill and its ID is absent from active inventory
- **THEN** validation reports the missing typed target and fails

#### Scenario: A command has an invalid portable mapping

- **WHEN** a command's portable skill is absent or unpaired
- **THEN** validation reports both IDs and fails

#### Scenario: Target kind is unknown

- **WHEN** kind is outside skill, command, and agent
- **THEN** validation fails without guessing from the filesystem

#### Scenario: Next map points at a missing skill

- **WHEN** a `dhpk-next` value names a canonical skill that is absent from
  active inventory
- **THEN** the graph-integrity check reports that value and fails

#### Scenario: Next map points at an undeclared mode

- **WHEN** a `dhpk-next` value is `name:mode` and the target skill lists
  `dhpk-modes` that do not include that mode
- **THEN** the graph-integrity check reports the skill and mode and fails

#### Scenario: Terminal none is accepted

- **WHEN** a `dhpk-next` value is `none`
- **THEN** validation accepts it as a terminal marker and does not look up a
  skill named `none`

### Requirement: Declared next maps use the closed result-state set

SHF-REQ-002, SHF-REQ-008: Every `dhpk-next` key SHALL be one of `PASS`,
`FAIL`, `BLOCKED`, `NOT_RUN`, `UNAVAILABLE`, or `mode:STATE` where `STATE` is
one of those five. Nested metadata keys introduced by this change SHALL be
limited to `dhpk-next` and optional `dhpk-modes`, and SHALL be added to the
same closed `dhpk-` metadata allowlist used by sibling frontmatter extensions.
The nested parser and closed allowlist SSOT SHALL be
`scripts/ci/_lib/frontmatter.js`; `validate-skills.js` SHALL consume it for
schema validation and retain the official top-level whitelist without a second
nested allowlist. Existing `dhpk-invocation-class`, handoff `dhpk-next` /
`dhpk-modes`, and reserved `dhpk-handoff-*` SHALL be preserved. Unknown nested
`dhpk-` keys SHALL fail validation.

Exactly one graph-integrity check SHALL prove (1) every declared next target
resolves as specified above and (2) every result-state key is in the closed
set. Existing frontmatter validation SHALL be extended for shape, nested keys,
and dotted-substitute rejection. Validation SHALL NOT assert skill body prose,
headings, or wording of next-step sentences.

#### Scenario: Unknown result state is declared

- **WHEN** a `dhpk-next` key is `PARTIAL` or another token outside the closed
  set
- **THEN** the graph-integrity check fails and names the illegal state

#### Scenario: Graph-integrity check passes a closed valid map

- **WHEN** every `dhpk-next` key is in the closed set and every value is
  `none` or a resolving `name` or `name:mode`
- **THEN** that single graph-integrity check passes

#### Scenario: Prose next-step wording is not tested

- **WHEN** a skill body describes a next step in prose that differs from
  `dhpk-next` while the machine-readable map is valid
- **THEN** frontmatter and graph-integrity validation still pass; they do not
  fail on body wording
