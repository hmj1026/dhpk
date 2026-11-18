---
name: release-creator
description: "Cuts a new release of a software project or plugin, coordinating release configuration, version files, changelog, validation, and the fixed git/PR/tag/CI sequence. Not for: PHP package publication or ordinary commits. Output: a validated release preparation or publication result with the human merge gate preserved."
metadata:
  dhpk-capability-id: "dhpk.skill.release-creator"
  dhpk-invocation-class: "explicit-only"
  dhpk-name-style: "portable-skill"
---

# Release Creator

Resolve the project release contract first, then delegate fixed mechanics to the
tested runner. `RELEASE.md` is the complete route when the consumer provides it.

`$SKILL_DIR` denotes the physical directory containing this `SKILL.md`;
`$PROJECT_DIR` denotes the consumer project root. These are resolved path
notations, not ambient environment-variable requirements. Run the local runner
from the consumer project after the existing execution approval boundary.

## Output

Return a release report containing the resolved configuration, changed version files,
changelog result, validation result, runner phase, and the current merge/tag/CI gate.
Stop with a blocked report when configuration is ambiguous, validation fails, the PR is
not merged, or the tag-triggered workflow cannot be identified; do not infer a release
success from a local edit or an unassociated CI run.

## When NOT to Use

- PHP package/library publishing: use `$library-author composer`.
- Ordinary feature or bug commits: use `$git-smart-commit`.
- The integration branch or required tests are not ready.

## 1. Resolve the release contract

When the project has `RELEASE.md`, follow its release-candidate, merge, publish,
and recovery sections. Treat its commands and proof boundaries as authoritative
and stop for any decision that the document leaves unresolved. Continue to the
common runner flow only when `RELEASE.md` selects this runner. Otherwise its
documented route is complete.

When `RELEASE.md` is absent, inspect the relevant manifests and
[release presets](references/release-presets.md). Resolve the following values
and confirm them with the user before execution:

| Token | Meaning | Typical default |
|---|---|---|
| `{VERSION_FILES}` | Lockstep version files | `package.json` |
| `{VALIDATE_CMD}` | Required validation | `npm test` |
| `{BASE_BRANCH}` | Integration branch | `main` or `develop` |
| `{RELEASE_BRANCH}` | Published branch | `main` |
| `{TAG_PREFIX}` | Tag prefix | `v` |
| `{CHANGELOG}` | Changelog file | `CHANGELOG.md` |
| `{RELEASE_WORKFLOW}` | Tag-triggered CI workflow | `release.yml` |

## 2. Prepare the release candidate

When `RELEASE.md` selects this runner, perform only its documented preparation
steps, then continue to the common runner flow below. When it selects another
route, stop after following that document.

For dhpk, follow the `RELEASE.md` release-candidate steps in order. Run its
`prepare-release.js write` command, then its `prepare-release.js check` command
once before preparing the PR. Pull-request CI supplies the first full-suite
proof and the publish runner supplies the post-merge gate.

For a project without `RELEASE.md`, use the generic fallback. Update every
`{VERSION_FILES}` entry to `<version>` in lockstep, add the release notes at the
top of `{CHANGELOG}` using the project's required heading format, run
`{VALIDATE_CMD}`, and confirm that only intended release edits remain.

Config resolution, version editing, changelog synthesis, validation
interpretation, and any human merge requirement remain judgment steps. The
runner does not invent them.

## 3. Run the mechanical sequence

After the release edits and validation pass, prepare the release PR. Use the
invocation in `RELEASE.md` when provided. The dhpk invocation omits the file
list so the runner derives its scope from `prepare-release.js paths`. For the
generic fallback, pass every intended release file explicitly. The runner
rejects unrelated worktree changes.

```bash
bash "$SKILL_DIR/scripts/release-runner.sh" \
  "prepare" "<version>" "{BASE_BRANCH}" "{RELEASE_BRANCH}" "{TAG_PREFIX}" "{RELEASE_WORKFLOW}" \
  {VERSION_FILES} {CHANGELOG}
```

Stop here for the human merge. Any route using this runner must use GitHub's
**Create a merge commit** method because the runner requires exactly two merge
parents before tagging. After GitHub reports the PR merged, continue with the
project's publish route.

The runner uses the project publish gate when present and refuses the tag when
required gates fail. Generic projects retain their configured package-gate
fallback through `DHPK_RELEASE_PACKAGE_GATE_SCRIPT`, while a combined gate may
be selected with `DHPK_RELEASE_PUBLISH_GATE_SCRIPT`.

```bash
bash "$SKILL_DIR/scripts/release-runner.sh" \
  "publish" "<version>" "{BASE_BRANCH}" "{RELEASE_BRANCH}" "{TAG_PREFIX}" "{RELEASE_WORKFLOW}"
```

For dhpk, the publish runner automatically runs the SOURCE+PACKAGE gate after
the human merge and before creating the tag. Invoke the publish runner once for
the actual publication. If that gate fails, use the troubleshooting and recovery
route in `RELEASE.md`; the standalone `publish-gate.js` command is a diagnostic
probe for that route.

The publish phase independently verifies the merged `{BASE_BRANCH}` →
`{RELEASE_BRANCH}` PR before tagging: its GitHub `mergeCommit.oid` must equal the
fetched release-branch `HEAD`, and that commit must have two parents. After any
required gate passes, the runner creates an annotated immutable tag, waits for
the associated workflow, and returns to `{BASE_BRANCH}` only after the run
passes. A missing run blocks completion.

In dhpk, the tag workflow resolves the merged release PR head SHA
and passes it to `sync-develop`. That job succeeds only when release completed,
`origin/develop` is still exactly that SHA, and its tree matches `origin/main`;
only then does it align the ref with `--force-with-lease`. A moved develop,
tree difference, or rejected lease is blocking and requires recovery in
`RELEASE.md`. This skill never force-pushes `develop`.

## Verification

- [ ] Release config was resolved and confirmed.
- [ ] All version files agree.
- [ ] Changelog formatting matches project CI.
- [ ] No unrelated worktree changes were included.
- [ ] Validation passed.
- [ ] Release PR followed the project merge policy.
- [ ] Tag exists remotely and release CI passed.
- [ ] Consumer update status is reported separately from publication status.

For dhpk also verify that the Release workflow confirmed
`origin/develop` did not advance after the release PR and that `sync-develop`
aligned `origin/develop` to `origin/main` with `--force-with-lease`.

For projects without `RELEASE.md`, record the resolved configuration, validation
result, runner phase, and the same merge/tag/CI evidence. Preserve all three
release proofs when the project defines them, and keep consumer evidence
separate from publication evidence.
