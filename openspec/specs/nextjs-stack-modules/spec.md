# nextjs-stack-modules Specification

## Purpose

Define the identity, trigger, and registration contracts for the supported
Next.js opt-in modules.

## Requirements

### Requirement: Each Next.js version module has a consistent name/skill/frontmatter triple

Each `modules/nextjs-<version>/module.yaml` SHALL declare a `name` equal to its own directory name, and each entry in its `provides.skills` list SHALL equal both the skill's directory name under `modules/nextjs-<version>/skills/` and the `name` field in that skill's `SKILL.md` frontmatter. `scripts/ci/validate-modules.js` SHALL fail (or warn, per its existing FAIL/WARN split) when any of the three do not match.

#### Scenario: module.yaml name matches its directory

- **WHEN** `modules/nextjs-15.5/module.yaml` declares `name: nextjs-15.5`
- **THEN** `scripts/ci/validate-modules.js` reports no name-mismatch error for `nextjs-15.5`

#### Scenario: provides.skills resolves to a real skill directory

- **WHEN** `modules/nextjs-16/module.yaml` declares `provides.skills: [nextjs-16-notes]`
- **THEN** `modules/nextjs-16/skills/nextjs-16-notes/SKILL.md` exists and its frontmatter `name` is `nextjs-16-notes`

### Requirement: Frontend triggers use the existing frontend trigger contract

Both `nextjs-15.5` and `nextjs-16` module.yaml triggers blocks SHALL use the same trigger slot key that `modules/js/module.yaml` already uses for frontend file triggers (not an invented or PHP-oriented slot name), with `extensions` covering at minimum `.tsx`, `.ts`, `.jsx`, `.js`.

#### Scenario: Trigger key matches the shipped frontend contract

- **WHEN** `modules/js/module.yaml` defines its frontend trigger block under a given key (e.g. `frontend:`)
- **THEN** `modules/nextjs-15.5/module.yaml` and `modules/nextjs-16/module.yaml` define their trigger blocks under that same key, not a different or invented key

### Requirement: nextjs-16-notes prominently documents the React 19 requirement

The `nextjs-16-notes` skill's Migration traps section SHALL list the React 19 requirement as the first and most prominent trap, since Next.js 16 hard-requires React 19 and this is the largest blast-radius item for any project migrating from an 18.x-era codebase.

#### Scenario: React 19 requirement is the lead migration trap

- **WHEN** a reader opens `modules/nextjs-16/skills/nextjs-16-notes/SKILL.md`'s Migration traps section
- **THEN** the React 19 requirement appears as the first item, marked with language signaling its criticality (e.g. "CRITICAL"), before other traps like Turbopack-by-default or removed runtime-config APIs

### Requirement: Both modules are registered at all machine-readable points

Shipping `nextjs-15.5` and `nextjs-16` SHALL include registering both module ids in `manifests/module-catalog.json` (satisfying the existing install-manifest-integrity "catalog-selectable" requirement), classifying both in `manifests/install-profiles.json`'s `full` profile (satisfying the existing "full profile is complete" requirement), and adding both skill paths to `.claude-plugin/plugin.json` `skills[]`. Documentation may report computed inventory counts, but prose count synchronization is not a catalog gate.

#### Scenario: A module ships without full registration

- **WHEN** a shipped module lacks a selectable catalog entry, full-profile classification, or plugin skill path
- **THEN** the module-catalog and plugin validators report the missing machine-readable registration; documentation count wording remains informational

#### Scenario: Both modules are fully registered

- **WHEN** both modules have `module-catalog.json` entries, `install-profiles.json` classification (in `full.modules` or `full.excludes`), and `plugin.json` `skills[]` entries
- **THEN** `node scripts/ci/validate-modules.js`, `node scripts/ci/validate-plugin.js`, `node scripts/ci/catalog.js --check`, and `node tests/run-all.js` all pass
