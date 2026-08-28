---
name: dhpk-cli-dispatch-context
description: "Trigger: explicit provider-qualified CLI dispatch-context construction and launcher execution. Avoid: direct adapter invocation or implicit role, mode, path, or authority derivation. Output: immutable dhpk.cli.context.v1 evidence or BLOCKED diagnostics."
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

## When NOT to Use

- Do not use this skill for general agent-role selection, provider
  implementation, or external `/opsx:apply` orchestration.
- Do not invoke it to infer omitted role, mode, provider, transport, path,
  scope, authority, or writer values; the caller must supply each explicitly.

## Output

The scripts expose these caller-visible results and do not grant authority:

- `build-cli-dispatch-context.js` exports `buildContext(input, options)`. Its
  input is an explicit dispatch identity, execution provider, requested role,
  mode, task/attempt IDs, absolute scope paths, assigned files, report mode,
  prompt evidence, and optional resolved config. It returns a frozen
  `{ status: 'READY', context, legacyReport }` (plus `contextPath` and
  `contextSha256` when a trusted writer is supplied), or a frozen
  `{ status: 'BLOCKED', reason }` with no derived context. This module has no
  process exit; callers handle the returned status.
- `cli-role-resolver.js` exports immutable role/config/publication resolvers.
  `resolveRole({ requestedRole, mode, provider, diagnostics })` translates
  approved legacy aliases, returns `RESOLVED` with requested/effective role
  and role-contract evidence, or returns `BLOCKED` for unknown, contradictory,
  or provider-mismatched input. `resolveConfig({ effectiveRole, config })`
  returns canonical-over-legacy values with their source, or `BLOCKED` for an
  unknown role. `resolvePublication` returns `AVAILABLE` or `UNAVAILABLE`.
  These are modules, so they do not exit the process.
- `launch-cli-dispatch.js` accepts the required explicit CLI options documented
  above and ordered `--config-layer` JSON files. It writes the private context,
  exports `DHPK_CLI_TRANSPORT_CONTEXT`, and forwards the selected adapter's
  stdout/stderr and exit status. `--help` exits `0`; malformed CLI input exits
  `2`; validation or provider-start failures report `BLOCKED` and exit `65`;
  a signal returns `128`; otherwise the adapter's numeric exit status is
  returned.

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
