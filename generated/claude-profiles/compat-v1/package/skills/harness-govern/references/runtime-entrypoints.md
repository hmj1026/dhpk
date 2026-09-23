# Runtime Entrypoints

The `harness-govern` sync helper is bundled at different paths in the supported harnesses.
Resolve one entrypoint before running the workflow and use it for every
subcommand in that run.

## Claude/plugin harness

Set `SYNC_CLI` to:

```bash
SYNC_CLI="$SKILL_DIR/scripts/multi_ai_sync.py"
```

`$SKILL_DIR` denotes the physical directory containing the selected `SKILL.md`;
it is path notation, not an ambient environment variable or plugin-root lookup.
If the file is missing below that directory, stop with
`BLOCKED_RESOURCE_MISSING` and report the runtime resolution blocker.

## Codex project harness

Set `SYNC_CLI` to:

```bash
SYNC_CLI=".codex/skills/harness-govern/scripts/multi_ai_sync.py"
```

The Codex skill installer must have materialized `.codex/skills` before this
entrypoint can run.

## Repository source checkout

When developing this plugin from its source checkout, use:

```bash
SYNC_CLI="skills/harness-govern/scripts/multi_ai_sync.py"
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
