# Platform installation

> **Languages**: **English** · [繁體中文](./platform-installation.zh-TW.md)

## Scope and runtime evidence (#848/#854)

Installation acceptance covers the selected format, resources, configuration,
ownership and lifecycle checks. Native runtime evidence is required only for a
selected integration change, activation defect, or explicit native request.
The named-role canary and registry diagnostics remain available for those
cases; an unavailable or failing required check remains non-passing. Skills-only
installation does not imply blanket Host runtime proof.

This is the installation and support-status SSOT for dhpk distribution
surfaces. A package or manifest is structural evidence only; a client is
callable only after the named consumer probe discovers the projected content.

<a id="surface-matrix"></a>

## Surface matrix

| Surface | Install | Update / remove | Verify | Support boundary |
|---|---|---|---|---|
| Claude Code Full Plugin (Repository Marketplace) | `/plugin marketplace add hmj1026/dhpk`, then `/plugin install dhpk@dhpk` (from a checkout: `bash scripts/install.sh`) | `/plugin marketplace update dhpk`, then `/reload-plugins`; remove with `/plugin uninstall dhpk@dhpk` | Fresh-session `/dhpk:flow-guide help`; `dhpk-install claude status --strict` | Structural checks can pass; consumer discovery stays `NOT_RUN` until observed |
| Claude Code stack modules | `/plugin install dhpk-stacks@dhpk` (requires Full Plugin `dhpk`) | Same as above; `modules` lives in this plugin's settings | Fresh-session `/dhpk:harness-setup --show` | Stack skills and modules only; no module is active until `modules` selects it |
| Claude Code Directory Plugin (`dhpk-lite`, instruction-only) | Official Claude Plugin Directory (`dist/claude-directory/package`); mutually exclusive with Full Plugin `dhpk` | Disable/uninstall `dhpk-lite` via `/plugin uninstall dhpk-lite` before installing `dhpk@dhpk` | Fresh-session `/dhpk-lite:flow-drive` | Instruction-only (`/dhpk-lite:<skill>`); ships all 17 catalog skills (6 via Manual Procedures in `mode: manual`) and 29 agents; omits hooks, scripts, `userConfig`, `agents/INDEX.md`, and external CLI agents |
| Codex project-local sync | From a checkout: `bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh` or `dhpk-install codex-sync install --project-root <dir>` (data source: `DHPK_INSTALLER_ROOT`, never `CLAUDE_PLUGIN_ROOT`). Sync requires a repository checkout; an installed Claude plugin does not include `codex/` | `--update`, `--migrate`, `--uninstall` (or `dhpk-install codex-sync update\|uninstall --project-root <dir>`); `--force` only bypasses the project-root heuristic | `.codex/.dhpk-installed.json` schema-v3, `.agents/skills/` direct discovery, `$dhpk-<name>` / `$change-verdict` discovery, `dhpk-install codex-sync status` | Supported Codex path and canonical daily-use route; install does not prove runtime callability |
| Codex Public Plugin (native) | `codex plugin marketplace add <repo-or-path>` then `codex plugin add dhpk@dhpk` where the real CLI supports it | Client marketplace commands; regenerate from source and check provenance | `plugins/dhpk/.codex-plugin/plugin.json`, physical `skills/`, provenance/fingerprints, real CLI probe, `dhpk-install codex-native status` | Experimental; test only in a disposable isolated `CODEX_HOME`; missing CLI/route is `UNAVAILABLE` or `BLOCKED` |
| OpenAI Public Plugin Directory (Codex and ChatGPT Work) | Search for DHPK in the product's Plugins Directory after the public listing appears | Use that product's plugin manager | Approved public listing and a fresh-session workflow probe per Host | Candidate only; currently `NOT_PUBLISHED`; local/repository marketplaces are development sources |
| Standard Agent Plugin | Download `dhpk-agent-<version>.tar.gz` from the GitHub Release, or run `bin/dhpk distribution build agent-plugin`; install `dist/on-demand/dhpk-agent/` through a verified client route | Client-owned update/remove; replace only the generated package | Root `plugin.json`, Agent Plugins schema, fixed `skills/`, optional `mcp.json`, provenance, `dhpk-install agent-plugin status` | Structural conformance is not Codex runtime proof |
| Cursor standard Agent Plugin | Cursor Customize/Plugins, or local `~/.cursor/plugins/local/dhpk-agent` | Cursor reload/update/remove or replace that local package | Root `plugin.json`, discovered portable skills/MCP, client version | Portable skills/MCP only; no Cursor-native parity claim |
| Cursor Plugin | Download `dhpk-cursor-<version>.tar.gz` from the GitHub Release, or run `bin/dhpk distribution build cursor-plugin`; copy to `~/.cursor/plugins/local/dhpk-cursor` and install `dhpk-agent` alongside it for shared portable skills | Cursor refresh/update/remove; rollback Cursor-owned files only; update the shared Agent package separately | `.cursor-plugin/plugin.json`, rules, agents, commands, hooks, variables, shared-skill IDs | Native components require Cursor evidence; shared portable skills are owned by `dhpk-agent`; gaps are `SKIP_INCOMPATIBLE` |
| Cursor project-local sync | From a checkout: `bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh` or `dhpk-install cursor install --project-root <dir>` (data source: `DHPK_INSTALLER_ROOT`, never `CLAUDE_PLUGIN_ROOT`). Sync requires a repository checkout; an installed Claude plugin does not include `cursor/` | `--update`, `--migrate`, `--uninstall` (or `dhpk-install cursor update\|uninstall --project-root <dir>`); `--force` only bypasses the project-root heuristic | `.cursor/.dhpk-installed.json` schema-v3, `.mdc` rules, managed entries, `dhpk-install cursor status` | Supported Cursor project-local path; native hooks are out of v1; install does not prove runtime callability |
| Cursor CLI launch-scoped probe | `cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package>` after login | No persistent CLI install; update the source package or local symlink, then start a new session | `cursor-agent --version`, `cursor-agent status`, and a read-only `--mode ask` probe | Experimental/conditional: CLI help exposes the flag, but official CLI docs do not establish plugin component discovery; release probes use an isolated shared-network bubblewrap namespace, never unrestricted execution |
| AGY native plugin | Download `dhpk-agy-<version>.tar.gz` from the GitHub Release, or run `bin/dhpk distribution build agy-plugin`, then receipt-owned install to the inventory-owned canonical path `~/.gemini/antigravity-cli/plugins/dhpk/` | `install-agy-plugin.js update`, explicit `migrate`, `uninstall`, or `rollback`; foreign files are preserved and collisions fail closed | AGY package validator; `agy plugins list` is import-only; isolated `agy agents` is native load; `dhpk-install agy-plugin status`; optional bounded Subagent probe | Experimental: package/discovery evidence is separate from runtime; absent `agy` is `UNAVAILABLE` |

<a id="cross-host-installation-matrix"></a>

## Cross-Host installation and verification matrix

Use this matrix as the single linkable entry index for Host entrypoints, explicit installer data-source selection, migration/recovery boundaries, and verification commands.

| Host / surface | Canonical entrypoint(s) | Data-source selector (ADR-0038) | Migration & ownership notes | Verification commands |
|---|---|---|---|---|
| Claude Code (`claude`) | `/plugin install dhpk@dhpk`, `/plugin install dhpk-stacks@dhpk`, `bash scripts/install.sh`, `scripts/setup/install-assets.sh` (or Skill-local `skills/harness-setup/scripts/install-assets.sh`) | Owning plugin/package root (`dhpk_plugin_root` / `package-root.js`); `install-assets.sh` uses `--source <dir>` / `--source-artifact <dir>` | Never enable `dhpk@dhpk` and `dhpk-lite` together; project assets use standalone Asset Receipt `.claude/dhpk/.dhpk-asset-receipt.json` (`dhpk.asset-receipt.v1`) | `dhpk-install claude status --project-root <dir> --strict --json`, `node scripts/ci/check-duplicate-discovery.js --host claude --project-root <dir>`, `claude plugin validate /path/to/dhpk --strict` |
| Claude Code Directory (`dhpk-lite`) | Official Claude Plugin Directory (`dist/claude-directory/package`) | Self-contained reduced package (`mode: manual` for script-backed skills) | Uninstall `dhpk-lite` before installing `dhpk@dhpk` | `npm run validate:directory-plugin`, fresh-session `/dhpk-lite:flow-drive` |
| Codex project-local sync (`codex-sync`) | `bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh` or `dhpk-install codex-sync <plan\|install\|update\|uninstall> --project-root <dir>` | `DHPK_INSTALLER_ROOT` (never `CLAUDE_PLUGIN_ROOT`); executable code always loads from the installer's own package | Direct `.agents/skills/` discovery ([ADR-0042](adr/0042-codex-direct-shared-projection-discovery.md)); `--update` retires unchanged `.codex/skills/<name>` links; blocked if native `dhpk@dhpk` is enabled | `dhpk-install codex-sync status --project-root <dir> --strict`, `bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh --update --plan --json`, `node scripts/ci/check-duplicate-discovery.js --host codex --project-root <dir>` |
| Codex Public Plugin (`codex-native`) | `codex plugin marketplace add <repo-or-path>` + `codex plugin add dhpk@dhpk` | Physical `plugins/dhpk/` package (zero symlinks) | Experimental; disposable isolated `CODEX_HOME` only; mutually exclusive with `codex-sync` | `bin/dhpk distribution codex-native verify --json`, `dhpk-install codex-native status --strict`, `node tests/codex-native-install-smoke.test.js` |
| Cursor project-local sync (`cursor`) | `bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh` or `dhpk-install cursor <plan\|install\|update\|uninstall> --project-root <dir>` | `DHPK_INSTALLER_ROOT` (never `CLAUDE_PLUGIN_ROOT`); executable code always loads from the installer's own package | Schema-v3 `.cursor/.dhpk-installed.json` + shared `.agents/.dhpk-installed.json`; retains Consumer Evidence gate ([ADR-0023](adr/0023-native-installers-delegate-skills-to-the-shared-projection.md)) | `dhpk-install cursor status --project-root <dir> --strict`, `bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh --update --plan --json`, `node scripts/ci/validate-cursor-sync.js` |
| Cursor / Standard Agent Plugin (`agent-plugin`, `cursor-plugin`) | `bin/dhpk distribution build agent-plugin` / `cursor-plugin` -> `~/.cursor/plugins/local/dhpk-{agent,cursor}` | Built on-demand archive or `dist/on-demand/dhpk-{agent,cursor}` | Portable skills owned by `dhpk-agent`; Cursor UI marketplace hash cache (`~/.cursor/plugins/cache/dhpk/`) is not SSOT (`CACHE_DRIFT`) | `bin/dhpk distribution agent-plugin validate --json`, `bin/dhpk distribution cursor-plugin validate --json`, `dhpk-install agent-plugin status --strict` |
| AGY native plugin (`agy-plugin`) | `bin/dhpk distribution build agy-plugin` + `node scripts/ci/install-agy-plugin.js install --source dist/on-demand/dhpk-agy --json` | `--source <package>` (built archive or staging dir); canonical target `~/.gemini/antigravity-cli/plugins/dhpk/` | Legacy `$HOME/.gemini/config/plugins/dhpk/` requires explicit `install-agy-plugin.js migrate`; `FOREIGN_CHECKOUT` and `AMBIGUOUS_TARGETS` fail closed | `bin/dhpk distribution agy-plugin validate --json`, `node scripts/ci/install-agy-plugin.js status --json`, `dhpk-install agy-plugin status --strict` |
| Cross-Host diagnostics & recovery | `dhpk-install status --all`, `dhpk-install --recover`, `node scripts/ci/check-duplicate-discovery.js`, `node scripts/release/release-rehearsal.js` | Owning checkout/package root (`scripts/lib/package-root.js`); Install History uses `DHPK_INSTALL_HISTORY_FILE` / `XDG_STATE_HOME` | Never pass bare `codex` to `dhpk-install` (exit 64); use `codex-sync` or `codex-native` | `dhpk-install status --all --project-root <dir> --strict --json`, `node scripts/ci/check-duplicate-discovery.js --project-root <dir>` |

