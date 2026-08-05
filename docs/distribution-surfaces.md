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
[`codex-native-publication`](../openspec/changes/make-codex-plugin-distribution-install-safe/specs/codex-native-publication/spec.md)
and [Codex native plugin package](#codex-native-plugin-package-github-issue-88)
below).

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

## Codex native plugin package (GitHub issue #88)

The native Codex marketplace package is a tracked, physical publication
artifact at `plugins/dhpk/`, generated by `scripts/ci/gen-codex-native-package.js`
from the distribution inventory's explicit `codex-native` surface — not from
`lifecycle=promoted` — via `materializeNativePackage()` in
`scripts/lib/codex-native-package.js`. It is committed as part of a release
(see [ADR-0006](adr/0006-codex-native-publication-artifact.md) and
[`make-codex-plugin-distribution-install-safe`](../openspec/changes/make-codex-plugin-distribution-install-safe/)),
never generated fresh at install time.

**Native package membership.** The initial native allowlist is the same
15-entry Codex subset that already had `codex-sync` (11 promoted root skills
plus 4 approved optional-module exceptions: `php-pro`,
`legacy-code-characterization`, `php56-yii-dev`, `yii1-security-audit`).
`codex-sync` and `codex-native` are independent surfaces with independent
acquisition/update/verification contracts — adding a skill to one does not
add it to the other.

When both surfaces expose the same id, the consumer gate records both source
paths, versions, fingerprints, and receipt ownership. The deterministic matrix
returns `BLOCKED` for stale or unowned content or missing precedence, `PASS` for
identical fingerprints with valid provenance, and `WARN` only for a current
receipt-owned project-local fallback explicitly taking precedence over an
experimental native surface.

**Structural safety.** Both `.codex-plugin/plugin.json` (root) and
`plugins/dhpk/.codex-plugin/plugin.json` (marketplace-target wrapper) now
resolve to the SAME physical `plugins/dhpk/skills/` tree — the root manifest
via the in-root-relative `./plugins/dhpk/skills/`, the wrapper via
`./skills/` — with zero symlinks. This closes the two concrete failure
shapes behind issue #88 (the symlink-dependent `codex/skills/` mirror and the
parent-relative `../../codex/skills/` wrapper escape); both are enforced by
`validateNativeCandidate()` and pinned by
`tests/codex-native-experimental-gate.test.js`, which now asserts the
opposite of its original RED state: production manifests must PASS
structural validation, and docs must still say "experimental" (see
"Experimental status, not automatic graduation" below).

**Three independent release gates** validate the exact tracked artifact
(never a disposable temp candidate):
- SOURCE — the distribution inventory and canonical sources
  (`scripts/ci/validate-distribution.js`).
- PACKAGE — the tracked `plugins/dhpk/` artifact's layout, structural safety,
  version parity (including `provenance.json`), and deterministic-generation
  drift (`scripts/release/package-gate.js`, `scripts/ci/verify-codex-native-package.js`).
- CONSUMER — installs the exact tracked artifact via the real `codex` CLI
  into a sandboxed `CODEX_HOME`, deletes the source checkout, and verifies
  the installed cache contains exactly the allowlisted native skills as
  physical files (`scripts/release/consumer-gate.js`,
  `tests/codex-native-install-smoke.test.js`). Reported `UNAVAILABLE` — never
  `PASS` — when the `codex` CLI is absent; a missing or failed native probe
  never fails the supported-tier (Claude/`codex-sync`) verdict.

Every tracked skill's `plugins/dhpk/fingerprints.json` and
`plugins/dhpk/provenance.json` (source version, source commit, inventory
digest, generator version, selected skill IDs) let a reviewer audit exactly
what a release ships without secrets.

**Experimental status, not automatic graduation.** A structural PASS and a
real CONSUMER PASS are necessary evidence, not sufficient by themselves.
Native Codex marketplace support remains **experimental** until a later,
separately approved graduation decision — this document, `README.md`, and
`.codex-plugin/README.md` continue to say so, and
`tests/codex-native-experimental-gate.test.js` fails loudly if that labeling
is silently dropped. The supported Codex delivery path remains
`scripts/hooks/install-codex-skills.sh`, a separate project-local sync
contract unaffected by this package (see its own tests in
`tests/install-codex-skills.test.js` for copy/symlink/update/version-fingerprint
coverage).

**Hardened distribution evidence.** The installer contract and terminology are
defined in [basic operations](basic-operations.md#sync-codex-cli-content). A
handoff records the schema-v2 receipt summary
(created, updated, preserved, collision, pruned, and orphaned counts), the
canonical/mirror fingerprints emitted by `validate-openai-metadata.js`, and
any duplicate-surface evidence from `consumer-gate.js`. The repeatable
verification set is:

```text
node tests/install-codex-skills.test.js
node tests/validate-openai-metadata.test.js
node tests/consumer-gate-cli.test.js
node scripts/ci/validate-openai-metadata.js --root .
node scripts/release/consumer-gate.js --version <version> --repo-root .
node tests/run-all.js
openspec validate <change> --strict --no-interactive
```

The installer and consumer checks run against temporary projects (including
shell-special paths); repository validators, the full suite, and OpenSpec
checks run against the checkout. Durable release evidence keeps absolute
private paths out.
