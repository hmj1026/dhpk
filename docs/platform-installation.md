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
| Cursor project-local sync | From a checkout: `bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh`; inside a Claude plugin: `bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh"` | `--update`, `--migrate`, `--uninstall`; `--force` only bypasses the project-root heuristic | `.cursor/.dhpk-installed.json` schema-v3, `.mdc` rules, managed entries | Supported Cursor project-local path; native hooks are out of v1; install does not prove runtime callability |
| Cursor CLI launch-scoped probe | `cursor-agent --plugin-dir <agent-package> --plugin-dir <cursor-package>` after login | No persistent CLI install; update the source package or local symlink, then start a new session | `cursor-agent --version`, `cursor-agent status`, and a read-only `--mode ask` probe | Experimental/conditional: CLI help exposes the flag, but official CLI docs do not establish plugin component discovery; release probes use an isolated shared-network bubblewrap namespace, never unrestricted execution |
| AGY native plugin | Generate `plugins/dhpk-agy/`, then receipt-owned install to `~/.gemini/config/plugins/dhpk/` | `install-agy-plugin.js update`, `uninstall`, or `rollback`; foreign files are preserved and collisions fail closed | AGY package validator; `agy plugins list` is import-only; isolated `agy agents` is native load; optional bounded Subagent probe | Experimental: package/discovery evidence is separate from runtime; absent `agy` is `UNAVAILABLE` |

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
| Cursor project-local sync | Cursor project-local loader; schema-v3 receipt; minimum Cursor version not established | Linux, macOS, or WSL with a POSIX shell, run from the project root | `bash`, `git`; Node.js is needed only for validators | Run the installer, inspect `.cursor/.dhpk-installed.json`, and run the listed installer test; do not treat a missing live Cursor client as a runtime `PASS` |
| Cursor CLI launch-scoped probe | `cursor-agent` available on `PATH`; record `cursor-agent --version`; authenticate with `cursor-agent login`; minimum version not established | Linux, macOS, or WSL POSIX shell | `cursor-agent`, `--plugin-dir`, a logged-in Cursor session, and verified bubblewrap on Linux; Node.js only for package validation | Experimental/conditional: run `cursor-agent status`, then a read-only probe; unauthenticated output is `BLOCKED`, missing CLI/sandbox is `UNAVAILABLE`/`BLOCKED`, and discovery must be recorded separately; API-key-only auth is not accepted |
| AGY native plugin | `agy` version and supported AGY model/tool enum are not pinned; record `agy --version` when available | Linux, macOS, or WSL POSIX shell; install root is user-scoped | Node.js, `git`, generated package, and optional `agy` CLI | Run structural validation first; `agy plugins list` is import-only and isolated `agy agents` is native load; runtime remains `NOT_RUN` unless `--agy-runtime-probe` is explicitly used |

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

## Unified lifecycle CLI (read-only slice)

`dhpk-install <surface> <action>` is the common lifecycle entrypoint. The
accepted surfaces are `claude`, `codex-sync`, `codex-native`, `agent-plugin`,
`cursor`, and `agy-plugin`; actions are `plan`, `install`, `verify`, `update`, `uninstall`,
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
the supported `install-codex-skills.sh` route for Codex project-local writes and
`install-cursor-harness.sh` for Cursor project-local writes until those adapters
are migrated through the same ArtifactStore transaction.

## Unified distribution CLI

`bin/dhpk distribution <surface> <operation>` is the single deterministic
package boundary for the retained native package surfaces: `agent-plugin`,
`cursor-plugin`, `codex-native`, and `agy-plugin`. Its operations are
`generate`, `validate`, and `verify`; each JSON result records structural
evidence and deliberately returns `runtime: NOT_RUN` unless a separate
client-specific probe is executed.

```bash
bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=0.50.5 --json
bin/dhpk distribution agy-plugin validate --json
```

## Codex project-local sync (Supported)

Prerequisites: the Codex project-local loader, a POSIX shell, and the
schema-v3 receipt contract from the first row above. The client version is not
established until release evidence records it.

Run from the project root. The standalone checkout form is:

```bash
bash /path/to/dhpk/scripts/hooks/install-codex-skills.sh
```

