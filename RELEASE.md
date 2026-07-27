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

## Release candidate preparation

1. Confirm that `develop` contains the intended changes and is up to date:

   ```bash
   git checkout develop
   git pull --ff-only
   ```

2. Confirm the worktree is clean before authoring the candidate. The only
   permitted release edits are the version manifests and `CHANGELOG.md`:

   - `.claude-plugin/plugin.json`
   - `.codex-plugin/plugin.json`
   - `plugins/dhpk/.codex-plugin/plugin.json`
   - `.agents/plugins/marketplace.json`
   - `CHANGELOG.md`

   All four manifests must contain the same SemVer version. The tag format is
   exactly `vX.Y.Z`.

3. Replace the top `## [Unreleased]` section with a non-empty heading in this
   format:

   ```markdown
   ## X.Y.Z — YYYY-MM-DD — summary
   ```

4. Run the release validation before creating the PR:

   ```bash
   bash scripts/validate/validate-harness.sh
   node scripts/ci/validate-agents.js --strict
   node scripts/ci/validate-skills.js --strict
   node scripts/ci/validate-commands.js --strict
   node scripts/ci/validate-modules.js --strict
   node scripts/ci/validate-plugin.js --strict
   node scripts/ci/catalog.js --check all
   node tests/run-all.js
   ```

   The release PR must pass the `validate` and Markdown `lint` jobs. The tag
   workflow does not replace pull-request validation.

5. Prepare the direct `develop` → `main` PR. Pass every intended release file
   explicitly; the runner rejects unrelated worktree changes and never stages
   the whole repository implicitly:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/skills/release-creator/scripts/release-runner.sh" \
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

After the human confirms that the release PR is merged, publish the tag:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/release-creator/scripts/release-runner.sh" \
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
is contained in `origin/main`, rejects missing or whitespace-only changelog
notes, and creates a GitHub Release from those notes. If the GitHub Release
already exists, a rerun preserves it rather than editing its metadata.

## Release completion and recovery

A release is complete only when all of these states hold:

1. the release PR is merged;
2. the immutable tag exists;
3. the Release workflow and GitHub Release succeed; and
4. the `sync-develop` job successfully back-merges `main` into `develop`.

The back-merge uses `--no-ff`. Conflicts or branch-protection failures remain
blocking; resolve them through a human PR from `main` to `develop`.

Do not move, delete, or reuse a published tag. If a release is defective,
rollback means reinstalling the previous known-good immutable version and
starting a fresh consumer session. A correction is a new patch release.

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
