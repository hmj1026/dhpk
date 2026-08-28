---
name: dhpk-cli-dispatch-context
description: "Internal CLI dispatch-context builder and public launcher that resolve provider-qualified role identity and emit an immutable attested context."
---
# Internal CLI dispatch context

Build the `dhpk.cli.context.v1` descriptor before an adapter starts a provider.
Use the canonical role resolver with the requested provider and mode; retain
both requested and effective role identity, and preserve the resolver's
one-per-session alias diagnostic.

Accept canonical configuration ahead of its declared legacy key. Bind Codex to
`codex-exec` plus prompt stdin, and AGY to `agy-print` plus bounded
confirmation stdin. A missing or contradictory provider, role, mode,
transport, path, or scope descriptor is `BLOCKED`; this builder never derives
authority or supplies an implicit path.

The builder returns an immutable value. It writes only through an explicit
trusted writer with an explicit context path. That writer must atomically
create a regular, non-symlink JSON file with mode `0600`; no default filesystem
writer is provided by this package.

The repository-owned launcher is executable at
`scripts/launch-cli-dispatch.js`. Its public interface requires explicit
`--dispatching-agent`, `--execution-provider`, `--requested-role`, `--mode`,
`--task-id`, `--attempt-id`, `--workdir`, `--prompt`, and `--scope` values, plus
zero or more ordered `--config-layer` JSON files. The scope JSON must explicitly
provide `artifact_root`, `receipt_path`, `context_path`, `assigned_files`,
`report_only`, and `runtime_path`. Later config layers override earlier layers.
The launcher creates the private context, exports
`DHPK_CLI_TRANSPORT_CONTEXT`, and starts the selected compatibility adapter only
after context construction returns `READY`.
