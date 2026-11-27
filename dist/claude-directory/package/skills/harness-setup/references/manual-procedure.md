# Harness Setup — Manual Procedure

Use this fallback when `install-assets.sh` (not shipped in the Directory Plugin) or
`install-codex-project.sh` (not shipped in the Directory Plugin) is absent (such as in the instruction-only
Directory Plugin) or cannot execute. The result must match what the scripts
produce.

## Safety Rules

- Run this skill **only on an explicit user request**; stop and ask before any
  write if selected autonomously.
- Preserve existing settings, unknown JSON keys, user-owned `.codex/config.toml`,
  receipt entries, and unrelated dirty worktree files. Reject symlinks along any
  read or write path.
- Treat `--source-artifact <dir>` as data only — never infer an artifact from an
  ambient checkout or execute arbitrary code inside the artifact. If `--install`
  or Codex asset synchronization lacks an explicit `--source-artifact`, stop
  `BLOCKED` (`SOURCE_ARTIFACT_REQUIRED`). The artifact must be an existing
  physical directory with no symlink in its path.
- Keep `PASS`, `BLOCKED`, `UNAVAILABLE`, `NOT_CONFIGURED`, and `NOT_RUN`
  distinct. Never treat `--show` or `--dry-run` as an installation pass, and
  include `mode: manual` in every report.

## Stage: resolve-host-and-root

1. Identify the active Host from the invocation context (`Claude` vs `Codex`;
   stop `BLOCKED` `HOST_UNRESOLVED` if ambiguous, without inventing a `--host`
   flag).
2. Resolve the consumer project root with `git rev-parse --show-toplevel`,
   falling back to the current working directory outside a Git repository.

## Stage: inspect-or-show-config

1. Read [module-catalog.json](../data/module-catalog.json),
   [settings.local.example.json](../templates/settings.local.example.json),
   project `.claude/settings.local.json`, `~/.claude/settings.json`, and (on
   Codex) `.codex/.dhpk-installed.json` using `Read`.
2. If `--show` or `--dry-run` was supplied, print effective configuration layers
   (Project > Global > Environment; disclosing any unreadable file without
   claiming full config coverage) and stop cleanly with `mode: manual` and no
   writes.
3. Otherwise confirm planned changes with the operator before modifying any
   file. On Codex, reject `--profile` (retired; stop without writing). The
   Codex scripts have no `--install` option: `install-codex-project.sh`
   forwards it and the installer rejects it as an unknown argument. Do not
   accept or act on it.

## Stage: install-claude-assets

1. Require all of these, in this order; otherwise stop `BLOCKED`:
   - `--source-artifact <dir>`: if missing, `SOURCE_ARTIFACT_REQUIRED`. Point the
     operator to the Full Plugin or a checkout artifact.
   - `--target <dir>`: if missing, `SOURCE_ARTIFACT_INVALID`.
   - `--install` is exactly `hooks`, `rules`, `scripts`, or `all`; any other
     value is `SOURCE_ARTIFACT_INVALID`.
   - The artifact is an existing physical directory (not a symlink, no symlink
     in its path); otherwise `SOURCE_ARTIFACT_INVALID`.
2. Validate the payload for the selected group; a missing item is
   `SOURCE_ARTIFACT_INVALID` and nothing is written:
   - `hooks`: `hooks/hooks.json` is a regular file (not a symlink) and
     `hooks/` is a directory.
   - `rules`: `rules/` is a directory.
   - `scripts`: `scripts/`, `skills/precommit/scripts/`, and
     `skills/repo-verify/scripts/` are directories.
   - `all`: every check above.
   For `scripts` and `all`, also require `skills/<skill>/scripts/<runner>` and
   `runner-utils.js` (not shipped in the Directory Plugin) to exist as physical files, for
   `precommit` (`precommit-runner.js`) and `repo-verify` (`verify-runner.js`).
   The script reports a missing runner or `runner-utils.js` (writer exit 66) or
   an unsafe symlinked one (writer exit 4) as `BLOCKED` `WRITER_FAILED`, not
   `SOURCE_ARTIFACT_INVALID`. Report conflicts (exit 3) and `--vendor` misuse
   (exit 64) the same way. Write nothing.
