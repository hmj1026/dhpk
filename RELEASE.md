# Release process (git flow)

dhpk follows the **git flow** branching model. `develop` is a permanent
long-lived branch and is **never deleted**.

```
feature/*, fix/* ─┐
                  ├─(PR)─► develop ─(PR, release cut)─► main ─► tag vX.Y.Z ─► CI Release + auto back-merge ─► develop
                  ┘                                                                                              │
                                                                                                     new feature/* ◄┘
```

Landing work on `develop` and cutting a release are two **decoupled** activities:
branches merge into `develop` independently, whenever they're ready; a release
(`develop` → `main`) is a separate, deliberate action that can batch however many
branches have landed since the last one. It's fine to merge and then intentionally
defer the release.

## Branch rules

- **`main`** — the released line (acts as master). Only receives merges via PR.
- **`develop`** — permanent integration branch. Always kept in sync with `main`
  (the `sync-develop` CI job back-merges automatically after every release).
- **`feature/*`** — cut **from `develop`**, never from `main`. Use the git-flow
  CLI, not a manual `checkout -b` — manual branch creation has actually forked
  from `main` by mistake before, which then required a corrective merge to fix:

  ```bash
  git flow feature start <name>    # creates feature/<name> from develop
  git flow feature finish <name>   # merges back into develop, deletes the branch
  ```

- **`fix/*`** — dhpk's actual bug-fix branch, cut from `develop` and merged the
  same way as `feature/*` (no dedicated git-flow subcommand for this prefix —
  branch it manually the same way, just off `develop`):

  ```bash
  git checkout develop && git pull
  git checkout -b fix/<name>
  ```

- **`hotfix/*`** — git-flow's standard emergency-patch lane: branch from `main`
  for a critical fix that can't wait for `develop`, merge back into both `main`
  and `develop`. **Not used so far in this repo** — every real bug fix to date
  has gone through `fix/*` off `develop` instead. Keep this lane in mind only if
  a true emergency (prod broken, can't wait for a normal PR) ever comes up.
- **`release/*`** (historical, deprecated) — early releases used dedicated
  version-bump-only branches merged straight into `main`. This convention was
  abandoned; the version bump now happens directly on `develop` or inside the
  last branch landing before the release (see below).

## Landing work on `develop`

Each `feature/*`/`fix/*` branch merges into `develop` via its own PR as soon as
it's ready, independent of release timing. The PR must pass `.github/workflows/ci.yml`'s
`validate` job (`scripts/ci/validate-{agents,skills,commands,modules,plugin}.js
--strict`, `catalog.js --check`, and `node tests/run-all.js` — this is where
`tests/codex-plugin-manifest.test.js` actually runs, not in `release.yml`) plus
its non-blocking `lint` job.

**PR merges are always a manual human action.** An auto-mode classifier blocks
`gh pr merge` on any PR that Claude/an agent authored and pushed itself, even
under an explicit "execute through to release" instruction. Expect to prepare
commits/PR/tag and hand off the actual merge click to a human — this applies to
both the feature/fix→develop PR above and the develop→main release PR below.

## Cutting a release

A release is its own deliberate action: a PR from `develop` into `main`,
batching whatever has landed on `develop` since the last release.

1. Make sure `develop` has everything you want in this release (finish and
   merge any pending `feature/*`/`fix/*` branches first).
2. **Bump version** (semver) in `.claude-plugin/plugin.json` and, in lockstep,
   `.codex-plugin/plugin.json`, `plugins/dhpk/.codex-plugin/plugin.json`, and
   `.agents/plugins/marketplace.json` — `tests/codex-plugin-manifest.test.js`
   fails CI if any of these drift out of sync. This commit usually lands
   directly on `develop`.
3. **Write the changelog** — add a `## X.Y.Z — YYYY-MM-DD — <summary>` section at
   the top of `CHANGELOG.md`. The header format matters: the Release workflow
   extracts notes with `awk "/^## ${VERSION} /"`, so keep the space after the
   version number.
4. **Open a PR from `develop` into `main`** and merge it (squash or merge —
   both fine; a human merges it, per the note above).
5. **Tag `main`** and push the tag:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
6. **CI takes over** (`.github/workflows/release.yml`, triggered by `v*`):
   - `release` job — creates the GitHub Release from the CHANGELOG notes, or
     **updates it** if one already exists for that tag (an upsert). Don't
     manually run `gh release create` after pushing the tag — CI already
     handles it, and a manual create will 422 with "tag_name already exists".
     Use `gh release edit` if you need to fix the notes afterward.
   - `sync-develop` job — back-merges `main` into `develop` (`--no-ff`) and pushes,
     so `develop` never falls behind. **This is the step that used to be manual
     and got skipped.**

## After release — consumers

Consumers load dhpk from the plugin **cache**, not this repo directly. Making a
new version live for an installed consumer takes more than a pushed tag:

1. Check `known_marketplaces.json` for whether the marketplace source is a
   GitHub remote or a local directory — this affects whether push/tag matter
   for that consumer.
2. `claude plugin marketplace update dhpk` (or the equivalent) to fetch the new
   version into the cache.
3. **Known trap:** running `claude plugin install dhpk@dhpk@vX.Y.Z` when dhpk
   is already installed prints "already installed" and **no-ops** — it does
   NOT switch the pinned version in `installed_plugins.json`, even though the
   new version was fetched to cache. Fix: `claude plugin uninstall dhpk@dhpk
   && claude plugin install dhpk@dhpk@vX.Y.Z`.
4. Start a **fresh session** afterward — required even after a correct
   reinstall. Agent/skill definitions are snapshotted per session (or per
   cache version) and don't refresh mid-session.

For fast local iteration on in-progress source changes — no release needed —
use `claude --plugin-dir <path-to-this-repo>` instead. It reads the plugin
live from the working tree, bypassing install/cache/version-pin entirely (see
README.md § Development). This is for dev iteration only; it doesn't exercise
the real consumer install path above.

## If the automatic back-merge fails

The `sync-develop` job fails **loudly** on a merge conflict (it never silently
drops the back-merge). Resolve by hand:

```bash
git checkout develop && git pull
git merge --no-ff origin/main      # resolve conflicts
git push origin develop
```

Branch protection on `develop` can also block the CI push — in that case do the
back-merge via a PR from `main` into `develop`.
