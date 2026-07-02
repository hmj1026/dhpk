# Release process (git flow)

dhpk follows the **git flow** branching model. `develop` is a permanent
long-lived branch and is **never deleted**.

```
feature/* ─┐
           ├─► (PR) ─► main ─► tag vX.Y.Z ─► CI Release + auto back-merge ─► develop
hotfix/*  ─┘                                                                   │
                                                                  new feature/* ◄┘
```

## Branch rules

- **`main`** — the released line (acts as master). Only receives merges via PR.
- **`develop`** — permanent integration branch. Always kept in sync with `main`
  (the `sync-develop` CI job back-merges automatically after every release).
- **`feature/*`** — cut **from `develop`**, never from `main`.

```bash
git checkout develop && git pull
git checkout -b feature/<name>
```

## Cutting a release

1. **Branch** off `develop` (or finish your `feature/*`).
2. **Bump version** (semver) in `.claude-plugin/plugin.json` and, in lockstep,
   `.codex-plugin/plugin.json`, `plugins/dhpk/.codex-plugin/plugin.json`, and
   `.agents/plugins/marketplace.json` — `tests/codex-plugin-manifest.test.js`
   fails CI if any of these drift out of sync.
3. **Write the changelog** — add a `## X.Y.Z — YYYY-MM-DD — <summary>` section at
   the top of `CHANGELOG.md`. The header format matters: the Release workflow
   extracts notes with `awk "/^## ${VERSION} /"`, so keep the space after the
   version number.
4. **Open a PR into `main`** and merge it (squash or merge — both fine).
5. **Tag `main`** and push the tag:
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
6. **CI takes over** (`.github/workflows/release.yml`, triggered by `v*`):
   - `release` job — creates/updates the GitHub Release from the CHANGELOG notes.
   - `sync-develop` job — back-merges `main` into `develop` (`--no-ff`) and pushes,
     so `develop` never falls behind. **This is the step that used to be manual
     and got skipped.**

## After release — consumers

Consumers load dhpk from the plugin **cache**, not this repo. A pushed tag is not
enough; users must run `claude plugin update` to pick it up.

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
