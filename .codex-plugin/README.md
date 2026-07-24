# .codex-plugin — Codex Native Plugin for dhpk

This directory contains the **Codex plugin manifest** for dhpk.

## Structure

```
.codex-plugin/
└── plugin.json   — Codex plugin manifest (name, version, skills ref)
```

## What This Provides

- The `codex/skills/` mirror (15 entries) — the same Codex-clean skill subset
  already shipped by `scripts/hooks/install-codex-skills.sh`, now also
  discoverable through Codex's own plugin marketplace.

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
[openai/codex#26037](https://github.com/openai/codex/issues/26037)). That
thin plugin folder references the root `codex/skills/` so content stays
single-sourced; see `plugins/dhpk/README.md` for the full rationale.

After adding the marketplace:

```bash
codex plugin add dhpk@dhpk
codex plugin list
```

> **Plugin mode is currently experimental / fragile on Codex** (verified
> against `codex-cli 0.142.5`). Marketplace discovery and install work with
> this layout, but runtime skill loading from local/repo marketplaces is
> unreliable upstream — Codex copies only the plugin folder into its install
> cache, so parent-referenced content may not be exposed in a fresh session.
> The safer, fully supported path today remains the manual sync script:
> `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"`.

## Notes

- `codex/skills/` at the repo root is the source of truth for both this
  plugin manifest and `install-codex-skills.sh` — do not duplicate skill
  content inside `.codex-plugin/` or `plugins/dhpk/`.
- This manifest does **not** override `~/.codex/config.toml` settings.
