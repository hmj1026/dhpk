# Platform installation

> **Languages**: **English** · [繁體中文](./platform-installation.zh-TW.md)

This is the installation and support-status SSOT for dhpk distribution
surfaces. A package or manifest is structural evidence only; a client is
callable only after the named consumer probe discovers the projected content.

## Surface matrix

| Surface | Install | Update / remove | Verify | Support boundary |
|---|---|---|---|---|
| Codex project-local sync | From a checkout: `bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh`; inside a Claude plugin: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"` | `--update`, `--migrate`, `--uninstall`; `--force` only bypasses the project-root heuristic | `.codex/.dhpk-installed.json` schema-v3, managed entries, `$dhpk-<name>` discovery | Supported Codex path; install does not prove runtime callability |
| Codex legacy/native | `codex plugin marketplace add <repo-or-path>` then `codex plugin add dhpk@dhpk` where the real CLI supports it | Client marketplace commands; regenerate from source and check provenance | `plugins/dhpk/.codex-plugin/plugin.json`, physical `skills/`, provenance/fingerprints, real CLI probe | Experimental; missing CLI/route is `UNAVAILABLE` or `BLOCKED` |
| Standard Agent Plugin | Publish or install `plugins/dhpk-agent/` through a verified client route | Client-owned update/remove; replace only the generated package | Root `plugin.json`, Agent Plugins schema, fixed `skills/`, optional `mcp.json`, provenance | Structural conformance is not Codex runtime proof |
| Cursor standard Agent Plugin | Cursor Customize/Plugins, or local `~/.cursor/plugins/local/dhpk-agent` | Cursor reload/update/remove or replace that local package | Root `plugin.json`, discovered portable skills/MCP, client version | Portable skills/MCP only; no Cursor-native parity claim |
| Cursor Plugin | Local `~/.cursor/plugins/local/dhpk-cursor`, or reviewed `.cursor-plugin/marketplace.json` source; install `plugins/dhpk-agent/` alongside it for shared portable skills | Cursor refresh/update/remove; rollback Cursor-owned files only; update the shared Agent package separately | `.cursor-plugin/plugin.json`, rules, agents, commands, hooks, variables, shared-skill IDs | Native components require Cursor evidence; shared portable skills are owned by `dhpk-agent`; gaps are `SKIP_INCOMPATIBLE` |
| Cursor CLI launch-scoped probe | `cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package>` after login | No persistent CLI install; update the source package or local symlink, then start a new session | `cursor-agent --version`, `cursor-agent status`, and a read-only `--mode ask` probe | Experimental/conditional: CLI help exposes the flag, but official CLI docs do not establish plugin component discovery; marketplace indexing is not a non-interactive install command |

## Prerequisites and version assumptions

The route sections below use the corresponding row. This repository records
package and schema versions, but it has not verified a minimum consumer-client
version. Release evidence must record the actual client version and probe
result; do not infer a runtime `PASS` from a package check.

| Route | Client/version assumption | OS and shell assumption | Required tooling | Evidence gate |
|---|---|---|---|---|
| Codex project-local sync | Codex project-local loader; schema-v3 receipt; minimum Codex version not established | Linux, macOS, or WSL with a POSIX shell, run from the project root | `bash`, `git`; Node.js is needed only for validators | Run the installer, inspect `.codex/.dhpk-installed.json`, and run the listed metadata/test commands |
| Codex legacy/native | Codex CLI with marketplace/plugin commands; run `codex --version`; minimum CLI version not established | Linux, macOS, or WSL shell for the documented route | `codex`, marketplace access, `git` | Execute the marketplace route and record CLI output; absent CLI/route is `UNAVAILABLE` or `BLOCKED` |
| Standard Agent Plugin | Agent Plugins 1.0.0 schema consumer; minimum client version not established | Client-supported OS; package validation is performed from a POSIX shell | A verified Agent Plugin loader; Node.js for structural validation | Run both package commands, then record client discovery evidence |
| Cursor standard Agent Plugin | Cursor desktop/plugin loader that accepts the portable package; record Cursor version; minimum version not established | A Cursor-supported desktop OS; local path is `~/.cursor/plugins/local/` | Cursor Customize → Plugins or its local loader; Node.js for validation only | Observe discovered skills/MCP after reload; no loader is `UNAVAILABLE` or `BLOCKED` |
| Cursor Plugin (native) | Cursor plugin loader supporting `.cursor-plugin/plugin.json`; record Cursor version; install the standard `dhpk-agent` package for shared portable skills; minimum version not established | A Cursor-supported desktop OS; local path is `~/.cursor/plugins/local/` | Cursor reload/UI, local filesystem, and secret-free variable configuration; compare shared IDs with Agent provenance | Observe each selected native component and hook behavior after reload; an explicit matrix overlay is the only reason for a Cursor `skills/` directory |
| Cursor CLI launch-scoped probe | `cursor-agent` available on `PATH`; record `cursor-agent --version`; authenticate with `cursor-agent login`; minimum version not established | Linux, macOS, or WSL POSIX shell | `cursor-agent`, `--plugin-dir`, and a Cursor account/API key; Node.js only for package validation | Experimental/conditional: run `cursor-agent status`, then a read-only probe; unauthenticated output is `BLOCKED`, missing CLI is `UNAVAILABLE`, and discovery must be recorded separately |

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

