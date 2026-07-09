---
description: 'Cut a new release of a project or plugin — resolve release config, bump version(s), update CHANGELOG, create release PR, and tag'
argument-hint: '<version> [--execute]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Bash(jq:*), Bash(test:*), Read, Grep, Glob'
---

## Context

- Current version: !`jq -r '.version // .project.version // empty' package.json composer.json .claude-plugin/plugin.json 2>/dev/null | head -1`
- Has RELEASE.md: !`test -f RELEASE.md && echo yes || echo no`
- Branch: !`git rev-parse --abbrev-ref HEAD`
- Status: !`git status --short`
- Recent tags: !`git tag --sort=-v:refname | head -5`

## Task

Follow the `release-creator` skill workflow:

1. **Resolve config**: If a root `RELEASE.md` exists, follow it; else auto-detect the ecosystem (via the skill's `references/release-presets.md`) to resolve version file(s), validate command, and branch model. Confirm with the user.
2. **Verify environment**: Ensure on the resolved base branch, clean status, and pulled latest.
3. **Version Bump**: Bump version to `<version>` in the project's manifest(s) — all in lockstep if there are several.
4. **Changelog**: Add a section to the project's changelog detailing changes since last tag.
5. **Validation**: Run the project's validation/test command to ensure everything is correct.
6. **PR & Tag**: Create a Release PR into the release branch, merge per the repo's rules, then pull and tag/push on the release branch.

Arguments:
- `<version>`: Semver version number to release (e.g. `0.28.3`)
- `--execute`: Perform the full release flow (bump, changelog, PR, merge, tag) automatically

## Output

Either a step-by-step interactive guidance to cut the release, or the executed release flow if `--execute` is provided.
