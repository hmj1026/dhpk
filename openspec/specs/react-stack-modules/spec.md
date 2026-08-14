# react-stack-modules Specification

## Purpose
TBD - created by archiving change add-react-modules. Update Purpose after archive.
## Requirements
### Requirement: React per-major modules exist with a consistent identity triple

The plugin SHALL ship one opt-in module per supported React major
(`react-18`, `react-19`), each providing a single `*-notes` skill.

#### Scenario: module identity is internally consistent

- WHEN `scripts/ci/validate-modules.js --strict` runs
- THEN each React module's `module.yaml` `name` equals its directory name, and
  its `provides.skills` entry resolves to a `SKILL.md` whose frontmatter `name`
  matches (e.g. `react-18` → `react-18-notes`)

### Requirement: React modules use the frontend trigger contract

Each React module SHALL declare a `frontend:` trigger block using the same key
and extension contract as `modules/js/module.yaml`.

#### Scenario: a React source edit maps to the frontend review slot

- WHEN a `.tsx` / `.ts` / `.jsx` / `.js` file is edited with a React module active
- THEN the frontend review slot is flagged (additively; no double-fire when the
  `js` module is also active)

### Requirement: React modules are registered as an exclusive stack at all points

The React modules SHALL be registered as an **exclusive** `react` stack across
the four registration points, and the install-profiles disjoint-union invariant
SHALL hold.

#### Scenario: catalog, profiles, plugin, and docs reconcile

- WHEN `node tests/run-all.js` and `node scripts/ci/catalog.js --check` run
- THEN `module-catalog.json` has an exclusive `react` stack mapping `18`→`react-18`
  and `19`→`react-19`; both ids appear in `install-profiles.json` `full.excludes`
  (union with `full.modules` equals every shipped module, disjoint); both skill
  paths are in `plugin.json` `skills[]`; and the `31 opt-in stack modules` claim
  is satisfied in the CLAIM_FILES

### Requirement: React skills lead with verified version-floor facts

Each React `*-notes` skill SHALL state accurate, Context7-verified React-major
facts, and MUST NOT assert React-major coupling that does not exist (e.g. that
Next.js 16 requires React 19).

#### Scenario: React floor facts are correct

- WHEN a reviewer reads `react-19-notes`
- THEN it states React 19 is recommended but not required for Next.js 16 (React
  18.2+ also works), consistent with `nextjs-16-notes`