3. Install into `--target` (normally `<project>/.claude/dhpk`). Copy only
   regular files, never follow a symlink, and keep each source file's mode. Skip
   `precommit-runner.js`, `verify-runner.js`, and `harness-audit.js` directly
   under `<target>/scripts`, and stop on a file that already exists at one of
   those paths (legacy conflict). `--force` cannot override a legacy conflict;
   the operator must review and remove or relocate the file, then re-run.
   Compare each other destination with its source (and consult
   `<target>/.dhpk-asset-receipt.json` when present): identical files are
   skipped; unchanged receipt-owned files from an earlier snapshot are
   updatable; `user-modified` or `unmanaged-existing` differing files are
   conflicts that stop the install with exit 3 (while byte-identical files are
   adopted into the receipt) unless the operator confirmed `--force`, which first
   saves differing files under `<target>/.dhpk-asset-backups/<UTC timestamp>/`.
   Executable bits are retained, and any symlink component fails closed even
   with `--force`.
   - `hooks` copies `hooks/` and `hooks/`.
   - `scripts` copies `scripts/`, `skills/precommit/scripts/`, and
     `skills/repo-verify/scripts/`.
   - `rules` and `all` (without `--vendor`) write the project-delta stub at
     `<parent-of-target>/rules/dhpk-overrides.md` (for example
     `.claude/rules/dhpk-overrides.md`), never inside `<target>/rules`. Content:
     ```markdown
     # dhpk execution-policy overrides

     Canonical source: the plugin runtime `rules/` directory
     (`${CLAUDE_PLUGIN_ROOT}/rules/`). Do not vendor a local copy of those files.

     This file is the consumer delta. Keep only project-specific extensions.

     ## Project deltas

     ### Extra reviewer trigger paths

     ### Hot tables

     ### Hook profile
     ```
     An existing `<target>/rules` tree from an older install is preserved, not
     deleted; report it.
   - `--vendor` is valid only with `rules` or `all`; it copies `rules/` to
     `<target>/rules` instead of writing the stub. Warn that it is discouraged
     and drifts.
4. `--dry-run` lists each planned `COPY`, `OVERWRITE`, or `SKIP` and writes
   nothing; it is not an installation pass.

## Stage: install-codex-project

1. When operating on the Codex host, require an explicit `--source-artifact
   <dir>`; if missing, stop `BLOCKED` `SOURCE_ARTIFACT_REQUIRED`. The artifact
   must be an existing physical directory containing `codex/`; otherwise stop
   `BLOCKED` `SOURCE_ARTIFACT_INVALID`.
2. Reject any symlink anywhere inside the artifact tree (for example, search it
   for symlinks) before touching `.codex/`; one symlink is
   `SOURCE_ARTIFACT_INVALID` and nothing is written.
3. Read `<source-artifact>/manifests/distribution-inventory.json` as data. Never
   overwrite `.codex/config.toml`. Place the supporting assets the inventory
   declares (including `config.toml.example` when declared) beside it, and never
   replace an unowned same-name file.
4. If the full CLI installer is absent, inspect `.codex/.dhpk-installed.json`
   (schema v3) and record exact planned skill/agent/supporting-asset changes
   with `--plan`-equivalent safety: preserve unowned files and edited targets,
   never purge `.codex`, and record any missing installer capability as
   `UNAVAILABLE` or `NOT_RUN` rather than guessing receipt hashes.

## Stage: verify-setup-receipt

1. Re-read the updated `.claude/settings.local.json`, `.claude/rules/dhpk-overrides.md`,
   or `.codex/.dhpk-installed.json` receipt with `Read` to confirm the written
   structure and preserved keys.
2. Emit the Host-appropriate setup report with `mode: manual`, exact changed
   paths, preserved conflicts, explicit terminal verdict (`PASS`, `BLOCKED`,
   `UNAVAILABLE`, `NOT_CONFIGURED`, or `NOT_RUN`), and the `.scratch/`
   `.gitignore` reminder if handoffs are used.
