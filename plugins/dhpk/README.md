# plugins/dhpk — Codex Repo-Marketplace Plugin Target

This directory is the plugin folder that `.agents/plugins/marketplace.json`
points at. Codex does not discover plugins whose local marketplace
`source.path` is the marketplace root itself (`./`), so the marketplace entry
must target a concrete plugin subdirectory (see
[openai/codex#26037](https://github.com/openai/codex/issues/26037)).

## Single source of truth

No skill content is vendored here. `.codex-plugin/plugin.json` references the
canonical `codex/skills/` mirror at the repo root with a parent-relative
path:

| Manifest field | Resolves to |
|---|---|
| `skills` | `codex/skills/` at the repo root |

`codex/skills/` is the same Codex-clean mirror `scripts/hooks/install-codex-skills.sh`
already ships to consuming projects — this manifest adds marketplace
discoverability on top of it without duplicating or forking any content.

Keep `name` and `version` in sync across `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, this folder's `.codex-plugin/plugin.json`, and
`.agents/plugins/marketplace.json` — `tests/codex-plugin-manifest.test.js`
enforces this.

## Current Codex plugin-mode status

With this layout, `codex plugin marketplace add hmj1026/dhpk` (once
published) or `codex plugin marketplace add /path/to/dhpk` (local dev)
discovers and installs `dhpk@dhpk`. Runtime skill loading from repo
marketplaces is still unreliable upstream — Codex copies only the plugin
folder into its install cache, and local/personal marketplace plugins are not
always exposed at runtime (see the issue linked above).

Until the upstream discovery issue settles, the supported Codex path remains
the manual sync flow documented in the repo README:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```
