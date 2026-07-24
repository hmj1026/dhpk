# Runtime Entrypoints

`multi-ai-sync` is bundled at different paths in the supported harnesses.
Resolve one entrypoint before running the workflow and use it for every
subcommand in that run.

## Claude/plugin harness

Set `SYNC_CLI` to:

```bash
SYNC_CLI="${CLAUDE_PLUGIN_ROOT}/skills/multi-ai-sync/scripts/multi_ai_sync.py"
```

The plugin root must contain the referenced script. If
`CLAUDE_PLUGIN_ROOT` is unavailable or the file is missing, stop and report the
runtime resolution blocker.

## Codex project harness

Set `SYNC_CLI` to:

```bash
SYNC_CLI=".codex/skills/multi-ai-sync/scripts/multi_ai_sync.py"
```

The Codex skill installer must have materialized `.codex/skills` before this
entrypoint can run.

## Repository source checkout

When developing this plugin from its source checkout, use:

```bash
SYNC_CLI="skills/multi-ai-sync/scripts/multi_ai_sync.py"
```

This source-checkout path is for local validation only; consumer projects
should use one of the harness paths above.

## Repository root

The CLI defaults to the current working directory. If the repository being
inspected is elsewhere, add `--root <repo-root>` before the subcommand, for
example:

```bash
python3 -B "$SYNC_CLI" --root /path/to/repository plan --format markdown
```