Inside the Claude plugin runtime use `${CLAUDE_PLUGIN_ROOT}`. The installer
uses the project-root heuristic and a hybrid default: skills and supporting
assets are relative symlinks, while `.codex/agents/*.toml` are always physical
files because Codex must load them as configuration layers. `--copy` makes the
entire projection physical:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --copy
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --migrate --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --uninstall
```

The unified distribution/lifecycle installers use the inventory-owned
`minimal` profile (inventory `required_core_ids`). The retained project-local Codex
compatibility route keeps `compat-v1` by default; select `minimal` explicitly
when migrating that route or add stable-ID overlays:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --profile minimal
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --profile full --skill git-smart-commit
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" --profile minimal --skill bug-investigation --skill tdd
```

An existing receipt without profile metadata remains `compat-v1`; changing it
to a smaller profile requires `--migrate --update`. The receipt records the
canonical and surface-emitted IDs plus selection fingerprints, while unavailable
consumer probes remain non-pass evidence.

For an existing schema-v3 symlink projection, ordinary `--update` converts
unchanged receipt-owned agent links to physical files and leaves skill links in
place. Retargeted, edited, or unowned agent paths remain collisions and are not
overwritten.

`--force` bypasses only the project-root heuristic. It never bypasses receipt
ownership or path safety. The schema-v3 receipt records stable ID, public name,
destination, source, mode, and fingerprint. Edited, user-owned, retargeted,
malformed, ambiguous, or colliding files are preserved and reported.
`--update` without `--adopt` exits non-zero while any reported collision
remains, so a partial receipt cannot be mistaken for a current projection.

For a stale or unowned projection, inspect before changing anything:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" \
  --update --plan --json
```

Planning is read-only. If an owner approves one exact collision, copy both
reported fingerprints into an explicit adoption request. Omit `--copy`: the
installer preserves the receipt's existing projection mode so unrelated managed
entries are not rematerialized:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh" \
  --update \
  --adopt='skills/dhpk-cross-agent-sync@<destination-fingerprint>@<source-fingerprint>'
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

Project-local sync and the experimental native package are separate acquisition
surfaces. A host that discovers both can show one public skill name twice even
when both entries are intentional. Run this read-only check from the consumer
project root after setting `DHPK_ROOT` to the source checkout:

```bash
node "$DHPK_ROOT/scripts/ci/check-codex-discovery.js" \
  --repo-root "$DHPK_ROOT" \
  --project-root "$PWD" \
  --native-root "$DHPK_ROOT/plugins/dhpk"
```

The registry groups entries by `kind:publicName`. Identical fingerprints are
reported as one `effective` entry with both providers retained. Different
fingerprints require a current, receipt-owned precedence; otherwise the check
returns `BLOCKED`. A current project-local entry explicitly taking precedence
over an experimental native entry returns `WARN`. The command only reports
evidence; it does not delete a projection, cache, or host registration. Resolve
a `BLOCKED` result by inspecting the receipt and choosing one supported route
before running an update or uninstall action.

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

## Cursor project-local sync (Supported)

Prerequisites: the Cursor project-local loader, a POSIX shell, and the
schema-v3 receipt contract from the Cursor project-local row above. The client
version is not established until release evidence records it.

Keep this route distinct from `plugins/dhpk-cursor/` (marketplace / user-scoped
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

Run from the project root. The standalone checkout form is:

```bash
bash /path/to/dhpk/scripts/hooks/install-cursor-harness.sh
```

Inside the Claude plugin runtime use `${CLAUDE_PLUGIN_ROOT}`. The installer
uses the project-root heuristic, creates relative symlinks by default, and
supports `--copy` for a physical portable projection:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --copy
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --migrate --update
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" --uninstall
```

Cursor sync accepts the same profile and additive overlay flags. New installs
default to `minimal`; an unannotated existing receipt stays on `compat-v1` until
an explicit `--migrate` is supplied. The installer rejects unknown, retired,
deprecated, duplicate, or surface-incompatible IDs before changing `.cursor/`.

`--force` bypasses only the project-root heuristic. It never bypasses receipt
ownership or path safety. The schema-v3 receipt records stable ID, public name,
destination, source, mode, and fingerprint. Edited, user-owned, retargeted,
malformed, ambiguous, or colliding files are preserved and reported.
`--update` without `--adopt` exits non-zero while any reported collision
remains, so a partial receipt cannot be mistaken for a current projection.

For a stale or unowned projection, inspect before changing anything:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" \
  --update --plan --json