<a id="dhpk-installer-root-contract"></a>

### Data-source selection contract (`DHPK_INSTALLER_ROOT`, ADR-0038)

Per [ADR-0038](adr/0038-resolve-runtime-resources-from-the-owning-package.md), runtime executable code and installer payload data have a strict boundary:

- **Executable code root**: Bash scripts (`dhpk_plugin_root` / `$HERE`) and Node.js modules (`scripts/lib/package-root.js` `resolveOwningPackageRoot`) always resolve executable code from their own physical owning package. They **never** read or inject `CLAUDE_PLUGIN_ROOT` to select runtime scripts or installer logic.
- **Explicit installer data-source selector (`DHPK_INSTALLER_ROOT`)**: `scripts/hooks/install-codex-skills.sh`, `scripts/hooks/install-cursor-harness.sh`, and `scripts/lib/install-adapters/codex-cli.js` accept `DHPK_INSTALLER_ROOT` as the sole explicit override for payload data (`codex/`, `cursor/`, `manifests/`, `skills/`). `CLAUDE_PLUGIN_ROOT` **never** selects a Codex or Cursor installer data source.
- **Fail-closed invalid source**: If `DHPK_INSTALLER_ROOT` is set to a missing, relative-via-`CDPATH`, or incomplete directory (for example, lacking `codex/` or `cursor/`), installation stops immediately with zero fallback search and zero target writes.
- **Checkout validator variable (`DHPK_ROOT`)**: When running repository validators or tests outside a consumer project (`scripts/ci/...`, `tests/...`), `DHPK_ROOT=/absolute/path/to/dhpk` is only a shell variable in maintainer commands; it is not read by the Codex/Cursor installers (`DHPK_INSTALLER_ROOT` is).

Codex users who need only Flow Drive can install the complete pinned canonical
skill into the current project. Follow the [standalone Flow Drive guide](./flow-drive-standalone.md)
for installation, explicit update and removal, and the managed-install switch.

## Prerequisites and version assumptions

The route sections below use the corresponding row. This repository records
package and schema versions. The Codex CLI minimum is 0.159.0, derived from the
`gpt-6.1-terra` model requirement and not run on 0.159.0 itself (dhpk was
probed on 0.166.0 on 2026-11-01); other consumer-client minimums are not
verified. Release evidence must record the actual client version and probe
result; do not infer a runtime `PASS` from a package check.

| Route | Client/version assumption | OS and shell assumption | Required tooling | Evidence gate |
|---|---|---|---|---|
| Claude Code | Marketplace/plugin support; minimum version not established | Client-supported OS and POSIX shell | `bash`, `python3`, Claude Code | Run the marketplace install or the installer and observe the selected package in a fresh session |
| Codex project-local sync | Codex project-local loader; schema-v3 receipt; minimum Codex CLI 0.159.0 (roles use `gpt-6.1-terra`, which requires 0.159.0+; probed on 0.166.0, 2026-11-01) | Linux, macOS, or WSL with a POSIX shell, run from the project root | `bash`, `git`, Node.js (the Codex installer runs on Node.js) | Run the installer, inspect `.codex/.dhpk-installed.json`, and run the listed metadata/test commands |
| Codex Public Plugin (native) | Codex CLI with marketplace/plugin commands; run `codex --version`; minimum Codex CLI 0.159.0 (roles use `gpt-6.1-terra`, which requires 0.159.0+; probed on 0.166.0, 2026-11-01) | Linux, macOS, or WSL shell for the documented route; use a disposable isolated `CODEX_HOME` | `codex`, marketplace access, `git` | Execute the marketplace route and record CLI output; absent CLI/route is `UNAVAILABLE` or `BLOCKED` |
| OpenAI Public Plugin Directory | Codex or ChatGPT Work with the public plugin manager; minimum client version not established | Product-supported client or web surface | Published DHPK listing and account access | `NOT_PUBLISHED` until the approved listing is visible; record client version and fresh-session discovery separately |
| Standard Agent Plugin | Agent Plugins 1.0.0 schema consumer; minimum client version not established | Client-supported OS; package validation is performed from a POSIX shell | A verified Agent Plugin loader; Node.js for structural validation | Run both package commands, then record client discovery evidence |
| Cursor standard Agent Plugin | Cursor desktop/plugin loader that accepts the portable package; record Cursor version; minimum version not established | A Cursor-supported desktop OS; local path is `~/.cursor/plugins/local/` | Cursor Customize → Plugins or its local loader; Node.js for validation only | Observe discovered skills/MCP after reload; no loader is `UNAVAILABLE` or `BLOCKED` |
| Cursor Plugin (native) | Cursor plugin loader supporting `.cursor-plugin/plugin.json`; record Cursor version; install the standard `dhpk-agent` package for shared portable skills; minimum version not established | A Cursor-supported desktop OS; local path is `~/.cursor/plugins/local/` | Cursor reload/UI, local filesystem, and secret-free variable configuration; compare shared IDs with Agent provenance | Observe each selected native component and hook behavior after reload; an explicit matrix overlay is the only reason for a Cursor `skills/` directory |
| Cursor project-local sync | Cursor project-local loader; schema-v3 receipt; minimum Cursor version not established | Linux, macOS, or WSL with a POSIX shell, run from the project root | `bash`, `git`, Node.js (the Cursor installer runs on Node.js) | Run the installer, inspect `.cursor/.dhpk-installed.json`, and run the listed installer test; do not treat a missing live Cursor client as a runtime `PASS` |
| Cursor CLI launch-scoped probe | `cursor-agent` available on `PATH`; record `cursor-agent --version`; authenticate with `cursor-agent login`; minimum version not established | Linux, macOS, or WSL POSIX shell | `cursor-agent`, `--plugin-dir`, a logged-in Cursor session, and verified bubblewrap on Linux; Node.js only for package validation | Experimental/conditional: run `cursor-agent status`, then a read-only probe; unauthenticated output is `BLOCKED`, missing CLI/sandbox is `UNAVAILABLE`/`BLOCKED`, and discovery must be recorded separately; API-key-only auth is not accepted |
| AGY native plugin | `agy` version and supported AGY model/tool enum are not pinned; record `agy --version` when available; AGY 1.2.2 has been observed loading the canonical path | Linux, macOS, or WSL POSIX shell; install root is user-scoped | Node.js, `git`, generated package, and optional `agy` CLI | Run structural validation first; `agy plugins list` is import-only and isolated `agy agents` is native load; runtime remains `NOT_RUN` without an applicable explicitly requested native probe |

