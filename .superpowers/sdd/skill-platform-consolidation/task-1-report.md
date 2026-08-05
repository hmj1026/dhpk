# Task 1 report — naming and topology contract

## Scope

Implemented the inventory v2 validation and topology primitives only. The
real 105-package tree, checked-in v1 manifest, and native package were not
migrated; tests use disposable post-migration fixtures so the primitive review
is independent from the later migration tasks.

## Files

- `scripts/lib/distribution-inventory.js`
  - adds v2 schema/name/capability/tier/profile/surface/legacy-name validation;
  - routes v2 inventories through the new validator while preserving v1
    behavior;
  - makes `generateClaudeSkillRoots()` emit exactly one `./skills/` root for
    live v2 skills and no roots when all skills are deprecated;
  - re-exports the topology validator and compatibility aliases.
- `scripts/lib/skill-topology.js`
  - validates flat canonical paths, folder/frontmatter identity, exactly one
    physical canonical `SKILL.md` per live capability, relative projection
    links, repository-contained/dangling/wrong targets, and native-package
    symlink exclusion.
- `tests/skill-topology.test.js`
  - fixture-based v2 inventory, generator, canonical, projection, and native
    package behavior tests.

## TDD evidence

### RED

Before implementation:

```text
node tests/skill-platform-topology.test.js
skill-platform-topology: 1/8 passed
```

The expected failures were the missing v2 inventory validator and missing
topology validator (`Task 1 ... validator is not implemented`). The generator
fixture happened to pass the pre-existing v1 behavior; the v2-specific branch
was then added and covered by the same test file. The real-tree migration was
not included in this RED loop.

### GREEN

```text
node tests/skill-topology.test.js                         # 8/8 passed
node tests/distribution-inventory-validate.test.js        # 16/16 passed
node tests/gen-distribution-inventory.test.js             # 6/6 passed
node tests/gen-claude-manifest-generate.test.js           # 6/6 passed
node tests/codex-native-package-validate.test.js          # 8/8 passed
node scripts/ci/validate-distribution.js                  # PASS (105 skills, 31 modules)
node scripts/ci/validate-plugin.js                        # PASS
node scripts/ci/catalog.js --check all                   # PASS (0 uncovered)
bash scripts/validate/validate-harness.sh                # PASS
node tests/run-all.js                                     # PASS: 163/163 files
node --check ... and git diff --check                     # PASS
```

## Impact and scope checks

- GitNexus upstream impact before edits: `validateDistributionInventory` LOW
  (2 direct callers), `classifyCanonicalInventory` LOW (2), and
  `generateClaudeSkillRoots` MEDIUM (5 direct callers plus catalog/CI flow).
- Refreshed the feature-worktree index with `npx gitnexus analyze` before the
  pre-commit check.
- Path-scoped `detect_changes` reported the expected inventory/generator
  symbols and the catalog flow at MEDIUM risk. It also reported AGENTS/CLAUDE
  section touches despite a clean `git status`; those are GitNexus sibling
  worktree/index artifacts, not files in this diff.

## Commit

Implementation commit: `a1fb880` (`feat: add skill topology contract primitives`)

The implementation and fixture tests are committed on
`feature/skill-platform-consolidation`.

## Self-review

- v1 inventory behavior and current manifest generation remain unchanged unless
  the caller explicitly supplies schema v2.
- v2 checks use independently literal fixture expectations and public seams;
  no internal collaborator mocks are used.
- Projection links are inspected with `lstat`/`readlink`, so absolute,
  dangling, outside-repository, wrong-target, and physical-projection cases do
  not pass through `fs.stat` dereferencing.
- Native roots are scanned recursively for any symlink, while canonical live
  packages are required to have physical directories/files.
- No migration, manifest rewrite, package regeneration, or production data
  change was made.

## Concerns / follow-up

- The checked-in repository is intentionally still v1/non-flat; the real-tree
  topology gate is fixture-only until Task 2 performs the migration.
- GitNexus remains ambiguous across the main and feature worktree names; the
  refreshed path-scoped result is useful for changed-symbol review but should
  not be treated as proof about the unrelated AGENTS/CLAUDE section entries.
- A dedicated code-reviewer agent could not be spawned because all collaboration
  slots were occupied; parent flow should perform the mandatory final reviewer
  pass before handoff.
