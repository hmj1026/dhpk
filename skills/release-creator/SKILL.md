---
name: release-creator
argument-hint: '<version>'
description: 'Cut a new release of a software project or plugin. Use when: release configuration, version files, changelog, validation, and the fixed git/PR/tag/CI sequence must be coordinated. Not for: PHP package publication or ordinary commits. Output: a validated release preparation or publication result with the human merge gate preserved.'
---

# Release Creator

Resolve project-specific release judgment first; delegate the fixed mechanics to the tested runner.

## Output

Return a release report containing the resolved configuration, changed version files,
changelog result, validation result, runner phase, and the current merge/tag/CI gate.
Stop with a blocked report when configuration is ambiguous, validation fails, the PR is
not merged, or the tag-triggered workflow cannot be identified; do not infer a release
success from a local edit or an unassociated CI run.

## When NOT to Use

- PHP package/library publishing: use `composer-package-hygiene`.
- Ordinary feature or bug commits: use `git-smart-commit`.
- The integration branch or required tests are not ready.

## 1. Resolve release config

1. Follow project `RELEASE.md` when present.
2. Otherwise inspect the relevant manifests and `references/release-presets.md`.
3. Confirm these values with the user before execution:

| Token | Meaning | Typical default |
|---|---|---|
| `{VERSION_FILES}` | Lockstep version files | `package.json` |
| `{VALIDATE_CMD}` | Required validation | `npm test` |
| `{BASE_BRANCH}` | Integration branch | `main` or `develop` |
| `{RELEASE_BRANCH}` | Published branch | `main` |
| `{TAG_PREFIX}` | Tag prefix | `v` |
| `{CHANGELOG}` | Changelog file | `CHANGELOG.md` |
| `{RELEASE_WORKFLOW}` | Tag-triggered CI workflow | `release.yml` |

## 2. Author the release content

- Update every `{VERSION_FILES}` entry to `<version>` in lockstep.
- Add the release notes at the top of `{CHANGELOG}` using the exact heading format required by `RELEASE.md`/CI.
- Run `{VALIDATE_CMD}` and stop on failure.
- Confirm the workspace now contains only the intended release edits.

Config resolution, version editing, changelog synthesis, validation interpretation, and any human merge requirement remain judgment steps; the runner does not invent them.

## 3. Run the mechanical sequence

After the release edits and validation are complete, prepare the release PR:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release-creator/scripts/release-runner.sh" \
  "prepare" "<version>" "{BASE_BRANCH}" "{RELEASE_BRANCH}" "{TAG_PREFIX}" "{RELEASE_WORKFLOW}"
```

Stop here for the human merge; never self-merge against policy. After GitHub reports
the PR merged, publish the tag and watch its exact workflow run:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release-creator/scripts/release-runner.sh" \
  "publish" "<version>" "{BASE_BRANCH}" "{RELEASE_BRANCH}" "{TAG_PREFIX}" "{RELEASE_WORKFLOW}"
```

The publish phase independently verifies the PR merge before tagging, polls for a
workflow run associated with the new tag, fails if no matching run appears, and
returns to `{BASE_BRANCH}` after that run completes.

## Verification

- [ ] Release config was resolved and confirmed.
- [ ] All version files agree.
- [ ] Changelog formatting matches project CI.
- [ ] Validation passed.
- [ ] Release PR followed the project merge policy.
- [ ] Tag exists remotely and release CI passed.
- [ ] Integration branch is synchronized after release/back-merge.