## Unified lifecycle CLI (read-only slice)

`dhpk-install <surface> <action>` is the common lifecycle entrypoint. The
accepted surfaces are `claude`, `codex-sync`, `codex-native`, `agent-plugin`,
and `cursor`; actions are `plan`, `install`, `verify`, `update`, `uninstall`,
`rollback`, and `status`. This initial slice enables deterministic read-only
`plan`, `status`, and `verify` result construction only. For example:

```bash
dhpk-install cursor plan --scope project --json
```

When running from a source checkout, invoke the bundled entrypoint directly:
`bash /path/to/dhpk/bin/dhpk-install cursor plan --scope project --json`.

The JSON result binds the normalized request to a compiler plan and keeps the
closed projection evidence vocabulary separate from lifecycle presentation.
`INSTALL_PASS + CONSUMER_BLOCKED` is never a projection `PASS` and cannot
promote a support tier. Write actions currently return `BLOCKED` with the
stable `NOT_IMPLEMENTED` diagnostic before any mutation. In particular, retain
the supported `install-codex-skills.sh` route and its schema-v3 receipt for
Codex project-local writes until that adapter is migrated through the same
ArtifactStore transaction.

## Codex project-local sync (Supported)

Prerequisites: the Codex project-local loader, a POSIX shell, and the
schema-v3 receipt contract from the first row above. The client version is not
established until release evidence records it.

Run from the project root. The standalone checkout form is:

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh
```

Inside the Claude plugin runtime use `${CLAUDE_PLUGIN_ROOT}`. The installer
uses the project-root heuristic, creates relative symlinks by default, and
supports `--copy` for a physical portable projection:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --copy
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --migrate --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --uninstall
```

`--force` bypasses only the project-root heuristic. It never bypasses receipt
ownership or path safety. The schema-v3 receipt records stable ID, public name,
destination, source, mode, and fingerprint. Edited, user-owned, retargeted,
malformed, ambiguous, or colliding files are preserved and reported.

Verify the consumer projection from the consumer project root:

```bash
test -f .codex/.dhpk-installed.json
```

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

## Codex legacy/native package (Experimental)

Prerequisites: a real `codex` CLI with the marketplace route, a POSIX shell,
and a recorded `codex --version`; no minimum CLI version has been verified.

The retained native artifact is generated at `plugins/dhpk/` and uses the
legacy `.codex-plugin/plugin.json` contract. Where supported by the real CLI:

```bash
codex plugin marketplace add <repo-or-path>
codex plugin add dhpk@dhpk
```

The local marketplace must be configured by the consumer. Check the physical
package, `fingerprints.json`, `provenance.json`, and the exact client version
before describing an install as evidence. If `codex` or the marketplace route
is missing, record `UNAVAILABLE`/`BLOCKED`; retain the project-local sync path.
The legacy manifest is never counted as proof of Agent Plugins conformance.

## Standard Agent Plugin

Prerequisites: a client implementing the Agent Plugins 1.0.0 schema and a
verified loader route; no minimum client version has been verified.

`plugins/dhpk-agent/` has one root `plugin.json` with the Agent Plugins 1.0.0
schema, immediate-child `skills/` directories, and optional schema-versioned
`mcp.json`. Claude/Codex invocation policy remains in client-owned metadata;
portable skill frontmatter contains only standard fields and nested metadata.

Install only through a route verified for the target client. Structural checks:

