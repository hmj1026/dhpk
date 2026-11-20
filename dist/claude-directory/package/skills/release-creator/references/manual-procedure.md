# Release Creator — Manual Procedure

Use this fallback when `packaged-release-runner.sh` is absent (such as in the
instruction-only Directory Plugin) or cannot execute.

## Safety Rules

- Run this skill **only on an explicit user request**; stop and ask before any
  version edit, commit, push, PR creation, or tag creation if selected by the
  model.
- Never self-approve, force-merge, squash-merge, or rebase-merge when the
  project requires a human merge commit (two parents on `{RELEASE_BRANCH}`).
- Reject unexpected/unrelated worktree changes outside the project's release
  scope before staging or committing anything.
- Never infer release success from local edits or an unassociated CI run. Keep
  any unexecuted gate or verification stage marked `NOT_RUN` (never an overall
  `PASS`) and state `mode: manual` in every release report.

## Stage: prepare

Matches `release-runner.sh prepare`.

1. Resolve the project's release contract from root `RELEASE.md` (authoritative
   if present) or [release-presets.md](release-presets.md), confirming
   `{VERSION_FILES}`, `{VALIDATE_CMD}`, `{BASE_BRANCH}`, `{RELEASE_BRANCH}`,
   `{TAG_PREFIX}`, `{CHANGELOG}`, and `{RELEASE_WORKFLOW}` with the user.
2. Verify strict semver `<X.Y.Z>`. If the user gave no file list and the project
   has no `$PROJECT_DIR/packaged-prepare-release.js`, stop and ask for files before
   any Git change. Then run `git checkout {BASE_BRANCH}` and
   `git pull --ff-only`. Then update every version file, changelog section, and
   generated release artifact in lockstep (or run the project's own
   `prepare-release` command if `RELEASE.md` defines one).
3. Resolve the release file scope. Use the file list the user gave. If none was
   given, run `node $PROJECT_DIR/packaged-prepare-release.js paths`; each output line
   is `file <path>`, `dir <prefix>`, or `deleted <prefix>`. Stop if the output
   is empty.
4. Run `{VALIDATE_CMD}` (`npm test` / project validator). Inspect
   `git status --porcelain --untracked-files=all` (for a rename, use the new
   path). Refuse if any changed path is outside the scope: a `file` entry must
   match exactly, a `dir` entry matches by path prefix, and a `deleted` entry
   matches by prefix only when the path is deleted. A deletion is allowed only
   when a `deleted` entry matches it by prefix.
   Stop if no release change is found in scope.
5. Only after explicit user confirmation of the prepared diff, stage every
   release file (`git add -- <path>` if it exists, else `git add -u -- <path>`
   for a deletion). Then verify each release file is staged with
   `git diff --cached --name-only -- <path>`; stop if any is not.
6. Commit `chore(release): bump version to <version> and update changelog`, push
   to `origin/{BASE_BRANCH}`, and open the `{BASE_BRANCH} -> {RELEASE_BRANCH}`
   pull request (title `Release <tag>`). Mark any unexecuted check `NOT_RUN`
   and report `mode: manual`.

## Stage: human-merge-gate

1. Present the prepared release PR URL, changed files, and validation results
   cleanly and **STOP**.
2. Wait for a human to review and merge the release PR using the project's
   required merge method (for PR-driven two-parent flows such as dhpk, GitHub
   **Create a merge commit** so the resulting merge commit has two parents and
   `{RELEASE_BRANCH}` HEAD matches `mergeCommit.oid`).
3. Do not proceed to `publish` until GitHub confirms the PR is merged; report
   `human-merge-gate: NOT_RUN` / `BLOCKED` while awaiting merge (`mode: manual`).

## Stage: publish

Matches `release-runner.sh publish`. Accept no release file list.

1. Look up the merge commit:
   `gh pr list --head {BASE_BRANCH} --base {RELEASE_BRANCH} --state merged --limit 1 --json mergeCommit --jq '.[0].mergeCommit.oid // empty'`.
   If the result is empty, the PR is not merged: stop `BLOCKED`.
2. Run `git checkout {RELEASE_BRANCH}` and `git pull --ff-only`. Compare
   `git rev-parse HEAD` with the merge commit. If they differ, stop; do not tag.
   Confirm HEAD has exactly two parents (`git rev-list --parents -n1 HEAD`);
   stop if it is a squash or rebase commit.
3. Run the pre-tag gate in the consumer project. Use the combined gate
   (`$PROJECT_DIR/packaged-publish-gate.js`, or the script the project names in
   `DHPK_RELEASE_PUBLISH_GATE_SCRIPT`) with `node <script> --version <version>`.
   If no combined gate exists, use the package-only gate instead
   (`$PROJECT_DIR/packaged-package-gate.js`, or `DHPK_RELEASE_PACKAGE_GATE_SCRIPT`).
   Stop `FAIL` if a named script is missing or exits non-zero. If the project
   has no gate, mark it `NOT_RUN` and do not claim an overall pass.
4. Stop if the tag `{TAG_PREFIX}<version>` already exists
   (`git tag --list "<tag>"` is not empty); tags are immutable.
5. Confirm user authorization to cut the tag. Create it
   (`git tag -a "<tag>" -m "Release <tag>"`) and push it to `origin`.
6. Find the `{RELEASE_WORKFLOW}` run for that tag:
   `gh run list --workflow {RELEASE_WORKFLOW} --branch <tag> --event push --limit 1 --json databaseId --jq '.[0].databaseId // empty'`.
   Retry (up to 30 times, 5 seconds apart) until a run ID appears; stop `FAIL`
   if none appears. Then run `gh run watch <run-id> --exit-status`. A non-zero
   exit fails the stage; never report the tag as published.
7. Run `git fetch origin {RELEASE_BRANCH} {BASE_BRANCH}` and compare
   `origin/{RELEASE_BRANCH}` with `origin/{BASE_BRANCH}`. If the SHAs match,
   the branches are aligned. If the SHAs differ but `git diff --quiet` shows
   equal trees, fail: idle-align did not land. If the trees differ, fail:
   `{BASE_BRANCH}` has unique content and sync-develop is blocked.
8. When aligned, restore the local branch with
   `git checkout -B {BASE_BRANCH} origin/{BASE_BRANCH}`. Record consumer
   verification status separately and report `mode: manual`.
