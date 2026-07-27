# Distribution surfaces — lifecycle, publication, and host limitations

How dhpk decides which skills and modules reach each consumer surface
(Claude plugin, opt-in stack modules, Codex project-local sync, experimental
Codex marketplace), and what each surface can and cannot filter.

## Lifecycle model

Every consumer-reachable skill and module carries exactly one lifecycle in
`manifests/distribution-inventory.json`:

| Lifecycle | Meaning |
|---|---|
| `promoted` | Broadly applicable core workflow skill. |
| `optional` | Opt-in stack-module skill or the module itself. |
| `experimental` | Not yet host-verified for its target surface (currently unused — no skill needs it yet). |
| `deprecated` | Removed from promoted publication; canonical source and migration guidance remain during a compatibility window (see [Two-stage deprecation](#two-stage-deprecation)). |

Each entry also declares its publication `surfaces`: `claude-core`,
`claude-module`, `codex-sync` (the supported `install-codex-skills.sh` path),
and `codex-native` (the experimental marketplace package — see
[`codex-install-materialization`](../openspec/changes/curate-dhpk-distribution-surfaces/specs/codex-install-materialization/spec.md)).

Directory placement and README prose are not authoritative — the checked-in
inventory is. `scripts/ci/gen-distribution-inventory.js --write` bootstraps a
new canonical skill's default entry (root `skills/` → `promoted`/`claude-core`,
`modules/*/skills/` → `optional`/`claude-module`, `codex-sync` added wherever
`codex/skills/` already mirrors the entry); `scripts/ci/validate-distribution.js`
reconciles the checked-in file against canonical packages, the module catalog,
and per-skill Codex metadata (`agents/openai.yaml`).

## Claude publication: current before/after surface

`scripts/ci/gen-claude-manifest.js` derives the expected `.claude-plugin/plugin.json`
`skills[]` root set from the inventory (`generateClaudeSkillRoots()` in
`scripts/lib/distribution-inventory.js`) and checks it with `--check`.

As of this change's first migration phase, no skill is `deprecated`, so the
generated root set is **identical** to the currently-registered set:

| | Before | After |
|---|---|---|
| Registered directory roots | 32 | 32 |
| Skills reachable under those roots | 105 | 105 |

Nothing is removed from `plugin.json` in this phase (design.md Non-Goals:
"Deleting canonical skills during the first migration"). The generator
becomes load-bearing the first time a skill is deprecated — see below.

## Host limitation: directory roots, not per-skill filtering

Claude Code's plugin manifest registers skill **directories**, not
individual skills — there is no field to list "these specific skills under
this directory" or to hide one skill's description while still loading its
siblings.

Consequences:

- **A module skill cannot be individually hidden.** If `modules/vue-2/skills/`
  contains two skills and one is deprecated, `./modules/vue-2/skills/` stays
  registered as long as the other is not — the deprecated skill's description
  remains discoverable to the host even though the distribution inventory no
  longer classifies it as promoted.
- **A whole root can still disappear.** If every skill under a root becomes
  deprecated, `generateClaudeSkillRoots()` drops that root entirely — this is
  the one case where Claude's registration surface actually shrinks.
- **`optional` (module) skill descriptions are never hidden by module
  selection.** Enabling/disabling a stack module in `userConfig.modules`
  changes which module's *hooks and guidance* activate at runtime, but every
  module's skill directory is still registered in `plugin.json` and its
  `SKILL.md` description is still listed by the host regardless of which
  modules a project has enabled. Do not describe the optional set as "hidden"
  at discovery time — only runtime activation is gated.

This means `generatedSkillIds` (the inventory-derived "should be promoted"
set used for counts and validation in task 4) is a documentation and
count-scoping construct, not a claim about what the Claude host actually
lists. `scripts/ci/gen-claude-manifest.js --check` verifies the directory-root
set only; it cannot and does not assert per-skill hiding.

## Two-stage deprecation

1. Change the skill's lifecycle to `deprecated` in the distribution
   inventory, and add a `deprecation` object with the compatibility-window
   metadata `validateDistributionInventory()` requires for any `deprecated`
   entry:

   ```json
   {
     "id": "old-skill",
     "path": "skills/old-skill",
     "lifecycle": "deprecated",
     "surfaces": ["claude-core"],
     "deprecation": {
       "since": "2026-07-27",
       "compatibilityWindowEnds": "2026-10-27",
       "migrationNote": "Use new-skill instead; see docs/... for the mapping."
     }
   }
   ```

   All three `deprecation` fields (`since`, `compatibilityWindowEnds`,
   `migrationNote`) are mandatory once `lifecycle` is `deprecated` —
   `scripts/ci/validate-distribution.js` fails otherwise. The skill is
   immediately excluded from `generatedSkillIds` (promoted counts and the
   deprecated-leak validation in `validateDistributionInventory()`), while its
   canonical `SKILL.md`, references, and scripts remain untouched on disk and
   (subject to the host limitation above) may still be visible under a shared
   directory root.
2. After `compatibilityWindowEnds` has passed and a repository reference scan
   confirms nothing still points at the deprecated skill, a later reviewed
   change deletes the canonical source. `validateDistributionInventory` has no
   automatic timer — the window and reference-scan gate are enforced by human
   review of that later change, not by this repository's CI; the recorded
   `compatibilityWindowEnds` date is the human-readable gate a reviewer checks
   before approving that deletion.

## Codex native plugin status (GitHub issue #88)

`scripts/ci/gen-codex-native-package.js` builds a promoted-only, entirely
physical (no-symlink) staged release candidate from the distribution
inventory, and `tests/codex-native-install-smoke.test.js` proves — using the
real `codex` CLI in a fully sandboxed `CODEX_HOME` — that this staged
candidate survives a clean marketplace install with the source checkout
deleted afterward: every promoted skill materializes as a real file in the
installed cache, matching issue #88's acceptance criteria.

**This does not close issue #88.** The currently-shipped native manifests
(`.codex-plugin/plugin.json`, `plugins/dhpk/.codex-plugin/plugin.json`) still
point at the symlink-dependent `codex/skills/` mirror and the parent-relative
`../../codex/skills/` wrapper path respectively — both continue to fail
`validateNativeCandidate()` by design (enforced by
`tests/codex-native-experimental-gate.test.js`, which fails loudly if either
manifest starts passing without a conscious decision to graduate them).
Productionizing the staged candidate — i.e. actually shipping a physical
package instead of the symlink mirror — requires deciding where a generated
release artifact lives and how long it is retained, which design.md leaves as
an open question. Native Codex plugin support therefore remains
**experimental**, and the supported Codex delivery path remains
`scripts/hooks/install-codex-skills.sh` (see its own tests in
`tests/install-codex-skills.test.js` for copy/symlink/update/version-fingerprint
coverage).
