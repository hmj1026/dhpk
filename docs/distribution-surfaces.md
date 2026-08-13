# Distribution surfaces — lifecycle, publication, and host limitations

> **Languages**: **English** · [繁體中文](./distribution-surfaces.zh-TW.md)

How dhpk decides which skills and modules reach each consumer surface
(Claude plugin, opt-in stack modules, Codex project-local sync, experimental
Codex marketplace), and what each surface can and cannot filter.

For exact installation commands, support tiers, status vocabulary, consumer
evidence, and rollback, use the [platform installation SSOT](./platform-installation.md).
The ownership and projection decision is recorded in
[ADR-0009](adr/0009-distribution-projection-and-orchestration-ownership.md).

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
`codex-native` (the experimental marketplace package — see
[ADR-0006](adr/0006-codex-native-publication-artifact.md)
and [Codex native plugin package](#codex-native-plugin-package-github-issue-88)
below), `agent-plugin`, and `cursor-plugin`. The last two identify the
generated Agent Plugin and Cursor publication packages; their shared portable
skill ownership and Cursor-native overlay rules are defined below.

Directory placement and README prose are not authoritative — the checked-in
inventory is. `scripts/ci/gen-distribution-inventory.js --write` bootstraps a
new canonical skill's default entry (root `skills/` → `promoted`/`claude-core`,
`modules/*/skills/` → `optional`/`claude-module`, `codex-sync` added wherever
`codex/skills/` already mirrors the entry); `scripts/ci/validate-distribution.js`
reconciles the checked-in file against canonical packages, the module catalog,
and per-skill Codex metadata (`agents/openai.yaml`).

The same inventory also owns Codex projection support files through
`supporting_assets`. Each mapping declares a repository source and a safe
project-local destination below `.codex/`; the installer records every materialized
file in `.dhpk-installed.json`, and `codex-runtime` validation checks that generated
agent references resolve from a clean consumer projection. This keeps review traps,
contracts, and execution policy available to Codex without carrying Claude-only
plugin-root or lifecycle mechanics into the generated TOML.

## Projection contract and rollback

Every migrated publication surface follows one direction of ownership:

```text
inventory projection_contract
  -> compileDistribution (pure immutable plan)
  -> surface adapter renders planned output only
  -> ProjectionArtifactStore stages and atomically publishes
  -> verifyDistribution(stage) returns plan/artifact-bound evidence
```

`manifests/distribution-inventory.json` owns selection, lifecycle, surface
membership, physical owner, transform, destination, verification stages, and
symlink policy. Adapters render consumer-native bytes and observe results only:
they cannot select extra entries, write files, re-own an artifact, or promote a
support tier. `ProjectionArtifactStore` is the sole writer for managed
projection trees. A failed staged write or validation leaves the previously
accepted artifact untouched; rollback uses the same CLI/store path rather than
editing generated files or canonical sources in place.

Symlink policy is closed and fail-closed: `forbid`, `contained-relative`, or
`declared-source-relative`. The default is `forbid`; a contained link must stay
inside its artifact owner, while a declared-source-relative link must be
relative, plan-declared, owned by the destination root, and resolve inside the
plan-bound canonical source root. Only the retained `codex-sync` compatibility
route may use the latter. Absolute or undeclared links are rejected.

Verification is stage-bound. `structural` and `package` `PASS` prove only the
checked artifact/package claims; `consumer-runtime` requires a real consumer
probe. A structural or package pass never graduates an experimental surface or
claims runtime support. Evidence verdicts remain the closed vocabulary
`PASS`, `FAIL`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `BLOCKED`, and
`UNAVAILABLE`.

## Standard Agent Plugin and Cursor native ownership

The platform capability matrix gives identical portable skills one physical
publication owner: `plugins/dhpk-agent/skills/`. The standard Agent Plugin owns
that generated tree, while `plugins/dhpk-cursor/` contains only Cursor-native
rules, agents, commands, hooks, and variables by default. Cursor provenance
records the shared stable IDs and `plugins/dhpk-agent/skills/` source; it does not
create a second `skills/` tree. A Cursor-specific copy is allowed only when an
explicit matrix row uses `projection_mode: overlay`, names the stable IDs, and
records its transform, fallback, and independent fingerprint. Update and
rollback therefore have one owner for shared portable skills and a separate
owner for Cursor-native files.

## Claude publication: current generated surface

`scripts/ci/gen-claude-manifest.js` derives the expected `.claude-plugin/plugin.json`
`skills[]` root set from the inventory (`generateClaudeSkillRoots()` in
`scripts/lib/distribution-inventory.js`) and checks it with `--check`.

As of the current inventory, no skill is `deprecated`, so the generated root
set is identical to the currently-registered set. Regenerate and inspect
scope-specific counts instead of copying a historical snapshot:

```bash
node scripts/ci/gen-claude-manifest.js
node scripts/ci/gen-distribution-inventory.js
```

The current commands report one registered Claude directory root, 103
inventory-eligible Claude skill IDs, 103 canonical skills, and 15 Codex-sync
skills. These are independently derived scopes; a canonical total is not a
default-install or runtime count.

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
(see [ADR-0006](adr/0006-codex-native-publication-artifact.md)),
never generated fresh at install time.

**Native package membership.** The initial native allowlist is the same
15-entry Codex subset that already had `codex-sync` (11 promoted root skills
plus 4 approved optional-module exceptions: `php-pro`,
`legacy-code-characterization`, `php56-yii-dev`, `yii1-security-audit`).
`codex-sync` and `codex-native` are independent surfaces with independent
acquisition/update/verification contracts — adding a skill to one does not
add it to the other.

When both surfaces expose the same public name, the consumer gate records both source
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

Every tracked skill's `plugins/dhpk/fingerprints.json` (keyed by public name) and
`plugins/dhpk/provenance.json` (source version, source commit, inventory
digest, generator version, selected stable skill IDs, and selected public names) let a reviewer audit exactly
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
handoff records the schema-v3 receipt summary
(created, updated, migrated, preserved, collision, pruned, and orphaned counts), the
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
