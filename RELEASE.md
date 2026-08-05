# Release process

dhpk uses a direct, PR-driven release flow:

```
feature/*, fix/* ──► develop ──(release PR)──► main ──► annotated vX.Y.Z tag
                                      │                         │
                                      │                         └─ Release CI
                                      └─────────────────────────── back-merge
```

`develop` is the permanent integration branch. A release is a deliberate
`develop` → `main` pull request; it does not use a temporary `release/*`
branch. The pull request is the release candidate boundary, and the tag is
created only after that pull request is merged.

## Contract language

- **Release candidate** — the version and changelog changes proposed by the
  release PR.
- **Published release** — the immutable `vX.Y.Z` tag, successful Release
  workflow, GitHub Release, and successful `main` → `develop` back-merge.
- **Consumer update** — a separate action that refreshes a Claude or Codex
  consumer. A published release does not imply that every consumer updated.
- **Immutable tag** — a tag that is never moved, deleted, or reused. A
  correction requires a new patch version.

## Branch rules

- **`main`** — released line. It receives changes through pull requests only.
- **`develop`** — permanent integration branch. It must be synchronized with
  `main` after every published release and is never deleted.
- **`feature/*` and `fix/*`** — branch from `develop` and merge back through a
  pull request.
- **`hotfix/*`** — exceptional emergency lane from `main`; merge the fix to
  both `main` and `develop` through the normal human approval boundary.
- **`release/*`** — not part of the normal dhpk release contract.

Temporary branches may be removed only after release provenance is verified:
the relevant tag, GitHub Release, Release workflow, and branch comparison must
show that the branch has no unreleased work. Never delete a branch merely
because it looks merged.

## Release-note fragments

Every user-visible feature, fix, deprecation, or breaking change adds one
fragment file at merge time, instead of hand-editing `CHANGELOG.md` per PR:

```
changelog.d/<category>.<slug>.md   # category: feat, fix, refactor, docs,
                                    # test, chore, perf, ci, or BREAKING
```

Content is exactly two lines (see `changelog.d/TEMPLATE.md`):

```
scope: <short-scope-token>
note: <one sentence, matches the existing CHANGELOG.md bullet style>
```

An internal-only change (tests, refactors with no user-visible effect,
internal tooling) adds an empty marker instead:

```
changelog.d/<slug>.none
```

Continuous CI (`ci.yml`) validates fragment schema on every push, and on
pull requests fails when a non-test-only diff carries neither a fragment nor
a `.none` marker — see `scripts/ci/validate-changelog-fragments.js` and
`scripts/lib/changelog-fragments.js`.

The release PR (`develop` → `main`) is the one shape where no fragment is
pending: release preparation already promoted them into `CHANGELOG.md` and
deleted them. The coverage gate therefore also accepts a promoted release
section as the standing evidence — coverage for those files was already
enforced on the feature PRs that introduced them.

So the exemption cannot become a general-purpose way to skip the fragment
requirement, it needs all three of the following:

0. the pull request's **base ref is `main`** — this is the release PR at all;
1. the diff **adds** a `## X.Y.Z ...` heading that did not exist at the diff
   base — a genuinely new section, not a reworded or re-dated old one; and
2. that `X.Y.Z` matches the version in `.claude-plugin/plugin.json` at `HEAD`,
   since release preparation moves the manifests and `CHANGELOG.md` in lockstep.

Condition 0 is the trust boundary and is why it is listed first. Conditions 1
and 2 are both ordinary file edits, so a PR author who wanted to skip the
fragment requirement could write a matching heading and bump the manifest in
the same commit. The base ref cannot be forged that way — CI supplies it from
the pull-request event (`--base-ref "$BASE_REF"` in `ci.yml`), and only the
release PR targets `main`.

The residual is therefore bounded to PRs that already target `main`, which is
the release boundary: human-merged, and separately governed by
`prepare-release.js check` and the tag-time `verify-release-parity.js`. It is
not claimed to be unforgeable there — it is claimed to be unreachable from an
ordinary feature PR.

Everything unknown fails closed. A missing `--base-ref`, a non-release base, or
an unreadable manifest all mean no exemption and the ordinary fragment
requirement stands.

## Release candidate preparation

1. Confirm that `develop` contains the intended changes and is up to date:

   ```bash
   git checkout develop
   git pull --ff-only
   ```

2. Run the release preparation command. It is the single source of truth for
   version-bearing surfaces: it SemVer-validates the target, promotes
   `changelog.d/` fragments into `CHANGELOG.md`, and updates every manifest
   in lockstep. It refuses to run anywhere but `develop`, and check mode
   never edits files:

   ```bash
   # Check mode — reports drift, changes nothing:
   node scripts/release/prepare-release.js check --version X.Y.Z

   # Write mode — promotes fragments and bumps every manifest:
   node scripts/release/prepare-release.js write \
     --version X.Y.Z --date YYYY-MM-DD --summary "One-line release summary"
   ```

   The exact version-bearing surfaces it keeps in lockstep (`scripts/lib/release-parity.js`):

   - `.claude-plugin/plugin.json`
   - `.codex-plugin/plugin.json`
   - `plugins/dhpk/.codex-plugin/plugin.json`
   - `.agents/plugins/marketplace.json`
   - `CHANGELOG.md` (`## X.Y.Z — YYYY-MM-DD — summary` heading)

   All four manifests must contain the same SemVer version. The tag format is
   exactly `vX.Y.Z`. Confirm the worktree contains only these five files
   afterward — write mode never touches anything else.

   **Failure remediation:** check mode's error list names every drifted file
   with its observed and expected version; re-run write mode (or hand-edit)
   until check mode passes. A write-mode failure on invalid fragments leaves
   every file unchanged — fix the named `changelog.d/` file and re-run.

