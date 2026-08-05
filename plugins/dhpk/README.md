# plugins/dhpk — Codex Native Marketplace Publication Package

> **Languages**: **English** · [繁體中文](./README.zh-TW.md)

This directory is the plugin folder that `.agents/plugins/marketplace.json`
points at. Codex does not discover plugins whose local marketplace
`source.path` is the marketplace root itself (`./`), so the marketplace entry
must target a concrete plugin subdirectory (see
[openai/codex#26037](https://github.com/openai/codex/issues/26037)).

## Tracked, physical publication artifact

`skills/`, `fingerprints.json`, and `provenance.json` in this directory are a
**generated, tracked publication artifact** — not hand-authored content and
not a symlink mirror. They are regenerated deterministically from
`manifests/distribution-inventory.json`'s explicit `codex-native` surface and
the canonical `skills/`/`modules/` packages at the repo root via
`node scripts/ci/gen-codex-native-package.js plugins/dhpk --version=X.Y.Z`
(`scripts/lib/codex-native-package.js`). Every file under `skills/` is a real
file — zero symlinks — so a clean marketplace cache install still has
working content after the source checkout that produced it is deleted (the
concrete failure mode behind
[GitHub issue #88](https://github.com/hmj1026/dhpk/issues/88); see
[`docs/distribution-surfaces.md`](../../docs/distribution-surfaces.md)).

`.codex-plugin/plugin.json`'s `skills` field is `./skills/`, resolving to
this same tracked tree. The root `.codex-plugin/plugin.json` resolves to the
identical physical directory via the in-root-relative
`./plugins/dhpk/skills/` — both manifests point at one tracked package, never
a second copy.

| File | Purpose |
|---|---|
| `skills/<dhpk-name>/` | Physical, deduplicated content for every `codex-native` skill, keyed by its public inventory name (never the stable id). |
| `fingerprints.json` | Per-skill content hash, for deterministic-generation drift checks. |
| `provenance.json` | Source version, source commit, inventory digest, generator version (a separate counter tracking the generation algorithm itself, bumped independently of the dhpk release version — see `GENERATOR_VERSION` in `scripts/lib/codex-native-package.js`), selected stable skill IDs, and selected public skill names. |

Regenerating this directory and committing the result is part of the release
PR (`scripts/release/prepare-release.js write`); CI validates it
(`scripts/ci/verify-codex-native-package.js`) but does not auto-commit it.

Keep `name` and `version` in sync across `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, this folder's `.codex-plugin/plugin.json`,
`provenance.json`, and `.agents/plugins/marketplace.json` —
`tests/codex-plugin-manifest.test.js` and `scripts/lib/release-parity.js`
enforce this.

## Current Codex plugin-mode status

First run `codex plugin marketplace add hmj1026/dhpk` (once published) or
`codex plugin marketplace add /path/to/dhpk` (local dev), then install with
`codex plugin add dhpk@dhpk`. `tests/codex-native-install-smoke.test.js`
proves — using the real `codex` CLI in a fully sandboxed `CODEX_HOME`, with
the source checkout deleted afterward — that the installed cache contains
every allowlisted native skill as a physical, discoverable file.

This is still an **experimental** support tier: a passing structural and
consumer proof is necessary evidence for a future support-graduation
decision, but it does not itself change the public support tier (see
[ADR-0006](../../docs/adr/0006-codex-native-publication-artifact.md)). The
**supported** Codex path remains the project-local sync flow documented in
the repo README:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```
