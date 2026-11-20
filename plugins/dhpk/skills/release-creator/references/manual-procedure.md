# Release Creator — Manual Procedure

Use this fallback when `scripts/release-runner.sh` is absent (such as in the
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

1. Resolve the project's release contract from root `RELEASE.md` (authoritative
   if present) or [release-presets.md](release-presets.md), confirming
   `{VERSION_FILES}`, `{VALIDATE_CMD}`, `{BASE_BRANCH}`, `{RELEASE_BRANCH}`,
   `{TAG_PREFIX}`, `{CHANGELOG}`, and `{RELEASE_WORKFLOW}` with the user.
2. Verify strict semver `<X.Y.Z>`, confirm the working tree is on `{BASE_BRANCH}`
   and synced cleanly with `origin/{BASE_BRANCH}`, and update every version
   file, changelog section, and generated release artifact in lockstep (or run the
   project's own `prepare-release` command if `RELEASE.md` defines one).
3. Run `{VALIDATE_CMD}` (`npm test` / project validator). Inspect
   `git status --porcelain --untracked-files=all` and refuse if any changed file
   falls outside the confirmed release file scope.
4. Only after explicit user confirmation of the prepared diff, stage the exact
   release files, commit `chore(release): bump version to <version> and update changelog`,
   push to `origin/{BASE_BRANCH}`, and open the `{BASE_BRANCH} -> {RELEASE_BRANCH}`
   pull request. Mark any unexecuted check `NOT_RUN` and report `mode: manual`.

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

1. Verify the merged PR on GitHub (`gh pr list --head {BASE_BRANCH} --base {RELEASE_BRANCH} --state merged`),
   fetch `origin`, confirm `{RELEASE_BRANCH}` `HEAD` equals the PR's
   `mergeCommit.oid` and has two parents (unless trunk-based model has no PR).
2. Run the project's post-merge publish gate command if defined (e.g., documented
   in `RELEASE.md`) — stop `BLOCKED` / `FAIL` if it exits non-zero; mark
   `NOT_RUN` if omitted and do not claim an overall pass.
3. Confirm user authorization to cut immutable tag `{TAG_PREFIX}<version>`, create
   the annotated tag (`git tag -a "<tag>" -m "Release <tag>"`), push the tag to
   `origin`, watch `{RELEASE_WORKFLOW}` to completion on that exact tag, and
   record consumer verification status separately with `mode: manual`.