3. Run the release validation before creating the PR:

   ```bash
   bash scripts/validate/validate-harness.sh
   node scripts/ci/validate-agents.js --strict
   node scripts/ci/validate-skills.js --strict
   node scripts/ci/validate-commands.js --strict
   node scripts/ci/validate-modules.js --strict
   node scripts/ci/validate-plugin.js --strict
   node scripts/ci/catalog.js --check all
   node scripts/release/prepare-release.js check --version X.Y.Z
   node tests/run-all.js
   ```

   The release PR must pass the `validate` and Markdown `lint` jobs. The tag
   workflow does not replace pull-request validation.

4. Prepare the direct `develop` → `main` PR. Pass every intended release file
   explicitly; the runner rejects unrelated worktree changes and never stages
   the whole repository implicitly:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/dhpk-release-creator/scripts/release-runner.sh" \
     prepare X.Y.Z develop main v release.yml \
     .claude-plugin/plugin.json \
     .codex-plugin/plugin.json \
     plugins/dhpk/.codex-plugin/plugin.json \
     .agents/plugins/marketplace.json \
     CHANGELOG.md
   ```

## Merge and publish

Pull-request merge is always a human action. An agent may prepare the release
commit and PR, but must stop at the merge gate.

After the human confirms that the release PR is merged, run the publish gate.
It blocks on SOURCE or PACKAGE FAIL and never merges a PR, creates a tag, or
pushes anything itself — `release-runner.sh publish` still owns those
mechanics and remains an explicit, separate step:

```bash
node scripts/release/publish-gate.js --version X.Y.Z
```

Once the publish gate passes, publish the tag:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/dhpk-release-creator/scripts/release-runner.sh" \
  publish X.Y.Z develop main v release.yml
```

The publish phase:

- verifies a merged `develop` → `main` PR;
- fast-forwards the local `main` checkout;
- refuses an existing tag because tags are immutable;
- creates an annotated `vX.Y.Z` tag on `main`;
- pushes the tag and watches the Release workflow run for that exact tag; and
- returns to `develop` only after the workflow succeeds.

The Release workflow accepts only `vX.Y.Z` tags, verifies that the tag commit
is contained in `origin/main`, re-verifies manifest/changelog parity for the
tag version (`scripts/ci/verify-release-parity.js`), rejects missing or
whitespace-only changelog notes (`scripts/release/extract-notes.sh`), and
creates a GitHub Release from those notes. If the GitHub Release already
exists, a rerun preserves it rather than editing its metadata.

## Release completion and recovery

A release is complete only when all of these states hold:

1. the release PR is merged;
2. the immutable tag exists;
3. the Release workflow and GitHub Release succeed; and
4. the `sync-develop` job successfully back-merges `main` into `develop`.

The back-merge uses `--no-ff`. Conflicts or branch-protection failures remain
blocking — the `sync-develop` job fails loudly, preserves both `main` and
`develop` exactly as they were, and never resets or force-pushes. Manual
recovery:

1. Create a recovery branch from `develop`: `git checkout -b recovery/back-merge-vX.Y.Z develop`.
2. Merge `main` into that recovery branch: `git merge --no-ff main`.
3. Resolve conflicts locally and run the standard test suite (`node tests/run-all.js`).
4. Open a PR from the recovery branch to `develop` and merge it through the
   normal human approval boundary.

Never resolve a failed back-merge by force-pushing `develop` or resetting
either branch.

Do not move, delete, or reuse a published tag. If the `consumer-verify` job
reports a CONSUMER verification failure (see the job summary), the published
tag and GitHub Release stay immutable regardless — do not delete, retag, or
edit them. Diagnose the failure and ship a new patch (or `hotfix/*`)
release; rollback for an already-updated consumer means reinstalling the
previous known-good immutable version and starting a fresh session.

The durable release evidence is the version, tag SHA, CI run, GitHub Release,
and back-merge result. Session-local reports may supplement that evidence but
are not themselves proof of publication.

## Consumer update boundary

Publishing does not update installed consumers automatically.

- Claude marketplace installation is the supported primary consumer path.
- `scripts/hooks/install-codex-skills.sh` is the supported Codex project sync
  path.
- Codex marketplace remains Experimental.
- Gemini and Antigravity remain Adapter-only.
- `claude --plugin-dir <path>` is Development-only and must not be used as
  proof that a published consumer version works.

For an installed Claude consumer, update the marketplace, reinstall when a
version pin prevents `install` from changing the cached version, and start a
fresh session. Verify Codex consumers with the supported install/update script
and its recorded version/fingerprint.

## Non-goals

This contract does not auto-merge pull requests, auto-reinstall consumers, add
new distribution surfaces, or promise native parity for adapter platforms.
