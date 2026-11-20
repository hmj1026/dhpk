# Merge prep workflow

1. Parse `<source-branch> [--target <branch>]`. Resolve the target from
   `{TARGET_BRANCH}` and then `main` when the option is absent. Verify both
   refs with `git rev-parse --verify <ref>^{commit}` and stop on failure.
2. Read `git status --porcelain`; a non-empty result is a terminal `BLOCKED`
   result. Record the current branch without switching it.
3. Pin the common ancestor and summaries with native read-only commands:

   ```bash
   git merge-base <target> <source>
   git log --oneline <target>..<source>
   git diff --stat <target>...<source>
   git diff --name-status <target>...<source>
   ```

4. Run `git merge-tree --write-tree <target> <source>` and capture both its
   output and exit status. A conflict report is expected analysis evidence,
   not a reason to invoke a merge. If this Git version lacks `--write-tree`,
   report `UNAVAILABLE` rather than falling back to checkout or merge.
5. Group conflict paths and describe text-only strategies (for example,
   inspect the owning change, preserve both compatible hunks, or ask the
   owner before choosing a semantic resolution). Do not edit files or stage
   resolutions.
6. Emit a manual command block such as:

   ```bash
   git switch <target>
   git merge --no-ff <source>
   ```

   Label it `not executed`. The analysis is complete when all evidence fields,
   conflict status, and the manual handoff are present.
