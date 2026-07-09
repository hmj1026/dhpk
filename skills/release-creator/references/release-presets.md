# Release presets — per-ecosystem defaults

Loaded on demand from SKILL.md Step 0 when a project has **no** root `RELEASE.md`.
Probe the repo for the manifest, then use that row to fill the Step 0 tokens.
Always confirm the resolved values with the user before executing.

Probe in this order; **first match wins**. The `claude-plugin` probe is listed
before `node` on purpose — plugin repos almost always also ship a `package.json`,
so checking the more specific manifest first avoids misclassifying a multi-manifest
plugin as a single-file node project.

| Ecosystem | Probe (first match wins) | `{VERSION_FILES}` | `{VALIDATE_CMD}` | Tag |
|-----------|--------------------------|-------------------|------------------|-----|
| claude-plugin | `.claude-plugin/plugin.json` | all plugin manifests, **lockstep** (see below) | the plugin's own validators / test runner | `v<version>` |
| node | `package.json` (no `composer.json`, no `.claude-plugin/`) | `package.json` (`"version"`) | `npm test` (or the project's `test`/`release` script) | `v<version>` |
| php | `composer.json` | `composer.json` (`"version"`, if declared) | `composer test` (or `vendor/bin/phpunit`) | `v<version>` |
| python | `pyproject.toml` / `setup.py` | `pyproject.toml` (`project.version`) | `pytest` (or `tox`) | `v<version>` |
| rust | `Cargo.toml` | `Cargo.toml` (`package.version`) | `cargo test` | `v<version>` |
| generic | none of the above | ask the user which file holds the version | ask the user; else skip | `v<version>` |

## Branch model

- **Trunk-based (default):** `{BASE_BRANCH}` = `{RELEASE_BRANCH}` = `main`. Bump on
  `main`, tag, push. No release PR needed.
- **git-flow:** `{BASE_BRANCH}` = `develop`, `{RELEASE_BRANCH}` = `main`. Bump lands
  on `develop`; a `develop → main` PR cuts the release; tag on `main`; CI back-merges
  to `develop`. Detect by the presence of a long-lived `develop` branch (or a
  `RELEASE.md` that documents it).

## Multi-manifest lockstep (claude-plugin and similar)

Some projects carry the same version in several manifests that a CI drift-check
keeps in sync (e.g. a Claude Code plugin publishing to multiple platforms). When
`{VERSION_FILES}` has more than one entry, bump **every** entry to the identical
`<version>` in the same commit — a single drifted file fails CI. The project's own
`RELEASE.md` is the authoritative list of which files participate; prefer it over
this table when present.
