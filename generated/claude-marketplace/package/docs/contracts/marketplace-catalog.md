# Marketplace catalog classification

The canonical selection and ownership records live in
[`manifests/marketplace-selection.json`](../../manifests/marketplace-selection.json)
and are compiled against
[`manifests/distribution-inventory.json`](../../manifests/distribution-inventory.json).
This page records the human rationale behind those records; it does not duplicate
the row-level catalog.

## Naming decision

On 2026-10-02 the user decided to keep every current inventory `name`. There
is no broader rename, the six IDs whose slug differs from their `name` stay as
they are, and unprefixed names do not gain a `dhpk-` prefix. Public names are
the inventory `name`. No selected name may be a runtime alias (the `legacy`,
`renamed`, and `retired` aliases in the usage catalog's `runtimeIndex`).

## Publication shape

Only the 15 common entries are public listings. Each common branch, reference,
or internal skill is bundled inside its entry owner when the package is built;
it is not a separate listing. Host-only rows keep a separate identity on the
surfaces listed in the inventory. Withdrawn rows are never published.

## Classification rules

- `entry` rows own themselves. `branch`, `reference`, and `internal` rows must
  name an `entry` owner.
- `common` rows belong to the shared catalog. `host-only` rows retain a separate
  selection identity for each supported Host surface and remain available on
  the surfaces listed in the inventory.
- `withdrawn` rows have no selection and are excluded from dhpk publication.
  The six GitNexus rows are owned upstream; any partial behavior handoff is
  recorded in the owner column.
- `authority` preserves the purpose decision. A child must not receive greater
  authority than its entry owner.
- The version condition of each ID is its inventory `profiles` without `core`:
  an empty condition means the skill is always available, otherwise the named
  module must be enabled.
- The `license` column classifies catalog entries. Applicable licensing and
  source acknowledgments for bundled resources are stated with those resources.

## Owner and authority rationale

The common selection contains 15 public entry skills. Branches, references, and
internal skills are bundled with their entry owner rather than published as
separate listings. Host-only entries remain scoped to the supported surfaces in
the inventory. The six withdrawn GitNexus entries are not published by dhpk;
their CLI and guide remain upstream. Partial investigation handoffs to
`code-trace` do not retain the withdrawn wrappers. GitNexus refactoring remains
an optional external tool, while dhpk workspace edits use `flow-drive`.

Authority labels describe each entry's permission boundary. `dep-audit` remains
a separate common entry because its `workspace-write` authority must not be
folded into the read-only `change-verdict` owner. `review-pending` is a
`flow-drive` delegate branch so its review handoff is not folded into the
read-only `change-verdict` owner. `create-pr` retains its external-write
boundary, and `git-worktree` retains its git-write boundary as separate entries.

Selection and ownership changes belong in the manifest and inventory. This page
records the rationale; the compiler and validators report source drift. Resource
license notices remain with the bundled resources. Package structure, licensing,
and consumer-runtime evidence are separate acceptance concerns.
