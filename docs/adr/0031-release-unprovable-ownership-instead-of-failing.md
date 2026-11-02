# Release unprovable ownership instead of failing

Status: accepted

## Context

Release 0.69.0 moved every directory-tree fingerprint to one recipe,
`tree-merkle-v1`, and accepted values written by the earlier per-surface
recipes for one transition minor (issue #1172). Issue #1180 removes those
legacy recipes in 0.70.0. After the removal, two kinds of receipt entry can no
longer be proven owned:

- agents-skills entries that a receipt carries after the skill was deselected.
  Their source is no longer selected, so their fingerprint cannot be
  recomputed with the new recipe.
- installer entries marked `fingerprint_algorithm: legacy`, which an earlier
  install could not prove owned (missing, edited, or orphaned destination).

Without a legacy recipe, nothing can ever prove these entries owned again.

## Decision

In 0.70.0, a writer that meets such an entry makes it a Released Entry: it
removes the entry from the receipt, leaves the entry's files in place, and
lists every Released Entry in its output. The rest of the receipt is
rewritten with `tree-merkle-v1`. A receipt or package that carries no
algorithm marker at all, or a superseded `generatorVersion`, still fails
closed, with two remediation paths: upgrade through 0.69.x and run one install
or update, or uninstall and reinstall. The one exception is an agents-skills
receipt with `generatorVersion` `1.1.0` and no marker, which 0.69.x writes
while it carries legacy entries: it is read, its carried legacy entries become
Released Entries, and it is rewritten with `tree-merkle-v1`. An installer
entry in symlink mode stays provable by its link target and is not released.

## Consequences

- Upgrades converge on their own; no extra patch release or forced-rewrite
  command is needed.
- No user file is deleted on the strength of an ownership claim that cannot be
  checked.
- Released Entries are no longer updated or removed by dhpk. The user must
  delete them by hand if they are not wanted, which is why the output lists
  them.

## Alternatives considered

### Fail closed on any unprovable entry

Rejected. The user would have to resolve each entry by hand before any install
or update could proceed, for entries that are usually stale and harmless.

### Delete unprovable entries

Rejected. An entry that cannot be proven owned may hold user edits; deleting
it would destroy work on an unverifiable claim.

### Ship a 0.69.x patch with a forced full rewrite first

Rejected. It delays the removal by another release and still cannot recompute
carried entries whose source is no longer selected.
