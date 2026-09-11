# Skill purpose decisions

Issue #469 makes the purpose decision explicit without changing the
distribution inventory's ownership of stable IDs, public names, paths, and
publication surfaces.

The canonical decision record is
[`manifests/skill-purpose-decisions.json`](../manifests/skill-purpose-decisions.json).
It covers every active skill in the #467 baseline exactly once. The validator
derives each entry's task from its `SKILL.md` description, authority from the
inventory usage contract when one exists, and identity from
`manifests/distribution-inventory.json`. It also checks that:

- family decisions resolve to an existing routing family;
- internal decisions remain non-invokable and non-discoverable;
- external decisions resolve to the protected external-package ledger;
- current frontmatter names and canonical paths match the inventory;
- stable IDs remain continuous and no permanent aliases are introduced.

## Decision summary

| Disposition | Count | Meaning |
| --- | ---: | --- |
| `retain-standalone` | 30 | A bounded capability remains independently selectable. |
| `retain-family` | 2 | Laravel and PHPUnit keep their existing explicit version selectors. |
| `retain-optional` | 25 | Specialized guidance remains opt-in and independently usable. |
| `retain-internal` | 2 | CLI context/transport remain supporting runtime assets only. |
| `retain-external` | 6 | GitNexus remains under upstream ownership and protection. |
| **Active skills covered** | **65** | No fixed-count trimming or unproved retirement was performed. |

Existing historical merge/retirement facts remain in the inventory's
`retired_skills` ledger. The two current public renames (Laravel and PHPUnit)
remain in `renamed_skill_names`; this change does not rewrite old receipts or
create forwarding aliases.

## Baseline and context evidence

| Measurement | #467 baseline | #469 implementation | Evidence |
| --- | ---: | ---: | --- |
| Active inventory skills | 65 | 65 | Inventory and ledger validator |
| Skills marked `decision-required` in the old baseline | 63 | 0 unresolved | `issue-467-develop-bba2873.json` versus the ledger's exact coverage |
| External ownership entries | 6 | 6 | `external_skill_packages` and six `retain-external` rows |
| Public skill paths | 65 | 65 | Inventory identity/path checks |
| Runtime client/session proof | `NOT_RUN` | `NOT_RUN` | Static validation does not start Claude, Codex, Cursor, or AGY |
| Init-context change | Not measured at runtime | No skill/AGENTS/CLAUDE content moved; runtime measure remains pending | Static scope of this change |

The “0 unresolved” value means every active skill has a reviewed disposition;
it does not mean every future rename or retirement has been executed. Any
future change to public identity, family selectors, supporting assets, or
profiles must update the inventory owner first and retain the ledger's
stable-ID, migration, and rollback checks.
