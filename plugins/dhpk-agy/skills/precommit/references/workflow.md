# Precommit workflow

1. Parse `[--fast]`. With `--fast`, set `mode=fast`; with no option, set
   `mode=full`. An unknown option is a terminal usage failure.
2. Resolve `$SKILL_DIR` to the installed directory containing this `SKILL.md`,
   not the consumer repository. Resolve the adjacent `scripts/lib/runner-utils.js`
   from the same Skill directory. A setup installation resolves the runner as
   `.claude/dhpk/skills/precommit/scripts/precommit-runner.js`. Keep the
   consumer's current working directory unchanged and run:

   ```bash
   node "$SKILL_DIR/scripts/precommit-runner.js" --mode <fast|full> --tail 80
   ```

3. Treat the packaged runner as the sole source of truth for ecosystem
   detection, package manager, stage ordering, graceful skips, changed-file
   reporting, and the final summary. Its local helper is part of that closure.
   Keep replacement lint/build/test dispatch outside this procedure when the
   runner is absent or fails.
4. If the runner cannot be resolved, return `UNAVAILABLE`. Preserve an explicit
   `UNSUPPORTED` verdict (exit 2) when no Git repository or executable checks
   are available. Read the semantic result from `summary.json` and the final
   Markdown verdict before interpreting the exit code. Other non-zero exits,
   `FAIL`, or `overallPass=false` without an explicit `UNSUPPORTED` verdict
   mean `FAIL`, even if the CLI exits zero. A missing final verdict is `FAIL`;
   never infer `PASS` from exit status alone.
5. Report the runner's output verbatim enough to preserve stage statuses and
   paths. Completion requires a mode, runner path, exit status, changed-file
   section, and final verdict.

## Explicit repository configuration

The runner reads `precommit.config.json` from the consumer repository root
before looking for a root `package.json`. When this file exists, its `stages`
object is authoritative and root package scripts are not used as fallback.
This supports repositories without a root JavaScript package and repositories
whose checks live in separate backend and frontend directories.

Use the stage keys `lint_fix`, `build`, and `test_unit`. Each configured stage
is a non-empty array of commands. The runner executes entries in array order,
and stages in `lint_fix` → `build` → `test_unit` order; fast mode omits `build`.
Each command has a unique stage-local `name`, a `command` executable, optional
string-array `args`, and optional `cwd` relative to the repository root (the
default is `.`). The runner invokes the executable directly without a shell,
validates that `cwd` resolves to an existing directory inside the repository,
and reports each command separately.

For example, a Python backend and JavaScript frontend can declare their
existing checks this way:

```json
{
  "stages": {
    "lint_fix": [
      { "name": "backend", "cwd": "backend", "command": "uv", "args": ["run", "ruff", "check", "--fix", "."] },
      { "name": "frontend", "cwd": "frontend", "command": "pnpm", "args": ["lint"] }
    ],
    "build": [
      { "name": "frontend", "cwd": "frontend", "command": "pnpm", "args": ["build"] }
    ],
    "test_unit": [
      { "name": "backend", "cwd": "backend", "command": "uv", "args": ["run", "pytest", "-q"] },
      { "name": "frontend", "cwd": "frontend", "command": "pnpm", "args": ["test", "--coverage"] }
    ]
  }
}
```

The config belongs to the consumer repository and its commands execute with
the current user's permissions. Only run it for repositories whose commands
you trust. Without this file, the runner keeps its root `package.json` script
selection for `lint:fix`, `build`, `test:js`, `test:unit`, and `test`.
If neither configuration path supplies any runnable checks, the result is
`UNSUPPORTED` with exit code 2. A failed command or invalid config is `FAIL`
with a non-zero exit code.