```bash
node scripts/ci/validate-agent-plugin-package.js plugins/dhpk-agent
node scripts/ci/verify-platform-packages.js
```

These checks prove package shape, containment, deterministic fingerprints, and
provenance. They do not prove Codex or Cursor runtime discovery.

## Cursor standard Agent Plugin

Prerequisites: a Cursor desktop client with the local plugin loader and a
recorded Cursor version; no minimum version has been verified.

Cursor can consume `plugins/dhpk-agent/` for portable skills and optional MCP:

1. Open Cursor **Customize → Plugins** and choose the reviewed local package,
   or copy it to `~/.cursor/plugins/local/dhpk-agent`.
2. Reload the window.
3. Verify the discovered skill names and MCP entries in Cursor's plugin view.

Record the Cursor version and probe output. Without a supported local loader or
CLI, keep the result `UNAVAILABLE`/`BLOCKED`; never claim native rules,
commands, agents, or hooks from this package.

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

Prerequisites: a recorded `cursor-agent --version`, a logged-in Cursor CLI (or
an API key), and both dhpk packages available locally. Check authentication
before the probe:

```bash
cursor-agent --version
cursor-agent status
cursor-agent login  # only when status reports Not logged in
```

For a launch-scoped, read-only probe, pass both package directories explicitly:

```bash
cursor-agent \
  --plugin-dir "$HOME/.cursor/plugins/local/dhpk-agent" \
  --plugin-dir "$HOME/.cursor/plugins/local/dhpk-cursor" \
  --mode ask \
  -p 'List the dhpk skills, commands, agents, and rules you discover. Do not edit files.' \
  --output-format json
```

Record the exact CLI version, authentication status, package paths, and probe
output. A successful package validator proves structure and provenance only;
runtime `PASS` requires the CLI or Cursor UI to discover the projected content;
until then keep the CLI route `NOT_RUN` or `BLOCKED`. If the CLI reports
`Authentication required`, the evidence is `BLOCKED` until login is completed.
If the installed CLI has no `--plugin-dir`, record `UNAVAILABLE` and use the
Cursor UI/local-plugin route instead.

For a persistent local setup for Cursor desktop, use symlinks or copies under
`~/.cursor/plugins/local/`. The CLI probe still passes these paths explicitly;
restart the Cursor desktop/session after updates:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/dhpk/plugins/dhpk-agent ~/.cursor/plugins/local/dhpk-agent
ln -s /absolute/path/to/dhpk/plugins/dhpk-cursor ~/.cursor/plugins/local/dhpk-cursor
```

Check that each target is absent before creating a link; do not overwrite an
existing user-owned plugin. Rollback removes only the two dhpk links.

## Cursor Plugin (native components)

Prerequisites: a Cursor desktop client whose loader supports the native
manifest/components and a recorded Cursor version; no minimum version has been
verified.

The native projection is `plugins/dhpk-cursor/` with
`.cursor-plugin/plugin.json`. For local testing:

```bash
mkdir -p ~/.cursor/plugins/local
cp -R plugins/dhpk-cursor ~/.cursor/plugins/local/dhpk-cursor
```

Alternatively use a reviewed `.cursor-plugin/marketplace.json` source. Reload
Cursor, configure variables without committing credentials, then verify the
selected `rules/`, `agents/`, `commands/`, and `hooks/hooks.json`. Portable
skills are deliberately not copied into this native package: install
`plugins/dhpk-agent/` as the single physical skill store and compare its
`provenance.json` stable IDs with the Cursor receipt. Do not hand-create a
second `skills/` directory. Only an explicit environment-specific matrix
overlay may add Cursor `skills/`, and that overlay records its transform and
independent fingerprint. Unsupported component types are `SKIP_INCOMPATIBLE`
with the matrix fallback; missing Cursor tooling is `UNAVAILABLE`.

Rollback removes or restores only `~/.cursor/plugins/local/dhpk-cursor` and its
Cursor-owned receipt. It must not remove Codex, Claude, project-owned Cursor
files, or the portable `dhpk-agent` package.

## Maintainer evidence

Every generated surface records release version, source commit/tag, inventory
digest, generator version, stable IDs, public names, transforms, and physical
fingerprints. Release evidence also records client versions, installation
route, probe result, and every unexecuted gate. See the normative specifications
under `openspec/changes/archive/2026-08-12-align-agent-plugin-platform-support/specs/` and the
[distribution surface guide](./distribution-surfaces.md).