```

Planning is read-only. If an owner approves one exact collision, copy both
reported fingerprints into an explicit adoption request. Omit `--copy`: the
installer preserves the receipt's existing projection mode so unrelated managed
entries are not rematerialized:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-cursor-harness.sh" \
  --update \
  --adopt='skills/dhpk-cross-agent-sync@<destination-fingerprint>@<source-fingerprint>'
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
delete the whole `.cursor/` directory. `dhpk-install cursor` writes remain
`NOT_IMPLEMENTED`; the supported write path is this bash installer.

## AGY / Antigravity CLI plugin (Experimental)

The AGY projection is a separate owner-scoped package. It adapts canonical
agent frontmatter and never rewrites `agents/`. Generate and validate it from
the dhpk checkout:

```bash
bin/dhpk distribution agy-plugin generate --output plugins/dhpk-agy --version=0.50.5 --json
bin/dhpk distribution agy-plugin validate --json
```

Install, update, and remove only the receipt-owned package at the documented
user path. A target containing a foreign file or a changed owned file is a
collision and is left untouched:

```bash
node scripts/ci/install-agy-plugin.js install \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js update \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js plan \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js status \
  --source plugins/dhpk-agy \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
node scripts/ci/install-agy-plugin.js rollback \
  --target "$HOME/.gemini/config/plugins/dhpk" --json
```

`plan` and `status` are read-only. They report source/target versions, receipt
ownership, a physical `.git` marker, and bounded same/changed/missing file
evidence. A physical Git checkout without a matching AGY receipt is classified
`FOREIGN_CHECKOUT` and returns `BLOCKED`; the owner must independently back up,
move, or retire that checkout before a clean install. The diagnostic never
migrates, adopts, overwrites, or removes a foreign target.

Run configured-platform validation separately from package validation:

```bash
python3 skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py \
  --root . validate --targets agy --format json
agy --version
agy plugins list
agy agents
```

AGY runtime prerequisites are an `agy` CLI, the currently supported `bwrap`
POSIX sandbox backend, and an explicitly supplied `DHPK_AGY_HOST_HOME` that
contains one of the allowlisted login files. The runtime probe clones only
those files into a disposable HOME, mounts the package read-only, and enables
network sharing only for the runtime invocation. Missing login is `BLOCKED`;
missing `agy` or `bwrap` is `UNAVAILABLE`; runtime is `NOT_RUN` unless
`--agy-runtime-probe` is explicitly used. Runtime diagnostics are bounded and
redacted, and no host credential contents are recorded. AGY free-form client
output is reduced to a fixed reason-class placeholder, so private paths,
prompts, tool payloads, and host overlay markers are not persisted.

`agy plugins list` reports import records only. A native receipt-owned package
at `~/.gemini/config/plugins/dhpk` is discovered by isolated `agy agents`, not
by matching `dhpk` in the import JSON. The validator mounts the package at that
consumer path inside a read-only sandbox HOME. On AGY 1.1.13, isolated
`agy agents` stays empty because the CLI has no native filesystem plugin
loader; that pair is `SKIP_INCOMPATIBLE`, not a package-shape `FAIL`. Do not
run `agy plugin install` against a receipt-owned target: it is not a native
registration step and can truncate `plugin.json`.

The report keeps package structure, plugin/agent discovery, and Subagent
runtime as independent rows. If `agy` is absent, discovery is `UNAVAILABLE`;
without `--agy-runtime-probe`, runtime remains `NOT_RUN`. When the CLI is
available, the opt-in probe is bounded and read-only:

```bash
python3 skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py \
  --root . validate --targets agy --agy-runtime-probe --format json
```

Do not promote a static manifest, `agy agents` listing, or a foreign-checkout
diagnostic to runtime `PASS`.
Rollback/uninstall removes only files matching the AGY provenance receipt and
preserves user-owned files in the plugin directory.

## Maintainer evidence

Every generated surface records release version, source commit/tag, inventory
digest, generator version, stable IDs, public names, transforms, and physical
fingerprints. Release evidence also records client versions, installation
route, probe result, and every unexecuted gate. See the versioned normative
specifications under `openspec/specs/` (especially
`agy-cli-subagent-plugin/spec.md` and `platform-installation-documentation/spec.md`) and the
[distribution surface guide](./distribution-surfaces.md).
