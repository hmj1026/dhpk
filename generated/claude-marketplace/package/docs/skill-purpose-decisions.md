# Skill purpose decisions

Issue #534 keeps purpose decisions separate from distribution identity. The
canonical record is
[`manifests/skill-purpose-decisions.json`](../manifests/skill-purpose-decisions.json),
validated against the inventory by
[`scripts/lib/skill-purpose-decisions.js`](../scripts/lib/skill-purpose-decisions.js).
The inventory remains the only source for stable IDs, public names, canonical
paths, surfaces, successors, migration, and rollback facts.

## Active decision set

The ledger contains exactly 65 active rows, all with `outcome: retain`. Every
row records reviewed `authority` plus a `duplicate_content` comparison fact,
comparison statement, and structural evidence. Their purpose descriptions are
copied from the canonical `SKILL.md` frontmatter; callers and structural
evidence are required for every row.

| Disposition | Count | Meaning |
| --- | ---: | --- |
| `retain-standalone` | 30 | A bounded capability remains independently selectable. |
| `retain-family` | 2 | Family selectors retain the versioned capability contract. |
| `retain-optional` | 25 | Specialized guidance remains explicit opt-in. |
| `retain-internal` | 2 | Runtime support stays outside public discovery. |
| `retain-external` | 6 | GitNexus remains under its external package owner. |
| **Active skills covered** | **65** | Every active inventory skill is represented exactly once. |

## Current retirement wave

The separate `retirements` collection contains exactly the 21 inventory rows
retired in `0.54.0`. It records the reviewed high-level outcome, authority,
content value, duplicate-content comparison fact/evidence, callers, and
evidence without copying inventory identity or migration fields. The
`outcome` field is the migration decision itself; `disposition` remains the
same reviewed subtype for consumers that display both fields.

| Outcome | Count | Reviewed successor boundary |
| --- | ---: | --- |
| `internalize` | 11 | Laravel and PHPUnit family selectors. |
| `merge` | 7 | Harness-govern, git-smart-commit, and software-architecture modes. |
| `retire` | 2 | External `openspec-propose` proposal authoring. |
| `remove` | 1 | Operator-owned `onepassword-cli` session action. |
| **Current wave** | **21** | Exact inventory-bound scope for issue #534. |

Historical retirement and rename facts remain in
`manifests/distribution-inventory.json`. Renamed active public names are
diagnostic-only: callers must select the canonical stable ID, and no alias or
automatic successor invocation is generated. Runtime and consumer evidence
remain `NOT_RUN` until an authorized client probe is performed; structural
`PASS` is the only evidence required to check in a purpose decision.
