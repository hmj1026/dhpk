---
name: dhpk-cli-dispatch-context
description: "Internal CLI dispatch-context builder and public launcher that resolve provider-qualified role identity and emit an immutable attested context."
metadata:
  dhpk-invocation-class: explicit-only
  dhpk-invokable: false
disable-model-invocation: true
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

## Role scope and authoritative inputs

This internal skill owns the dispatch-context boundary only: resolve the
provider-qualified role, validate the supplied descriptors, and construct the
attested context for the selected compatibility adapter. Its available
operations are limited to the builder and launcher contract above; task scope,
provider, role, mode, transport, authority, path, and writer remain explicit
caller inputs.

The canonical role resolver, the caller-provided scope descriptor, and the
explicit trusted writer are the single sources of truth for those values.
Consult their declared interfaces rather than caching, extending, or deriving
missing values in this skill.

## Verification evidence

Before reporting `READY`, retain evidence that the resolver preserved the
requested and effective role identities, the required scope fields were
explicit and non-contradictory, and the trusted writer created the regular
non-symlink `0600` context file. For launcher execution, also verify that the
context was `READY` before the adapter started and that
`DHPK_CLI_TRANSPORT_CONTEXT` identifies that private context.

## Completion and handoff

Completion is a `READY` immutable context handed to the selected compatibility
adapter with the recorded verification evidence. A `BLOCKED` result hands back
no derived context; the next step is for the caller to supply corrected,
explicit inputs.
