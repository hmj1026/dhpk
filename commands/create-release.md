---
description: 'Cut a new release of the dhpk plugin — bump versions, update CHANGELOG, create release PR, and tag'
argument-hint: '<version> [--execute]'
allowed-tools: 'Bash(git:*), Bash(gh:*), Read, Grep, Glob'
---

## Context

- Current version: !`jq -r .version .claude-plugin/plugin.json`
- Branch: !`git rev-parse --abbrev-ref HEAD`
- Status: !`git status --short`
- Recent tags: !`git tag --sort=-v:refname | head -5`

## Task

Follow the `release-creator` skill workflow:

1. **Verify environment**: Ensure on branch `develop`, clean status, and pulled latest.
2. **Version Bump**: Bump version to `<version>` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugins/dhpk/.codex-plugin/plugin.json`, and `.agents/plugins/marketplace.json`.
3. **Changelog**: Add a section to `CHANGELOG.md` detailing changes since last tag.
4. **Validation**: Run the tests to ensure everything is correct.
5. **PR & Tag**: Create a Release PR into `main`, merge it, then pull and tag/push on `main`.

Arguments:
- `<version>`: Semver version number to release (e.g. `0.28.3`)
- `--execute`: Perform the full release flow (bump, changelog, PR, merge, tag) automatically

## Output

Either a step-by-step interactive guidance to cut the release, or the executed release flow if `--execute` is provided.
