# .codex-plugin — Codex Native Plugin for dhpk

This directory contains the **experimental Codex plugin manifest** for dhpk.
"Experimental" is a support-tier decision, not a correctness caveat: the
package this manifest points at is a tracked, physical publication artifact
that install-safety gates and a real `codex` CLI consumer proof both
validate on every relevant release — see
[docs/distribution-surfaces.md](../docs/distribution-surfaces.md), the
[platform installation SSOT](../docs/platform-installation.md), and
[ADR-0006](../docs/adr/0006-codex-native-publication-artifact.md).

## Structure

```
.codex-plugin/
└── plugin.json   — Codex plugin manifest (name, version, skills ref)
```

`skills` resolves to `./plugins/dhpk/skills/` — an in-root-relative path to
the tracked native package, not the `codex/skills/` symlink mirror.

## What This Provides

- The tracked `codex-native` package at `plugins/dhpk/` (15 entries) — an
  explicitly allowlisted, physical subset generated from
  `manifests/distribution-inventory.json`. Distinct from the
  `codex/skills/` mirror (15 entries) that `scripts/hooks/install-codex-skills.sh`
  ships under the separate `codex-sync` surface: same starting 15 skills
  today, but its own acquisition/update/verification contract — see
  `plugins/dhpk/README.md`.

No MCP servers are declared — dhpk ships no root `.mcp.json`. Codex-side MCP
config remains a per-project concern handled by `codex/config.toml.example`
(copied, not merged, by `install-codex-skills.sh`).

## Installation

Codex plugin support is marketplace-backed. The repo exposes a repo-scoped
marketplace at `.agents/plugins/marketplace.json`; Codex can add and track
that marketplace source from the CLI:

```bash
# Add the public repo marketplace (once published)
codex plugin marketplace add hmj1026/dhpk

# Or add a local checkout while developing
codex plugin marketplace add /absolute/path/to/dhpk
```

The marketplace entry points at `plugins/dhpk/` — Codex does not discover
plugins whose local marketplace `source.path` is the marketplace root (`./`),
so the entry must target a concrete plugin subdirectory (see
[openai/codex#26037](https://github.com/openai/codex/issues/26037)). See
`plugins/dhpk/README.md` for the tracked package's full layout.

```bash
codex plugin add dhpk@dhpk
codex plugin list
```

`tests/codex-native-install-smoke.test.js` runs this same sequence against
the real `codex` CLI in a sandboxed `CODEX_HOME`, deletes the source
checkout, and verifies the installed cache holds every allowlisted skill as
a real file — that proof is part of `scripts/release/consumer-gate.js` on
every release where a `codex` binary is available.

> **Plugin mode is still not the Supported Codex distribution path.** A
> passing consumer proof is evidence toward a future graduation decision, not
> the decision itself (design.md decision 7). The Supported path today
> remains the manual sync script:
> `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"`.

## Notes

- `codex/skills/` at the repo root remains the source of truth for
  `install-codex-skills.sh`'s `codex-sync` surface — do not point this
  manifest back at it. `plugins/dhpk/skills/` is the separate, tracked
  `codex-native` publication artifact; do not duplicate skill content by hand
  in either location — both are generated or synced from canonical
  `skills/`/`modules/` sources.
- This manifest does **not** override `~/.codex/config.toml` settings.