The Claude Bash gate requires `python3`; if it is unavailable, the gate blocks with
exit 2. See [credential read protection](./hook-extension.md#credential-read-protection)
for its scope and controlled extraction.

## Status vocabulary

- `PASS`: applicable evidence was executed and verified.
- `FAIL`: an applicable check failed.
- `NOT_RUN`: planned evidence was not executed.
- `NOT_CONFIGURED`: the surface was not selected and no marker is present.
- `SKIP_INCOMPATIBLE`: a named capability has no supported representation and
  its fallback is recorded.
- `BLOCKED`: explicitly requested, but a prerequisite or route is absent.
- `UNAVAILABLE`: the required client/tooling is not installed or exposed.

Never turn a static manifest, marketplace entry, generated file, or enabled
flag into a runtime `PASS`.

## DHPK Change Verdict discovery and invocation

The DHPK review capability keeps the stable public name `change-verdict` and
capability ID `dhpk.skill.change-verdict`. Hosts that support a display label
may show it as **DHPK Change Verdict**; the label is not a second skill or an
alias.

| Host route | Discovery and selection | Public invocation |
|---|---|---|
| Claude Code | After install/update, start a fresh session and select the DHPK plugin skill shown as `DHPK Change Verdict` | `/dhpk:change-verdict --mode code` |
| Codex project-local sync | After `install-codex-skills.sh` or `--update`, select the one discovered `DHPK Change Verdict` row; verify its stable name is `change-verdict` | `$change-verdict --mode=code` |
| Codex Public Plugin | After the approved public listing is available, select the discovered `DHPK Change Verdict` row in a fresh session; this route is currently `NOT_PUBLISHED` | `$change-verdict --mode=code` |
| Cursor project-local sync | After `install-cursor-harness.sh` or `--update`, choose the discovered `change-verdict` skill in Cursor's skill chooser; do not rename the `.cursor/skills/change-verdict/` directory | Invoke the selected `change-verdict` skill using Cursor's documented skill UI/entrypoint |

Record discovery and invocation separately. A package, receipt, or selected
row is discovery evidence only; an unexecuted invocation remains `NOT_RUN`, and
an absent Host capability is `UNAVAILABLE`.

## Claude Code installation paths

DHPK offers two Claude Code distributions. Install **one** of them (never enable both `dhpk` and `dhpk-lite` simultaneously because their skills and agents overlap):

1. **Full Plugin (`dhpk`, Repository Marketplace — recommended for local development):** includes runtime hooks, guardrails, helper scripts, `userConfig`, stack modules (`dhpk-stacks`), and `/dhpk:<skill>` commands.
2. **Directory Plugin (`dhpk-lite`, Official Claude Plugin Directory — instruction-only):** ships all 17 catalog skills and 29 agents, omitting hooks, scripts, `manifests/`, `userConfig`, `agents/INDEX.md`, and the 3 external-CLI agents (`codex-worker`, `codex-reasoner`, `agy-worker`). The 6 script-backed skills (`flow-guide`, `git-smart-commit`, `harness-setup`, `precommit`, `release-creator`, `opsx-apply-resume`) run via their `references/manual-procedure.md` workflows (`mode: manual`), and `skill-next-map.json` lives at the package root for pure-instruction routing under `/dhpk-lite:<skill>`. To upgrade from `dhpk-lite` to the Full Plugin, run `/plugin uninstall dhpk-lite` first, then follow the marketplace instructions below.

## Claude Code marketplace installation (recommended)

Install from the marketplace inside Claude Code:

```text
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk@dhpk
```

Stack modules and the stack skills (`swift`, `php`, `laravel`, `yii1`,
`js-static-checks`, `python`, `react`, `nextjs`) ship in a second plugin that
requires `dhpk`. Install it only when the project uses a stack, then select
modules in its `modules` setting:

```text
/plugin install dhpk-stacks@dhpk
```

The plugins ship skills and agents with no `commands/` directory: call a skill
as `/dhpk:<skill-name>`, for example `/dhpk:repo-verify` or `/dhpk:harness-setup`.
The BREAKING changelog entries map each removed command name to its skill.

From a checkout, preview and then run the installer:

```bash
bash scripts/install.sh --dry-run
bash scripts/install.sh
```

For scripted or CI use, the installer also accepts non-interactive flags
(the `claude` CLI is required):

```bash
bash scripts/install.sh --dry-run --non-interactive
bash scripts/install.sh --non-interactive --yes
```

`--non-interactive` skips every prompt and cannot install without `--yes`;
`--hook-profile minimal|standard|strict` selects the hook profile (default
`standard`).

`dhpk@dhpk` publishes the shared catalog's 15 common entries and required Host runtime/reference content. Start a fresh Claude session and run `/dhpk:flow-guide help`; runtime evidence remains `NOT_RUN` until observed. The installer does not create a separate common variant.

### Migrate a marketplace that points at `generated/`

A local marketplace added from an earlier checkout may still point at
`generated/claude-marketplace/package`. The committed directory is now `dist/`.
Refresh the marketplace, then reload or reinstall:

```text
/plugin marketplace update dhpk
/reload-plugins
```

If the plugin still loads from the old path, reinstall it:

```text
/plugin uninstall dhpk@dhpk
/plugin install dhpk@dhpk
```

If the marketplace was added from a local path whose checkout predates the
rename, run `/plugin marketplace remove dhpk` and add it again.

Maintainers may generate one optional capability for development inspection:

```bash
node scripts/ci/gen-claude-profile-bundles.js --standalone <stable-id> --out /tmp/dhpk-standalone
```

Generic `dhpk-install` writes remain `BLOCKED` / `NOT_IMPLEMENTED`; use the
host-specific adapters below. Roll back to the package identity in the previous
receipt or a version-pinned compatibility package. Rollback restores no alias.

<a id="claude-asset-installer"></a>

### Claude project asset installer and standalone Asset Receipt

For copying selected Claude project assets (`hooks`, `rules`, `scripts`, or
`all`) into `<project>/.claude/dhpk`, use `scripts/setup/install-assets.sh` (or
the Skill-local wrapper `skills/harness-setup/scripts/install-assets.sh` via
`/dhpk:harness-setup --source-artifact <dir> --install <group>`):

```bash
bash scripts/setup/install-assets.sh \
  --source /path/to/dhpk \
  --target /path/to/project/.claude/dhpk \
  --install all --plan --json
```

`TARGET/.dhpk-asset-receipt.json` (`schema: dhpk.asset-receipt.v1`) is the
standalone **Asset Receipt** (independent of the multi-Host Projection Journal).
Each destination is classified as:

- `updatable`: absent, or unchanged since the Asset Receipt recorded its SHA-256
  digest (auto-updated without `--force`).
- `unchanged`: byte-identical to the new source (skipped, and adopted into the
  receipt even if another conflict stops the run).
- `user-modified`: receipt-owned, but edited since the receipt recorded it.
- `unmanaged-existing`: not in the Asset Receipt and differs from the source.

`--plan --json` emits `schema: dhpk.asset-plan.v1` (`verdict: READY | CONFLICT | BLOCKED`)
without writing. `user-modified` and `unmanaged-existing` conflicts stop with
exit `3` unless `--force` is supplied, in which case differing files are first
saved under `TARGET/.dhpk-asset-backups/<UTC timestamp>/` before overwrite.
Symlinks in any path component fail closed (exit `4`) even with `--force`;
unowned legacy runners (`precommit-runner.js`, `verify-runner.js`,
`harness-audit.js` under `TARGET/scripts/`) stop with exit `3`
(`LEGACY_RUNNER_CONFLICT`) and are never overwritten by `--force`. Missing
`python3` descriptor capabilities exit `2` before mutation (plain-text
`--dry-run` remains available without `python3`). Default `--install rules` /
`--install all` writes `<parent-of-TARGET>/rules/dhpk-overrides.md` instead of
copying upstream policy (`--vendor` restores the discouraged verbatim copy).

## Controlled authenticated runner preflight

Issue #237 release evidence starts on a clean checkout of the exact merged
commit. Run the bounded preflight before any consumer probe:

```bash
node scripts/release/consumer-runtime-preflight.js \
  --root /absolute/path/to/dhpk \
  --task-id issue-237-runtime \
  --attempt-id attempt-<unique> --json
```

The command records only task/attempt, source and target commit/tree, clean
worktree state, selected surfaces, tool versions, sandbox/network status, and
allowlisted session file names/counts. It never records token values, OAuth
payloads, cookies, private paths, or arbitrary HOME files. `PASS` means the
runner is ready; it is not consumer-runtime proof. A missing client or
`bwrap` is `UNAVAILABLE`, a missing allowlisted login is `BLOCKED`, and a
foreign/stale identity is `BLOCKED` with `IDENTITY_INVALID` or
`FOREIGN_PREFLIGHT`.

Provision the runner with a disposable workspace and an explicit session
source (`DHPK_CURSOR_HOST_HOME` or `DHPK_AGY_HOST_HOME`). Refresh the session
through the provider's login flow before the run; do not copy a developer HOME
or place credentials in command arguments, logs, or receipts. Cursor and AGY
probes keep the package read-only, use a disposable HOME, and require the
controlled bubblewrap namespace. AGY runtime uses `--unshare-all` before
`--share-net`; DNS/proxy failures are reported as `DNS_UNAVAILABLE` or
`TRANSPORT_UNAVAILABLE`, and bounded timeout output remains non-PASS.

The supervised sequence is: preflight the exact tree, deploy that same tree,
run all seven identity rows, verify the six required-runtime rows, and retain
the receipt. On failure, preserve the receipt, remove only receipt-owned
temporary files, revoke/refresh the session through the provider, and roll
back the deployment before retrying. Never reuse a dirty checkout or promote
preflight `PASS` to `COMPLETE`.

<a id="unified-lifecycle-cli"></a>

## Unified lifecycle CLI

`dhpk-install <surface> <action>` is the common lifecycle entrypoint (with
`dhpk-install status --all` and `dhpk-install --recover` as cross-surface
commands). The accepted canonical surfaces are `claude`, `codex-sync`,
`codex-native`, `agent-plugin`, `cursor`, and `agy-plugin`; actions are `plan`,
`install`, `verify`, `update`, `uninstall`, `rollback`, and `status`. Passing
the ambiguous bare surface `codex` fails with exit `64` (`INVALID_ARGUMENT`)
and directs the caller to `codex-sync`, `codex-native`, or `dhpk-install status --all`.
For example:

```bash
dhpk-install cursor plan --scope project --json
dhpk-install status --all --project-root /path/to/project --strict --json
```

When running from a source checkout, invoke the bundled entrypoint directly:
`bash /path/to/dhpk/bin/dhpk-install cursor plan --scope project --json`.

The JSON result binds the normalized request to a versioned
`dhpk.installation-plan.v1` identity. It records source version, target scope,
profile and selected stable IDs, support closure, owned roots, plan/inventory
fingerprints, preview, backup, transaction, recovery, and rollback identity.
Native surface receipts may embed the corresponding
`dhpk.installation-receipt.v1` identity while retaining their native receipt
schema. The inventory-owned `installation_contract` is the support-tier and
surface × operation matrix; `ADAPTER` names an existing characterized route,
not permission for this generic CLI to write.

The plan keeps the
closed projection evidence vocabulary separate from lifecycle presentation.
`INSTALL_PASS + CONSUMER_BLOCKED` is never a projection `PASS` and cannot
promote a support tier. The project-scope `codex-sync` and `cursor` write actions (install, update,
uninstall) run the same JS installer as `install-codex-skills.sh` and
`install-cursor-harness.sh`, and require an explicit `--project-root`; every
other write action returns `BLOCKED` with the stable `NOT_IMPLEMENTED`
diagnostic before any mutation. Both installer scripts remain supported routes. The generic route
stays fail-closed until a future change explicitly transfers ArtifactStore
write ownership; adapter characterization alone never enables mutation.

<a id="dhpk-install-status"></a>

### Read-only cross-Host inspection (`dhpk-install status`)

`dhpk-install status --all [--project-root <dir>] [--scope <project|user|local>] [--offline] [--strict] [--json]`
(and `dhpk-install <surface> status [...]`) performs zero filesystem writes
(`schema: dhpk.install-status.v1`, `mutation.performed: false`):

- **Scopes & surfaces**: inspects all six canonical surfaces (`claude`,
  `codex-sync`, `codex-native`, `agent-plugin`, `cursor`, `agy-plugin`),
  project/user/local/managed scopes, symlink health (`BROKEN_LINK`,
  `LEGACY_MIGRATED_LINK`), Asset Receipt (`.claude/dhpk/.dhpk-asset-receipt.json`),
  version pins (`.claude/dhpk-versions.json`), Cursor hash cache drift, AGY
  candidate paths, and dual-layer Duplicate Discovery.
- **Claude dual evidence**: compares plain-text `claude plugin list`, JSON
  `claude plugin list --json`, and `~/.claude/plugins/installed_plugins.json`
  side-by-side, reporting `VERSION_DRIFT`, `SOURCE_MISMATCH`, and
  `ENABLED_STATE_MISMATCH` alongside raw CLI evidence.
- **`--offline` vs live probes**: `--offline` skips live Host CLI probes and
  keeps their status as `NOT_RUN` (`reason: 'offline'`). Missing CLIs report
  `CLI_NOT_INSTALLED`; failing or unparseable probes report `PROBE_FAILED` /
  `CLAUDE_TEXT_PROBE_FAILED` / `CLAUDE_JSON_PROBE_FAILED` / `CODEX_PROBE_FAILED`
  without turning failures into `PASS`.
- **Exit codes**: default runs exit `0` (`64` on invalid arguments such as bare
  `codex`). With `--strict`, exit `0` means `CURRENT`/`ABSENT` with no
  diagnostics, exit `1` means drift diagnostics exist (`VERSION_DRIFT`,
  `SOURCE_MISMATCH`, `ENABLED_STATE_MISMATCH`, `CACHE_DRIFT`, `SURFACE_STALE`,
  `DUPLICATE_DISCOVERY`, `COLLISION`, `BROKEN_LINK`, `LEGACY_MIGRATED_LINK`,
  `ASSET_RECEIPT_STALE`, `VERSION_PIN_MISMATCH`), and exit `2` means blocked
  diagnostics exist (boundary blockers, failed probes, invalid registries or
  receipts, `AMBIGUOUS_TARGETS`).

<a id="plan-json-boundary-remediation"></a>

### Structured `--plan --json` boundary remediation

`install-codex-skills.sh --update --plan --json`,
`install-cursor-harness.sh --update --plan --json`,
`install-agy-plugin.js plan --json`, and
`dhpk-install <codex-sync|cursor> plan --project-root <dir> --json` share one
fail-closed boundary envelope (`scripts/lib/plan-boundary-envelope.js`):

- **Verdicts and exit codes**: `READY` (exit `0`), `CHANGES_PENDING` (exit `1`),
  and `BLOCKED` (exit `2`, project left byte-for-byte unchanged).
- **Envelope fields**: `verdict`, `reasonCode`, `receiptVersion`,
  `journalVersion`, `affectedPaths`, `remediation[]` (each entry carries `kind`,
  `summary`, `command`, `transitionVersion`, `releasesEntries`), and `blockers[]`
  when fail-closed blockers stop the plan.
- **Boundary transition guidance**: missing or unsupported
  `fingerprint_algorithm` (requires `tree-merkle-v1`) or superseded generator
  versions report `MISSING_FINGERPRINT_ALGORITHM` /
  `UNSUPPORTED_FINGERPRINT_ALGORITHM` / `SUPERSEDED_GENERATOR_VERSION` with
  `transitionVersion: "0.69.x"` or `--uninstall` (`releasesEntries: true`).
  Unfinished 0.72/0.73 Python Host journals (`LEGACY_HOST_JOURNAL`) or held
  projection journals (`HELD_PROJECTION_JOURNAL`) report `transitionVersion: "0.74.x"`
  with `dhpk-install --recover`. Retired named-profile receipts report
  `LEGACY_PROFILE_UPDATE_UNSUPPORTED` with `--uninstall` then reinstall.

<a id="install-history"></a>

### Install History JSONL

Lifecycle entrypoints (`dhpk-install`, `install-codex-skills.sh`,
`install-cursor-harness.sh`, `install-agy-plugin.js`, `install-assets.sh`, and
`install.sh`) append one de-identified JSONL record (`schema: dhpk.install-history.v1`)
per invocation:

- **Default location**: `$XDG_STATE_HOME/dhpk/install-history.jsonl`, or
  `~/.local/state/dhpk/install-history.jsonl` when `XDG_STATE_HOME` is unset.
- **Environment variables**:
  - `DHPK_INSTALL_HISTORY_FILE`: overrides the JSONL output file path.
  - `DHPK_NO_INSTALL_HISTORY=1` (or `true`): disables Install History logging.
  - `DHPK_INSTALL_HISTORY_DELEGATED=1`: internal deduplication flag set when
    `dhpk-install` delegates to `codex-cli.js` so one call emits one record.
- **De-identification and failure contract**: hashes `projectRoot` to
  `projectId: "sha256:..."`, redacts home prefixes, usernames, credentials, and
  tokens, and never writes raw project paths or secrets. Writing is best-effort
  warning-only on failure (prints a sanitized warning to stderr and never alters
  the command's exit code). Install History owns no project files and never
  replaces the Projection Journal for crash recovery.

### Cutover planning and owned-path recovery

This guide is the installation operating SSOT. The [Host runtime follow-up disposition](contracts/host-runtime-followup-disposition.md)
owns historical T-1–T-4 dispositions and current conditional native-runtime policy. Accepted owners are
[distribution surface governance](../openspec/specs/distribution-surface-governance/spec.md),
[distribution projection contract](../openspec/specs/distribution-projection-contract/spec.md), and
[skill retirement migration](../openspec/specs/skill-retirement-migration/spec.md).

1. **Choose one target.** Before each apply, name the consumer project, target surface and Host,
   predecessor route, and exact successor artifact.
2. **Bind the plan.** Record source commit/tree/version and artifact digest; inventory revision,
   profile, selected stable IDs, Host configuration, receipt schema/current digest, owned roots,
   and each path's previous/current/expected fingerprints plus intended action. Use `null` with
   `UNAVAILABLE` for missing facts; never infer them from package generation or defaults.
3. **Prove destination ownership with its adapter.** Generic
   `dhpk-install <surface> plan` proves selection/request only. Use the actual target's read-only
   plan: Codex `.codex/.dhpk-installed.json`, Cursor `.cursor/.dhpk-installed.json` (schema v3),
   or AGY's receipt-owned plan. Also inspect shared `.agents/.dhpk-installed.json` and Host
   bindings. The default `node scripts/ci/gen-agents-skills.js` writes; it is not a plan.
   Generic writes remain `BLOCKED` / `NOT_IMPLEMENTED`; do not invent flags.
4. **Classify each path.**
   - Unchanged receipt-owned: eligible only for a separately approved action.
   - Modified receipt-owned: preserve and report a path conflict.
   - Unowned, foreign, or orphaned: preserve; never adopt.
   - Retargeted symlink, malformed receipt, or ambiguous ownership: fail closed.
   Any source, destination, candidate, receipt, or path identity change invalidates the plan;
   replan. If AGY's canonical and
   legacy targets both match, stop as `BLOCKED` with `AMBIGUOUS_TARGETS`. A collision decision
   covers only its named path.
5. **Record authorized work and recovery.** An installed transition waits for successor
   publication, applicable exact-artifact consumer acceptance, and explicit apply approval
   for named paths. Then back up
   approved receipt-owned content; record receipt/path identities, exact transaction, expected
   actions, and changed paths. On partial failure, use the adapter journal to restore only paths
   proven changed by that transaction; preserve foreign or newly modified content. If ownership
   is unproven, stop for manual recovery.
6. **Close cutover in order.** Produce a deterministic source plan. If it exposes an unowned
   behavior gap, implement only that gap and test path states in disposable fixtures; otherwise
   retain the existing adapter without new code. Publish the successor, then validate its exact
   artifact with each relevant consumer and unique intended discovery. Removing one Host binding
   must preserve shared content and remaining Hosts' discovery. Retire compatibility only after
   named routes and their remaining consumers/references are inventoried, applicable consumers
   pass, a deprecation window/recovery path, and separate approval are recorded.

Codex native remains experimental and isolated; active project/native overlap must stop on
duplicate discovery. Cursor native components and the portable Agent Plugin retain separate
owners; one surface's plan cannot authorize another's writes.

Native runtime evidence is conditional on a named integration, affected loader/role/tool mapping,
activation defect, or
explicit native-acceptance request; package results are not native-runtime evidence. This
procedure authorizes no apply, publication, or retirement and claims no cutover execution.

### Standalone and common selection

New installs use the inventory-owned `common` collection. Public publication
`--profile` flags are rejected. A standalone request is a separate boundary:

```bash
dhpk-install codex-native plan --scope project --standalone flow-guide --json
node scripts/ci/gen-claude-profile-bundles.js --standalone flow-guide --plan
```

`--standalone` accepts a stable ID or public skill name and may be repeated;
duplicates are normalized. It cannot be combined with `--profile` or the
additive `--skill` overlay. Standalone plans record requested IDs, emitted
public names, supporting/runtime closure, unavailable capabilities, and a
selection fingerprint. `required_core_ids` applies only to profiles, so a
standalone skill does not silently install the core set. Missing, retired,
conflicting, cyclic, or unresolvable dependencies fail closed. Runtime-only
support is recorded as support metadata and is never published as a public
skill.

## Unified distribution CLI

`bin/dhpk distribution <surface> <operation>` is the single deterministic
package boundary for the retained native package surfaces: `agent-plugin`,
`cursor-plugin`, `codex-native`, and `agy-plugin`. Its operations are
`generate`, `preview`, `validate`, and `verify`; each JSON result records structural
evidence and deliberately returns `runtime: NOT_RUN` unless a separate
client-specific probe is executed.

Only the Published Packages are committed: the Full Plugin (`dhpk`) and `dhpk-stacks`
under `dist/claude-marketplace/`, the instruction-only Directory Plugin (`dhpk-lite`)
under `dist/claude-directory/package/`, and the Public Plugin under `plugins/dhpk/`
(`codex-native`). The Agent, Cursor and AGY packages are built on demand.
`bin/dhpk distribution build <surface>` generates the package into the ignored
`dist/on-demand/<name>/` directory, validates it, and writes
`dist/on-demand/<name>-<version>.tar.gz` next to it. The release workflow runs
the same command for the three surfaces and attaches the archives to the GitHub
Release, so consumers can download them instead of building:

```bash
bin/dhpk distribution build agent-plugin --json
bin/dhpk distribution build cursor-plugin --json
bin/dhpk distribution build agy-plugin --version=0.84.0 --json
bin/dhpk distribution agy-plugin validate --json
```

`build` requires a clean source checkout, like `generate`, and is accepted only
for `agent-plugin`, `cursor-plugin` and `agy-plugin`. Extract a downloaded
archive into one directory so that `dhpk-cursor` sits beside `dhpk-agent`.

For dirty-source inspection, `preview` snapshots the tracked `HEAD` plus
nonignored worktree changes into a disposable external output. It records
`publicationMode: preview`, `releaseEligible: false`, and separate base/snapshot
identity; formal validation and release gates reject that marker by default.
Preview output is temporary and is never an installation or release artifact:

```bash
bin/dhpk distribution agent-plugin preview \
  --version=<version> --json
# The JSON output path is disposable; formal validation rejects its preview receipt.
```

When producing the committed Public Plugin, `generate` requires a clean source
checkout. Generate it into a new directory outside the checkout from the clean
commit, then copy the owned output into `plugins/dhpk/` and commit once:

```bash
packages=$(mktemp -d /tmp/dhpk-packages.XXXXXX)
bin/dhpk distribution codex-native generate --output "$packages/dhpk" --version=<version> --json
```

Stop on any failure. Validate the existing tracked target before replacing it and
preserve bytes and modes when copying the owned directory.

The `openai-submission` surface builds a separate complete skills-only
candidate from the public catalog. Its manifest, external output directory,
receipt checks, and submission gates are documented in the
[OpenAI submission guide](./openai-submission.md).

## OpenAI skills-only Public Plugin

The target daily-use route is the public Plugins Directory shared by Codex and
ChatGPT Work. The DHPK listing is currently a submission candidate and is
`NOT_PUBLISHED`; it cannot yet be installed from that directory. After the
approved listing appears, open the product's Plugins Directory, select DHPK,
and install it through the product plugin manager. Remove it through the same
manager. Start a fresh conversation before recording workflow evidence.

Codex CLI `codex plugin add` and `codex plugin remove` manage plugins from a
configured marketplace. For this repository, local or repository marketplaces
are development/testing sources; they do not publish or replace the public
listing. The one-time migration/cutover executor for existing installations
has not shipped. Existing Codex project-sync and legacy native instructions
below remain compatibility procedures and are not evidence that cutover is
complete. See the [OpenAI submission guide](./openai-submission.md) for package
verification and release gates.

## Codex project-local sync (Supported)

Prerequisites: the Codex project-local loader, a POSIX shell, and the
schema-v3 receipt contract from the first row above. The client version is not
established until release evidence records it.

Run from the project root. Codex project-local sync requires a repository
checkout; an installed Claude plugin does not include `codex/`. The
standalone checkout form is:

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh
```

For this source-directory projection, the default materializes skill trees and
`.codex/agents/*.toml` as physical files; Codex must load the latter as
configuration layers. Supporting assets remain relative symlinks by default,
and `--copy` makes those physical too. This rule describes source-directory
materialization; Codex discovers project skills from `.agents/skills`
([Codex skills](https://developers.openai.com/codex/skills)) directly, so the
installer creates no per-skill `.codex/skills/<name>` links
([ADR-0042](adr/0042-codex-direct-shared-projection-discovery.md)). `--update`
retires unchanged receipt-owned `.codex/skills/<name>` links or copies left by
earlier installs; in a source checkout it reports
`COMPATIBILITY_PROJECTION_STALE` and keeps the copy when `.agents/skills` needs
`npm run sync:local-skills`:

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh --copy
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh --update
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh --migrate --update
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh --uninstall
```

`codex-sync` is the supported and canonical daily-use route. Before an
`install`, `update`, `migrate`, or `plan` operation, the installer queries
`codex plugin list --json`. A positively enabled `dhpk@dhpk` blocks the
operation before any write; `--force` cannot bypass this gate, while
`--uninstall` remains available. If the query is missing or unsupported, the
JSON result reports `providerCheck: UNAVAILABLE` and project sync may proceed.
The installer never removes a global native plugin automatically.

New Codex installs use the `common` collection and may add existing `--skill <stable-id>` overlays. Public `--profile` selection is retired.

For historical named-profile receipts (`minimal`, `full`, `compat-v1`), read, plan, uninstall, and recovery preserve the exact stored scope, including retired IDs. Updates return `BLOCKED` before any mutation. Older receipts without selection metadata retain the existing structural migration route. Ordinary `--update` remains available for current receipts.

When `--update` reconciles an older schema-v3 symlink projection, it converts
unchanged receipt-owned skill and agent links to physical files and records the
new ownership fingerprints. Supporting assets keep the selected mode, which is
symlink by default. Retargeted, edited, or unowned paths remain collisions and
are not overwritten.

`--force` bypasses only the project-root heuristic. It never bypasses receipt
ownership or path safety. The schema-v3 receipt records stable ID, public name,
destination, source, mode, and fingerprint. Edited, user-owned, retargeted,
malformed, ambiguous, or colliding files are preserved and reported.
`--update` without `--adopt` exits non-zero while any reported collision
remains, so a partial receipt cannot be mistaken for a current projection.

The receipt and every transaction journal also record `fingerprint_algorithm`
(`tree-merkle-v1`), the one directory-tree recipe shared with the generated
package fingerprints: a per-directory Merkle digest in which empty directories,
file modes, and the root path do not contribute.

Version 0.70.0 accepts only receipts, journals, and packages written by 0.69.x
or later. A record without `fingerprint_algorithm` fails closed with a
diagnostic that names the field and changes nothing; so does a record naming any
other algorithm. To recover, either upgrade through 0.69.x and run one install
or update, which rewrites the receipt with `tree-merkle-v1`, or uninstall and
reinstall. `--uninstall` over a receipt without the marker deletes no file: it
removes the receipt and lists every entry as a Released Entry, which you can
delete by hand before reinstalling. Do not downgrade the installer across this boundary: an older
installer cannot verify a `tree-merkle-v1` receipt. An `--adopt` request
copied from a plan made by an earlier installer fails with
`adoption preflight changed`; run a fresh plan.

When an update or migration cannot prove ownership of a receipt entry, it
releases the entry (a Released Entry, see `GLOSSARY.md`): the entry is removed from the receipt, its
files stay in place untouched, and the output lists it. Release does not block
the run that releases the entry, and the receipt is rewritten with
`tree-merkle-v1`. Afterwards the path is unowned: if a later run still ships
that skill, it reports a collision and keeps the files; run a fresh `--plan`
and `--adopt` to manage them again. A symlink-mode entry whose link target
matches its recorded target is kept; one with a mismatched target is released.
A destination you
edited after a `tree-merkle-v1` install is a modified collision, not a release. A read-only `--plan` or check never rewrites the receipt.

For a stale or unowned projection, inspect before changing anything:

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh \
  --update --plan --json
```

Planning is read-only. If an owner approves one exact collision, copy both
reported fingerprints into an explicit adoption request. Omit `--copy`: the
installer preserves the receipt's existing projection mode so unrelated managed
entries are not rematerialized:

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh \
  --update \
  --adopt='skills/flow-guide@<destination-fingerprint>@<source-fingerprint>'
```

Adoption is path-scoped and creates a rollback-addressable backup before
promotion. It never authorizes other paths or other consumer surfaces. If the
fingerprint changed since planning, the command fails before mutation; run a
fresh plan. Review `.codex/.dhpk-installed.json` for `adopted`, `backups`, and
`evidence.paths` before treating the projection as current.

Verify the consumer projection from the consumer project root:

```bash
test -f .codex/.dhpk-installed.json
test -z "$(find .codex/agents -type l -print)"
```

These checks and the receipt prove installation shape only. Named-role runtime
is `NOT_RUN` until a fresh Codex session actually dispatches a projected role;
an unavailable or unknown custom role is non-pass evidence, not a static
installer PASS.

Use a non-built-in custom role as the registry canary. Compare the canary in
both hyphenated and underscored forms. Built-in `explorer` success proves only
that multi-agent tooling is available. If an exact-ID custom role backed by a
physical TOML in a valid Git checkout still reports
`unknown agent_type`, record `CUSTOM_AGENT_REGISTRY_UNAVAILABLE`, the Codex CLI
version, and bounded redacted diagnostics. Keep the consumer gate `FAIL`; role
renames, model changes, and configuration rewrites are not installation
remediation.

Do not infer `CUSTOM_AGENT_REGISTRY_UNAVAILABLE` from missing typed
collaboration events alone. The diagnosis requires affirmative unavailable-role
or observed `untyped-fallback evidence`—a fallback spawn observed without
`agent_type`—from the gate-owned trusted disposable-home probe, a fresh isolated
temporary `CODEX_HOME` created by the gate to capture the dispatch. If neither is
present—including only a text `CODEX_DHPK_NAMED_ROLES=PASS` marker alone—retain
bounded evidence and report generic `FAIL`; investigate collaboration-tool
exposure/protocol separately. This result is neither runtime `PASS` nor an
unavailable-registry diagnosis.

Run source-check validators from the dhpk checkout. Set `DHPK_ROOT` to the
checkout that owns `scripts/` and `tests/`; these files are not copied into the
consumer project:

```bash
DHPK_ROOT=/absolute/path/to/dhpk
node "$DHPK_ROOT/scripts/ci/validate-openai-metadata.js" --root "$DHPK_ROOT"
node "$DHPK_ROOT/tests/install-codex-skills.test.js"
```

Rollback is `--uninstall` or restoration of a saved `.codex/` receipt. Do not
delete the whole `.codex/` directory.

### Check for duplicate Codex discovery

Project-local sync and the experimental native package are separately published
and acquired surfaces, but runtime activation is mutually exclusive. A host
using `codex-sync` must not also activate `dhpk@dhpk`; otherwise one public
skill name can appear twice.

<a id="duplicate-discovery-diagnostics"></a>

#### Cross-Host dual-layer Duplicate Discovery (`check-duplicate-discovery.js`)

Run the shared dual-layer Duplicate Discovery diagnostic across Codex and Claude
(`schema: dhpk.duplicate-discovery.v1`):

```bash
node "$DHPK_ROOT/scripts/ci/check-duplicate-discovery.js" \
  --project-root "$PWD" \
  --host all
```

- **Baseline layer**: read-only scan of filesystem skill roots, receipts
  (`.agents/.dhpk-installed.json`, `.agents/skills/.dhpk-projection.json`,
  `.codex/.dhpk-installed.json`, `.claude/.dhpk-installed.json`), and enabled
  plugins, classifying entries by `ownershipClass` (`plugin`, `receipt-owned`,
  `third-party`, `unmanaged`). Still produces `PASS` or `DUPLICATE` under `--offline`.
- **Live layer**: runs the Host CLI probe (`codex debug prompt-input` for Codex,
  `claude plugin list --json` for Claude) and reports `PASS`, `DUPLICATE`,
  `NOT_RUN` (`--offline`), or `UNAVAILABLE` (`host-cli-missing`,
  `host-cli-timeout`, `host-cli-failed`, `host-cli-unparseable`). Neither layer
  overwrites the other.
- **Exit codes**: `0` when clean, `1` when any Host `baseline` or `live`
  verdict is `DUPLICATE`, `2` on invalid CLI arguments. `dhpk-install status`
  embeds this same diagnostic.

For the Codex-provider-specific `check-codex-discovery.js` check, run this
read-only command from the consumer project root after setting `DHPK_ROOT` to
the source checkout:

```bash
node "$DHPK_ROOT/scripts/ci/check-codex-discovery.js" \
  --repo-root "$DHPK_ROOT" \
  --project-root "$PWD" \
  --native-root "$DHPK_ROOT/plugins/dhpk"
```

The report keeps artifact integrity separate from runtime activation.
`--native-root` supplies package/artifact evidence only — a source checkout
or generated artifact found there is not, by itself, an active runtime
provider. Identical fingerprints with valid provenance may produce
`integrityVerdict: PASS`; stale, unowned, or conflicting artifacts follow the
existing integrity rules. The runtime verdict is independently `BLOCKED` with
`reasonCode: DUPLICATE_CODEX_PROVIDER` whenever project and native surfaces
expose the same invokable public name AND `codex plugin list --json` reports
`dhpk@dhpk` as enabled, even when their fingerprints match.
`duplicateInvokableNames` lists the affected names; non-invokable support
packages are excluded. Precedence does not turn an overlapping invokable name
into a runtime `WARN` or `PASS`.

The `activation` field reports how the native plugin's enabled state was
determined: `status` is one of `NOT_INSTALLED`, `UNAVAILABLE`, `AVAILABLE`,
`DISABLED`, `ENABLED`, or `INACTIVE` (the last only from an explicit
`--native-activation inactive` override, never from the live probe), with
`source` naming either `codex-plugin-list` (the
default, live probe) or `override` (an explicit `--native-activation` value).
When an overlapping name exists but the native plugin is not enabled, it is
listed in `inactiveDuplicateInvokableNames` instead and the runtime verdict
stays `PASS`. If activation cannot be determined (`activation.status:
UNAVAILABLE`, e.g. Codex is unreachable or its `plugin list` output could not
be parsed) and an inactive overlapping name exists, the command reports
`verdict: WARN` and `reasonCode: CODEX_ACTIVATION_UNKNOWN` — a non-blocking
signal to confirm activation manually rather than either a false block or a
silent pass. Pass `--native-activation enabled|inactive` to select the
runtime judgment explicitly (for example in CI, without invoking a live
`codex` CLI); `--native-activation auto` (the default) runs the live probe.

If the CLI cannot compute a provider fingerprint, it returns structured JSON
with `verdict: BLOCKED`, `integrityVerdict: BLOCKED`, and
`reasonCode: CODEX_PROVIDER_FINGERPRINT_ERROR`. The affected provider and its
fingerprint error are listed in `invalidProviders`; the report does not invent
a fingerprint. This policy failure exits 1 (status 1); it is not the exit-2
usage/error path. The `nextAction` field says `--update` is only for
receipt-owned entries; unowned entries require manual inspection, repair, or
removal. It does not claim that `--update` prunes unowned links.

The command only reports evidence; it does not delete a projection, cache, or
host registration. Remediation is a human choice. For the supported project
sync route, remove the enabled native plugin with
`codex plugin remove dhpk@dhpk`, then start a new Codex session; do not delete
the whole `.codex/` directory. For a native experiment, use a fresh disposable
isolated `CODEX_HOME` with no project-local projection.

## Codex Public Plugin, native route (Experimental)

Prerequisites: a real `codex` CLI with the marketplace route, a POSIX shell,
and a recorded `codex --version`; the minimum CLI version is 0.159.0 (derived from `gpt-6.1-terra`).
This experimental route is for a disposable isolated `CODEX_HOME` only and
must not be activated alongside the supported project-local sync route.

The native artifact is the Public Plugin at `plugins/dhpk/`, which carries
`.codex-plugin/plugin.json` and no hooks. Where supported by the real CLI:

```bash
codex plugin marketplace add <repo-or-path>
codex plugin add dhpk@dhpk
```

The local marketplace must be configured by the consumer. Check the physical
package, `fingerprints.json`, `provenance.json`, and the exact client version
before describing an install as evidence. These repository commands are
conditional on the installed CLI; official Codex documentation is not
dhpk-specific proof of this route. If `codex` or the marketplace route is
missing, record `UNAVAILABLE`/`BLOCKED`; retain the project-local sync path.
The Codex manifest is never counted as proof of Agent Plugins conformance.

## Standard Agent Plugin

Prerequisites: a client implementing the Agent Plugins 1.0.0 schema and a
verified loader route; no minimum client version has been verified.

Obtain the package from the GitHub Release archive
`dhpk-agent-<version>.tar.gz` or build it with
`bin/dhpk distribution build agent-plugin`. `dist/on-demand/dhpk-agent/` has one root `plugin.json` with the Agent Plugins 1.0.0
schema, immediate-child `skills/` directories, and optional schema-versioned
`mcp.json`. Claude/Codex invocation policy remains in client-owned metadata;
portable skill frontmatter contains only standard fields and nested metadata.

Install only through a route verified for the target client. Structural checks:

```bash
bin/dhpk distribution agent-plugin validate --json
node scripts/ci/verify-platform-packages.js
```

These checks prove package shape, containment, deterministic fingerprints, and
provenance. They do not prove Codex or Cursor runtime discovery.

For Cursor consumer-runtime evidence, use the `cursor-agent` CLI only. The
portable Agent Plugin route is a single plugin directory:

```bash
cursor-agent --plugin-dir <agent-package> --mode ask --trust -p <smoke-prompt> --output-format stream-json --stream-partial-output
```

Do not add a Cursor-native directory, Codex marketplace command, or
agent-plugins.org argument to this portable route.

The authenticated release probe may stage a schema-validated, probe-owned
Cursor manifest and hook overlay inside its disposable copy solely to attest
that the single package directory was loaded. The published Agent Plugin
package remains the portable `plugin.json` plus `skills/` tree, and the overlay
is removed during probe cleanup. If the Agent package also has optional
`mcp.json`, that Agent-owned file is omitted from this Cursor-only attestation
copy; the probe therefore makes no MCP runtime claim and never changes the
published package.

## Project-local `.agents/skills` compatibility projection

Official Cursor guidance documents `.agents/skills/<name>/SKILL.md`; official
Antigravity CLI guidance documents markdown skill files directly under
`.agents/skills/`. dhpk supports both shapes from one canonical `skills/`
source. The generated tree is skills-only and is not a universal agent or rule
configuration root.

Source references: [Cursor Skills](https://cursor.com/cn/docs/skills),
[Antigravity Plugins & skills](https://antigravity.google/docs/cli/plugins/),
and [Codex project guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[Codex rules](https://learn.chatgpt.com/docs/agent-configuration/rules), and
[Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

The no-argument route remains a compatibility wrapper for an in-checkout
`.agents/skills/` tree:

```bash
node scripts/ci/gen-agents-skills.js
node scripts/ci/validate-agents-skills.js
```

If canonical skill bytes changed, the default generator stops on the stale
projection. After reviewing the source diff, explicitly authorize that update:

```bash
node scripts/ci/gen-agents-skills.js --update
```

For a consumer project outside the checkout, use the compiler-owned project
route. One project-level receipt owns the shared artifact and all Host bindings:

```bash
DHPK_ROOT=/absolute/path/to/dhpk
PROJECT_ROOT=/absolute/path/to/consumer
node "$DHPK_ROOT/scripts/ci/gen-agents-skills.js" \
  --source-root "$DHPK_ROOT" \
  --project-root "$PROJECT_ROOT" \
  --profile portable-core \
  --host claude --host codex --host cursor --host agy
node "$DHPK_ROOT/scripts/ci/validate-agents-skills.js" \
  --repo-root "$DHPK_ROOT" \
  --source-root "$DHPK_ROOT" \
  --project-root "$PROJECT_ROOT"
```

This route materializes physical self-contained `<name>/SKILL.md` packages
under `$PROJECT_ROOT/.agents/skills/` for the portable tree and receipt-owned
Claude packages under `$PROJECT_ROOT/.agents/claude-skills/`; AGY receives
`<name>.md` direct files under `$PROJECT_ROOT/.agents/skills/`. One schema-v3
lifecycle receipt at `$PROJECT_ROOT/.agents/.dhpk-installed.json` owns both
trees and every Host binding. Claude discovery uses receipt-owned
`.claude/skills/<name>` symlinks to the structured Claude sibling; Codex
discovers `.agents/skills/` directly ([ADR-0042](adr/0042-codex-direct-shared-projection-discovery.md))
without per-skill `.codex/skills/<name>` links (unless an explicit non-PASS
`DHPK_CODEX_CONSUMER_EVIDENCE` override is supplied for compatibility tests),
while Cursor retains [ADR-0023](adr/0023-native-installers-delegate-skills-to-the-shared-projection.md)'s
Consumer Evidence gate with symlinks to the physical portable tree. The portable
tree keeps metadata values as strings; the Claude sibling
preserves structured metadata values. The compatibility
`.agents/skills/.dhpk-projection.json`, when present, is only a generated
manifest. AGY consumes the embedded direct-file body. No generated instruction
points back to the source checkout.

If the consumer project exposes the whole managed root
(`$PROJECT_ROOT/.agents/skills/`) through a directory-level symlink (`.claude/skills -> ../.agents/skills`), that alias
already makes every projected skill visible to Claude: omit `--host claude`.
Keeping `--host claude` fails closed with `MANAGED_ROOT_ALIAS`, because
per-skill bindings would be written through the alias into the managed
artifact; replace the alias with a physical `.claude/skills/` directory when
dhpk should own per-skill bindings.

When a source change is intentional, add `--update` after reviewing the diff.
For a receipt-less legacy artifact, use explicit adoption or repair:

```bash
node "$DHPK_ROOT/scripts/ci/gen-agents-skills.js" \
  --source-root "$DHPK_ROOT" --project-root "$PROJECT_ROOT" \
  --profile portable-core --adopt --update
node "$DHPK_ROOT/scripts/ci/gen-agents-skills.js" \
  --project-root "$PROJECT_ROOT" --rollback
node "$DHPK_ROOT/scripts/ci/gen-agents-skills.js" \
  --project-root "$PROJECT_ROOT" --uninstall
```

`legacy-unbound` status leaves the artifact unchanged until `--adopt` or
`--repair` proves ownership. Updates preserve unmanaged entries and refuse
changed receipt-owned files; removing one Host binding removes only its Claude
adapter and retains shared content used by the remaining Hosts. Structural
`PASS` does not establish consumer runtime discovery. Record each configured
Host separately with `PASS`, `NOT_RUN`, `UNAVAILABLE`, `NOT_CONFIGURED`,
`BLOCKED`, or `SKIP_INCOMPATIBLE`; for the exact external artifact, the bounded
project probes are `--platform claude-project` and `--platform agy-project`.

The official Codex locations remain `.codex/agents/*.toml` and
`.codex/rules/*.rules` (with `AGENTS.md`/configured fallback filenames for
project guidance). Cursor agents/rules remain `.cursor/agents/` and
`.cursor/rules/`; AGY plugin agents/rules remain inside the installed AGY
plugin package. Keep those platform-native projections generated from the
canonical `agents/` and `rules/` trees.

### Claude plugin and project bindings

When the official Claude plugin `dhpk@dhpk` is enabled for the project and its
package catalog provides a selected Skill Identity, the project must not
publish a second `.claude/skills/<name>` binding for it
([ADR-0039](adr/0039-claude-plugin-provision-gates-project-bindings.md)).
`gen-agents-skills.js` runs `claude plugin list --json` in the project root,
then compares stable IDs with the catalog (`provenance.json`, plugin 0.69.0 or
later) in the Host-reported install root. The shared `.agents/skills` artifact,
the Claude sibling under `.agents/claude-skills`, the receipt selection, and the
Codex/Cursor/AGY bindings do not change; only the Claude binding is withdrawn,
and its receipt entry is marked `claudePluginProvided`.

| State | Meaning | Claude project bindings |
| --- | --- | --- |
| `ENABLED` | Every applicable plugin record is enabled and the catalog verifies | Withdrawn for identities the plugin provides; the rest are published |
| `DISABLED`, `NOT_APPLICABLE`, `ABSENT`, `INACTIVE` | Plugin off, installed only for another project, not installed, or `--claude-plugin-state inactive` | All published; earlier withdrawals are restored |
| `CLI_NOT_INSTALLED` | No `claude` command | Like `ABSENT`, unless the receipt already records a withdrawal (then like `UNKNOWN`) |
| `UNKNOWN` | CLI failure, timeout, malformed output, conflicting records, load errors, or a missing or drifted catalog | Nothing is deleted or restored; a run that would add a new Claude binding stops with `CLAUDE_PLUGIN_STATE_UNKNOWN` |

Withdrawal removes only the receipt-owned symlink, and only while it still
points where the receipt says. A retargeted or replaced link stops the run with
`MANAGED_CONTENT_CHANGED`; an unowned entry at that path is left in place and
reported as `UNOWNED_ENTRY_PRESERVED`. Restoring a binding over an unowned
entry stops with `GENERATED_PATH_COLLISION`. A plugin name that matches a
selected skill under a different stable ID is published and reported as
`SAME_NAME_DIFFERENT_IDENTITY`.

The run prints `Claude plugin dhpk@dhpk: <state>; withdrew N, restored M
project bindings`. Skip the check with `--claude-plugin-state inactive` (or
`DHPK_CLAUDE_PLUGIN_STATE=inactive`; the flag wins). The default is `auto`.
`DHPK_CLAUDE_PROBE_TIMEOUT_MS` changes the 30 second probe limit. The `claude`
command is resolved from absolute `PATH` entries only and never from inside the
project root; if none qualifies the state is `CLI_NOT_INSTALLED`. A `claude`
found only inside the project root gives `UNKNOWN` with reason
`CLAUDE_CLI_INSIDE_PROJECT` (use `--claude-plugin-state inactive` if the plugin
is not enabled there). Plugin roots that disagree on version or identities give
`UNKNOWN` (`PLUGIN_ROOTS_DISAGREE`); a differing catalog digest alone does not,
and the root the Host reads (`readFromFolder`, else `installPath`) supplies the
recorded digest. The Host's
`enabled` value was observed (Claude Code 2.1.326) to be computed for the
working directory; the Host does not document that. Codex and Cursor installers
do not probe; they carry the recorded withdrawal forward.

`--rollback` restores the snapshot exactly, so rolling back to a state from
before a withdrawal rebuilds the duplicate link while the plugin stays
enabled; the next Claude-targeted run withdraws it again.

If a run stops with `CLAUDE_PLUGIN_STATE_UNKNOWN`:

1. Make `claude plugin list --json` run in the project.
2. If `dhpk@dhpk` is not enabled for the project, rerun with
   `--claude-plugin-state inactive`.
3. Update the plugin to 0.69.0 or later, which ships the catalog.

### Interrupted installs and explicit recovery

A Codex or Cursor install, update, or uninstall is one transaction across the
native installer and the shared projection ([ADR-0033](adr/0033-one-projection-journal-owns-install-crash-order.md)).
The installer records the native and shared projection steps in one Projection
Journal (`.agents/.dhpk-projection-journal.json`) and commits both at a single
point, when the journal reaches `published`; the next run finishes or undoes an
interrupted transaction automatically.

- One project lock serializes every Codex and Cursor run. While another run
  holds it, the installer exits `2` with `already reconciling this project:
  .agents/.dhpk-install.lock (held by the <host> installer, pid N, ...)` and
  changes nothing; retry once that run ends. If that run died, rerun the
  installer to take over and recover its transaction, or run it with
  `--recover`. A run of one Host may therefore roll back or finish the other
  Host's interrupted transaction; it prints `recovered interrupted <host>
  transaction ...: rolled back|finished`, and after a rollback you rerun that
  Host's installer to apply it.
- The packaged `harness-setup` copy runs the same JS installer as a checkout
  or plugin cache (its readable installer source modules sit in the skill's `scripts/lib/`), so
  it takes the same project lock and Projection Journal. No installer needs
  `python3`; Node.js is required. `TRANSACTION_HELD` is no longer produced, and
  from 0.75.0 a transaction left unfinished by 0.72 or 0.73 (an `active` or
  `rollback_incomplete` Python Host journal, or a publisher journal with a
  `hold`) is no longer recovered: the installer blocks before changing files and
  names `--recover` of dhpk 0.74.x. Run that 0.74.x `--recover` first, then
  upgrade. Recover in-flight installs before downgrading.
- `dhpk-install --recover` reports the two legacy shapes differently. A Python
  Host journal (`.codex/` or `.cursor/` `.dhpk-transaction-*.json`) left
  `active` or `rollback_incomplete` is listed under `installerJournals` as
  `LEGACY_HOST_JOURNAL`; one whose phase is missing or unknown is listed there
  as `unreadable` ("unsupported phase") with its path, to inspect by hand. A
  publisher journal carrying a `hold` is not listed there: it fails with
  `UNSAFE_TRANSACTION`, shown in the shared projection block as `BLOCKED` and
  naming dhpk 0.74.x.
- While any such blocking Host journal is present, `dhpk-install --recover`
  changes nothing: it skips projection-journal and shared-projection recovery
  (both reported as `SKIPPED`, code `LEGACY_HOST_JOURNAL`) and returns
  `ok: false`, exit `2`. Recover the Host journal with dhpk 0.74.x first.
- `did not finish rolling back` lists the remaining paths and the backup
  directory. Fix the reported cause, then run the same installer with
  `--recover`. It replays the rollback and stops without installing.
- `dhpk-install --recover [--project-root DIR] [--json]` resolves a held
  shared projection whose installer journal is gone (it never reached its
  commit point, so it is undone), refuses while that installer journal is
  still active, and lists every blocking legacy Host journal. JSON entries have
  no `command` field; the text report says to recover with dhpk 0.74.x
  `--recover`. It exits `2` while anything remains.

### Recover receipt-owned shared skills

A missing `.claude/skills/<name>` link for an identity the enabled plugin
provides is expected; see [Claude plugin and project bindings](#claude-plugin-and-project-bindings).

Use this procedure when a previously managed directory under
`.agents/skills/` was replaced by a symlink, or its receipt-owned files are
missing. An update deliberately refuses both states. Removing the symlink
alone does not restore receipt integrity.

1. Stop installers and other writers in the consumer project. Preserve the
   current `.agents/.dhpk-installed.json`, the conflicting symlink and its
   target, and any available backups outside managed and discovery trees.
   Record the current receipt's SHA-256 before proceeding. If
   `.agents/.dhpk-installed.transaction.json` exists, stop manual recovery:
   resolve the interrupted transaction first through the installer or
   `dhpk-install --recover`; if that fails, retain its diagnostics and backups
   for maintainer assistance.
2. Find a physical backup of the affected skill from the installation described
   by the **current** receipt, such as the original directory saved before
   replacement. A rollback directory contains a previous version and is only
   a candidate. Current canonical source may also differ from generated output.
3. Read the current receipt's `managedPaths` and `generatedFingerprints`.
   For every managed path below the affected skill, compare the backup file's
   SHA-256 to that path's `generatedFingerprints` value. Require every file to
   exist as a regular file, with physical parent directories and no symlinks.
   For example, this read-only command prints expected hashes for one skill;
   replace the two arguments with the consumer receipt and public skill name:

   ```bash
   node - /path/to/project/.agents/.dhpk-installed.json git-smart-commit <<'NODE'
   const fs = require('node:fs');
   const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
   const prefix = `${process.argv[3]}/`;
   const paths = receipt.managedPaths.filter((entry) => entry.startsWith(prefix));
   if (!paths.length) throw new Error('No receipt-owned files for this skill');
   for (const entry of paths) console.log(receipt.generatedFingerprints[entry], entry);
   NODE
   ```

   Use `sha256sum /path/to/backup/git-smart-commit/SKILL.md` (or
   `shasum -a 256` on macOS) for each corresponding backup file, including
   scripts and resources. This inspection does not validate the receipt's
   authenticity; the installer validates the sealed receipt when retried.
4. If a file is absent, unsafe, or has a different hash, stop. Keep the current
   receipt and consumer content unchanged and obtain a matching backup or
   maintainer assistance. Existing `--repair` handles receipt-less legacy
   adoption; it does not restore missing files in an existing lifecycle receipt.
   `--rollback` also requires the current managed content to pass validation.
5. Once all affected backup files match, move the conflicting symlink itself
   to a separate preserved location without following it. If it was already
   removed, keep the destination absent. Confirm all its parents under the
   project are physical directories and the destination does not exist
   (including a dangling link). Restore the verified skill directory to its
   original location as physical files, retaining the backup. Restore only the
   receipt-listed files; preserve backup-only foreign files externally. Recheck
   restored hashes and the unchanged receipt hash. Preserve unrelated files
   and other Hosts' bindings.
6. From the consumer project, retry the same native installer with
   `--migrate --update` and the original selection arguments. Successful
   validation and update complete recovery.
   If another affected path is reported, repeat the checks for that path;
   retain diagnostics if receipt validation fails. Never delete receipt entries
   or use `--force` to work around ownership or fingerprint validation.

## Cursor standard Agent Plugin

Prerequisites: a Cursor desktop client with the local plugin loader and a
recorded Cursor version; no minimum version has been verified.

Cursor can consume `dist/on-demand/dhpk-agent/` for portable skills and optional MCP:

1. Open Cursor **Customize → Plugins** and choose the reviewed local package,
   or copy it to `~/.cursor/plugins/local/dhpk-agent`.
2. Reload the window.
3. Verify the discovered skill names and MCP entries in Cursor's plugin view.

Record the Cursor version and probe output. Without a supported local loader or
CLI, keep the result `UNAVAILABLE`/`BLOCKED`; never claim native rules,
commands, agents, or hooks from this package.
Cursor desktop GUI, **Customize → Plugins**, the desktop `cursor` binary, and
project-local `.cursor/` files are separate installation paths and are not
`cursor-agent` runtime proof.

## Cursor CLI (launch-scoped probe)

The Cursor CLI is a separate consumer surface from the Cursor desktop plugin
loader. In this guide, **launch-scoped** means that `--plugin-dir` supplies
packages to one `cursor-agent` invocation; it does not install or register a
persistent plugin. The current CLI help exposes `--plugin-dir`, but official
CLI documentation does not establish plugin component discovery, so this route
is experimental/conditional until a versioned consumer probe succeeds. Its
`plugin` subcommand does not provide a non-interactive `plugin install` command.
Do not describe `cursor-agent plugin marketplace add` as an installation of
dhpk; it only adds or updates a marketplace index.

Prerequisites: a recorded `cursor-agent --version`, an already logged-in
Cursor CLI session, and both dhpk packages available locally. API-key-only
authentication is not consumer-runtime proof. Check authentication before the
probe:

```bash
cursor-agent --version
cursor-agent status
cursor-agent login  # only when status reports Not logged in
```

For a launch-scoped, read-only probe, use the bounded wrapper and pass both
package directories explicitly. It invokes the command below with a finite
timeout and output cap:

```bash
node scripts/release/cursor-agent-probe.js \
  --agent-package "$HOME/.cursor/plugins/local/dhpk-agent" \
  --cursor-package "$HOME/.cursor/plugins/local/dhpk-cursor" \
  --timeout-ms 60000 \
  --max-output-bytes 262144
```

The wrapper's launch command is equivalent to:

```bash
cursor-agent \
  --plugin-dir "$HOME/.cursor/plugins/local/dhpk-agent" \
  --plugin-dir "$HOME/.cursor/plugins/local/dhpk-cursor" \
  --mode ask \
  --trust \
  -p 'Read only. Return exactly: dhpk skills commands agents rules loaded. CURSOR_SMOKE_OK. Do not call tools or edit files.' \
  --output-format stream-json \
  --stream-partial-output
```

`stream-json` is newline-delimited machine-readable output. The probe evaluates
discovery only from the terminal response event; prompt/tool frames are retained
as bounded redacted diagnostics for timeout diagnosis and cannot satisfy a
runtime `PASS` on their own.

The release `--execute` route clones only the allowlisted Cursor login files into
a disposable HOME and runs the bounded client in a verified bubblewrap namespace.
It uses `--unshare-all` followed by `--share-net` so the `--mode ask` request can
reach the service while the filesystem, HOME, and process remain isolated. An
unrestricted release request is rejected; if bubblewrap is unavailable the result
is `BLOCKED`, and DNS/transport failures are `UNAVAILABLE` rather than product
`FAIL`. Offline fixtures may request `networkMode: disabled`, which remains
network-isolated and cannot be promoted to a live runtime PASS.
For clients installed under a home directory, the namespace binds only the
physical executable directory; a trusted Homebrew-style `.linuxbrew` prefix is
the explicit exception when absolute sibling libraries require that self-contained
runtime tree, while direct home-root and direct `.local` executables are blocked.

The portable Agent Plugin probe uses exactly one directory:

```bash
cursor-agent \
  --plugin-dir <agent-package> \
  --mode ask \
  --trust \
  -p <smoke-prompt> \
  --output-format stream-json \
  --stream-partial-output
```

The wrapper also passes `--trust` so a launch-scoped probe does not wait for
an interactive workspace-confirmation prompt, and it ignores stdin so the
child does not inherit a caller TTY. Do not paste the equivalent `cursor-agent`
argv into an interactive shell if you need the same hang-free evidence.

Record the exact CLI version, authentication status, package paths, and probe
output. A successful package validator proves structure and provenance only;
runtime `PASS` requires the logged-in `cursor-agent` CLI to discover the projected content;
until then keep the CLI route `NOT_RUN` or `BLOCKED`. If the CLI reports
`Authentication required`, the evidence is `BLOCKED` until login is completed.
If `cursor-agent` is missing, record `UNAVAILABLE`; the desktop `cursor`
binary, GUI discovery, and project-local `.cursor/` installer are not a
substitute. The `cursor-sync` installer identity row is expected to be
`NOT_RUN` when no installer runtime was executed; that state is not a Cursor
consumer-runtime PASS, and it is not by itself a `NO-SHIP` result. An installer
`FAIL` remains unhealthy and must be investigated.
The probe enforces a 5-minute timeout ceiling and a 4 MiB output ceiling even
when larger values are requested.
If the wrapper reports `SKIP_INCOMPATIBLE` with `timed_out: true` and
`no_stdout: true`, the CLI produced no output before the deadline. Current
`cursor-agent` has no non-LLM plugin list; `--plugin-dir` plus `--mode ask`
starts a full session that can hang. That is a CLI limitation, not a package
failure. If the wrapper reports `BLOCKED` with `timed_out: true` or
`output_limited: true`, no consumer result was produced; retain the bounded,
redacted diagnostic and rerun only with another finite limit.
The wrapper also blocks an empty, invalid, or capability-negative response;
only a response containing the requested dhpk skills, commands, agents, and
rules evidence can be recorded as a completed probe.
If the installed CLI has no `--plugin-dir`, record `UNAVAILABLE`. Cursor
desktop GUI, Customize → Plugins, the desktop `cursor` binary, and
project-local `.cursor/` installation remain setup or installer evidence only;
they do not substitute for logged-in `cursor-agent` runtime proof.

For a persistent local setup for Cursor desktop, use symlinks or copies under
`~/.cursor/plugins/local/`. The CLI probe still passes these paths explicitly;
restart the Cursor desktop/session after updates:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/dhpk/dist/on-demand/dhpk-agent ~/.cursor/plugins/local/dhpk-agent
ln -s /absolute/path/to/dhpk/dist/on-demand/dhpk-cursor ~/.cursor/plugins/local/dhpk-cursor
```

Check that each target is absent before creating a link; do not overwrite an
existing user-owned plugin. Rollback removes only the two dhpk links.

## Cursor Plugin (native components)

Prerequisites: a Cursor desktop client whose loader supports the native
manifest/components and a recorded Cursor version; no minimum version has been
verified.

The native projection is `dist/on-demand/dhpk-cursor/` with
`.cursor-plugin/plugin.json`. Download `dhpk-cursor-<version>.tar.gz` from the
GitHub Release (extract it beside `dhpk-agent`), or build it with
`bin/dhpk distribution build cursor-plugin`. For local testing:

```bash
mkdir -p ~/.cursor/plugins/local
cp -R dist/on-demand/dhpk-cursor ~/.cursor/plugins/local/dhpk-cursor
```

Alternatively use a reviewed `.cursor-plugin/marketplace.json` source. Reload
Cursor, configure variables without committing credentials, then verify the
selected `rules/`, `agents/`, and `hooks/hooks.json`. Native
agents locate prompt-defense, trap sheets, and execution policy inside this
package with `${CURSOR_PLUGIN_ROOT}`. They do not read a project-local
`.cursor/dhpk/` tree. External worker adapters resolve through the
co-installed sibling `dhpk-agent` skill store
(`${CURSOR_PLUGIN_ROOT}/../dhpk-agent/skills/...`). Portable
skills are deliberately not copied into this native package: install
`dist/on-demand/dhpk-agent/` as the single physical skill store and compare its
`provenance.json` stable IDs with the Cursor receipt. Do not hand-create a
second `skills/` directory. Only an explicit environment-specific matrix
overlay may add Cursor `skills/`, and that overlay records its transform and
independent fingerprint. Unsupported component types are `SKIP_INCOMPATIBLE`
with the matrix fallback; missing Cursor tooling is `UNAVAILABLE`.

Rollback removes or restores only `~/.cursor/plugins/local/dhpk-cursor` and its
Cursor-owned receipt. It must not remove Codex, Claude, project-owned Cursor
files, or the portable `dhpk-agent` package.

## Cursor project-local sync (Supported)

Prerequisites: the Cursor project-local loader, a POSIX shell, and the
schema-v3 receipt contract from the Cursor project-local row above. The client
version is not established until release evidence records it.

Keep this route distinct from `dist/on-demand/dhpk-cursor/` (marketplace / user-scoped
plugin). Project-local files live in the consumer `.cursor/` tree after the
installer runs. Native `.cursor/hooks.json` mapping is out of v1; this
installer never writes `hooks.json`. Cursor may still load Claude hooks from
`.claude/settings.json` when Third-party skills are enabled — that is an
optional compatibility path, not the supported owner.

The supported version SSOT is the local packages
`~/.cursor/plugins/local/dhpk-agent` and
`~/.cursor/plugins/local/dhpk-cursor` plus the project-local schema-v3
receipt at `.cursor/.dhpk-installed.json`. Cursor may also keep a
marketplace hash cache at `~/.cursor/plugins/cache/dhpk/dhpk/<hash>/`.
That cache can remain on an older `plugin.json` version after local
packages update; it is not SSOT. Do not treat it as the installed
version. `install-cursor-harness.sh --update --plan --json` reports
`warnings[].code = cursor_marketplace_hash_cache_drift` when a cache
manifest version differs from the local packages or the planned
`plugin_version`. Disable or remove the marketplace dhpk plugin in the
Cursor UI and keep the local packages plus the project-local receipt.
Do not hand-delete the hash cache unless Cursor has already uninstalled
that marketplace plugin.

Run from the project root. Cursor project-local sync requires a repository
checkout; an installed Claude plugin does not include `cursor/`. The
standalone checkout form is:

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh
```

The installer uses the project-root heuristic, creates relative symlinks by
default, and supports `--copy` for a physical portable projection:

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh --copy
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh --update
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh --migrate --update
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh --uninstall
```

New Cursor installs also use `common`, retain additive `--skill` overlays, and reject public `--profile` flags. Historical named-profile receipts preserve exact stored scope for read, plan, uninstall, and recovery; update is `BLOCKED` before mutation. Unannotated older receipts retain the existing structural migration route. Unknown, retired, deprecated, duplicate, or surface-incompatible IDs in new selections fail before changing `.cursor/`.

`--force` bypasses only the project-root heuristic. It never bypasses receipt
ownership or path safety. The schema-v3 receipt records stable ID, public name,
destination, source, mode, and fingerprint. Edited, user-owned, retargeted,
malformed, ambiguous, or colliding files are preserved and reported.
`--update` without `--adopt` exits non-zero while any reported collision
remains, so a partial receipt cannot be mistaken for a current projection.

The Cursor receipt and journals follow the same `fingerprint_algorithm` rules as
the Codex receipt above (same installer program).

For a stale or unowned projection, inspect before changing anything:

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh \
  --update --plan --json
```

Planning is read-only. If an owner approves one exact collision, copy both
reported fingerprints into an explicit adoption request. Omit `--copy`: the
installer preserves the receipt's existing projection mode so unrelated managed
entries are not rematerialized:

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh \
  --update \
  --adopt='skills/flow-guide@<destination-fingerprint>@<source-fingerprint>'
```

Adoption is path-scoped and creates a rollback-addressable backup before
promotion. If the fingerprint changed since planning, the command fails before
mutation; run a fresh plan. Review `.cursor/.dhpk-installed.json` before
treating the projection as current.

Verify the consumer projection from the consumer project root:

```bash
test -f .cursor/.dhpk-installed.json
```

Run source-check validators from the dhpk checkout. Set `DHPK_ROOT` to the
checkout that owns `scripts/` and `tests/`; these files are not copied into the
consumer project:

```bash
DHPK_ROOT=/absolute/path/to/dhpk
node "$DHPK_ROOT/scripts/ci/validate-cursor-sync.js"
node "$DHPK_ROOT/tests/install-cursor-harness.test.js"
```

Rollback is `--uninstall` or restoration of a saved `.cursor/` receipt. Do not
delete the whole `.cursor/` directory. `dhpk-install cursor install|update|uninstall
--project-root <dir>` runs the same installer as this bash script.

## AGY / Antigravity CLI plugin (Experimental)

The AGY projection is a separate owner-scoped package. It adapts canonical
agent frontmatter into the package and does not edit the canonical `agents/`
tree. Generated agents locate prompt-defense and trap sheets at
plugin-relative `agent-traps/` paths inside this package. Those paths do not
use `${CLAUDE_PLUGIN_ROOT}`. The package is not committed: download
`dhpk-agy-<version>.tar.gz` from the GitHub Release and extract it, or build it
from a clean clone with `bin/dhpk distribution build agy-plugin`, which writes
the ignored `dist/on-demand/dhpk-agy/` directory. Install that built package
directly:

```bash
node scripts/ci/install-agy-plugin.js install \
  --source dist/on-demand/dhpk-agy \
  --json
```

### AGY install-path contract

The path contract is versioned in `manifests/distribution-inventory.json`.
The canonical AGY 1.2.x path is
`$HOME/.gemini/antigravity-cli/plugins/dhpk/`; the earlier
`$HOME/.gemini/config/plugins/dhpk/` path is retained as a legacy candidate for
read-only detection and explicit migration. The observed AGY 1.2.2 probe
loaded agents from both layouts, so the legacy path is not silently discarded,
but new default installations always use the canonical path.

Evidence (agy 1.4.12, probed 2026-11-01): `agy agents` listed all 29
agents of the receipt-owned copy installed at that time, which predates
`qa-executor` and `docs-writer` (the current package has 31), from `~/.gemini/antigravity-cli/plugins/dhpk/`, while
`agy plugin list` returned `[]`, which is expected for a receipt-owned install.
An agent declaring `model: flash_lite` ran successfully at runtime even though
the vendor subagent page lists only `inherit`, `flash`, and `pro`. Agents that
declare MCP tools whose server is not registered in agy fail to start, so the
generated package drops every MCP tool whose server it does not declare.

Default `plan` and `status` are read-only. A receipt-owned legacy installation
is reported as `LEGACY_OWNED`; if both canonical and legacy candidates exist,
the result is `BLOCKED` with `AMBIGUOUS_TARGETS`. No read-only command adopts,
deletes, or overwrites a target:

```bash
node scripts/ci/install-agy-plugin.js plan --source dist/on-demand/dhpk-agy --json
node scripts/ci/install-agy-plugin.js status --source dist/on-demand/dhpk-agy --json
```

To move a receipt-owned legacy installation, use the explicit transactional
migration action. It stages and verifies the canonical package before removing
the legacy receipt-owned files; a promotion or removal failure rolls back the
canonical target and preserves the legacy target:

```bash
node scripts/ci/install-agy-plugin.js migrate \
  --source dist/on-demand/dhpk-agy --json
```

Use `--target <dir>` only when an owner intentionally operates on a specific
target. Explicit targets are never inferred as canonical and still undergo the
same receipt, collision, physical-path, and rollback checks.

Maintainers may build and validate the package from a clean checkout (the build
also writes the release archive beside it):

```bash
bin/dhpk distribution build agy-plugin --version=0.84.0 --json
bin/dhpk distribution agy-plugin validate --json
```

For local generation that must not change the checkout, use an external staging
path and validate/install that same package:

```bash
bin/dhpk distribution agy-plugin generate \
  --output /tmp/dhpk-agy-staging --version=<version> --json
bin/dhpk distribution agy-plugin validate \
  --output /tmp/dhpk-agy-staging --json
node scripts/ci/install-agy-plugin.js install \
  --source /tmp/dhpk-agy-staging \
  --json
```

Install, update, and remove only the receipt-owned package at the documented
user path. A target containing a foreign file or a changed owned file is a
collision and is left untouched:

```bash
node scripts/ci/install-agy-plugin.js install \
  --source dist/on-demand/dhpk-agy --json
node scripts/ci/install-agy-plugin.js update \
  --source dist/on-demand/dhpk-agy --json
node scripts/ci/install-agy-plugin.js plan \
  --source dist/on-demand/dhpk-agy --json
node scripts/ci/install-agy-plugin.js status \
  --source dist/on-demand/dhpk-agy --json
node scripts/ci/install-agy-plugin.js rollback \
  --json
```

`plan` and `status` are read-only. They report source/target versions, receipt
ownership, a physical `.git` marker, and bounded same/changed/missing file
evidence. A physical Git checkout without a matching AGY receipt is classified
`FOREIGN_CHECKOUT` and returns `BLOCKED`; the owner must independently back up,
move, or retire that checkout before a clean install. The diagnostic never
migrates, adopts, overwrites, or removes a foreign target.

Use the existing [consumer-gate](../scripts/release/consumer-gate.js) and AGY adapter for installation and required-resource evidence. Validate the generated AGY native plugin package structure with:

```bash
bin/dhpk distribution agy-plugin validate --json
```

This command reports deterministic package structure; native runtime remains `NOT_RUN`. The `agy-project` platform probe applies to a consumer project root containing a valid shared projection and receipt.

Native discovery, model execution, and Subagent runtime run only for a corresponding integration change or explicit request. Unexecuted observations remain `NOT_RUN`, and missing capabilities remain non-pass. A receipt, static manifest, or discovery listing is not runtime `PASS`. Historical AGY 1.1.13 loader observations retain their recorded evidence state. Rollback/uninstall removes only unchanged receipt-owned files and preserves user-owned and foreign content.

## Maintainer evidence

Every generated surface records release version, source commit/tag, inventory
digest, generator version, stable IDs, public names, transforms, and physical
fingerprints. Release evidence also records client versions, installation
route, probe result, and every unexecuted gate. See the versioned normative
specifications under `openspec/specs/` (especially
`agy-cli-subagent-plugin/spec.md` and `platform-installation-documentation/spec.md`) and the
[distribution surface guide](./distribution-surfaces.md).

<a id="cross-version-release-rehearsal"></a>

### Cross-version release rehearsal (`v(N-1)` -> `HEAD`)

Every release candidate exercises cross-version upgrade and rollback via
`scripts/release/release-rehearsal.js` (also invoked by
`scripts/release/release-verify.sh --mode dry-run --rehearse-upgrade`,
`schema: dhpk.release-rehearsal.v1`):

```bash
node scripts/release/release-rehearsal.js \
  --repo-root /path/to/dhpk \
  --offline \
  --json
```

The rehearsal automatically resolves the prior release tag `v(N-1)` from full
Git history (or accepts `--prior-tag <vX.Y.Z>`), materializes a clean baseline
checkout, and exercises `v(N-1)` -> `HEAD` upgrade, idempotent rerun, rollback,
`generated/` -> `dist/` marketplace path migration, Cursor local plugin link
validation, AGY Package Receipt update/rollback, and dual-layer Duplicate
Discovery. `--offline` honestly preserves live probe outcomes as `NOT_RUN` /
`UNAVAILABLE` rather than synthesizing `PASS`; pass `--execute-live` only when
live CLI probes are explicitly authorized. Pass `--out-file <path>` to write
the report with `0600` permissions.
