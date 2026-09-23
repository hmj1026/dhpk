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
4. If the runner cannot be resolved, return `UNAVAILABLE`. If it exits
   non-zero, return `FAIL` with its output and exit code. Read the semantic
   result from `summary.json` and the final Markdown verdict: `overallPass=false`
   or `FAIL` is `FAIL` even when the CLI exits zero. If it exits zero but omits
   its final verdict, return `FAIL` rather than inferring `PASS`.
5. Report the runner's output verbatim enough to preserve stage statuses and
   paths. Completion requires a mode, runner path, exit status, changed-file
   section, and final verdict.
