# Consumer asset installation

Use `/dhpk:setup --install hooks|rules|scripts|all` for a deterministic copy
of dhpk assets into a consumer project. The deprecated `/install-hooks`,
`/install-rules`, and `/install-scripts` commands forward to that entry point.

The installer copies from `${CLAUDE_PLUGIN_ROOT}` to
`<project>/.claude/dhpk/`:

| Selection | Source | Target |
|---|---|---|
| `hooks` | `hooks/hooks.json`, `scripts/hooks/` | `.claude/dhpk/hooks/` |
| `rules` | `rules/` | `.claude/dhpk/rules/` |
| `scripts` | `scripts/` | `.claude/dhpk/scripts/` |

It never edits `.claude/settings.json` or `.claude/settings.local.json`.
Consumers register any copied hook explicitly, using their own desired policy.
The default plugin lifecycle remains the five deterministic surfaces described
in [`docs/hook-extension.md`](../../../docs/hook-extension.md).

Run with `--dry-run` to print source and target actions without writing. An
identical target is skipped; a different target is a conflict and the selected
group is left untouched unless the user explicitly requests `--force`.
Executable source files are copied with their executable bit retained.
