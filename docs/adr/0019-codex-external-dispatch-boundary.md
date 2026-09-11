# Keep Codex projections native-only for external worker dispatch

Status: accepted

The `codex-sync` and `codex-native` projections expose `flow-drive` and the
shared CLI dispatch context, but they do not publish the Claude-side
`agy-fast-worker` or `codex-bridge` adapters. Explicit external worker
selection on either Codex surface is therefore an unavailable capability:
routing and launcher checks fail closed before adapter execution, `auto`
remains native-only, AGY points to the [Codex handoff boundary](../../codex/AGENTS.md#codex-handoff-boundary)
for its documented manual fallback, and
`codex-bridge` remains intentionally unavailable. This preserves Codex's
curated subset and prevents an advertised route from depending on an absent
adapter.

This boundary applies only to Codex projections. Claude- and Cursor-side
documentation may continue to describe external worker options where those
surfaces publish the required adapters, but those claims must remain scoped to
the surface that actually supports them.

## Considered Options

- Add both external adapters to every Codex projection. Rejected because these
  integrations are Claude-first adapter surfaces and Codex does not promise
  native parity for them.
- Reject only after the launcher tries to resolve a missing file. Rejected
  because routing and capability metadata would continue to advertise an
  unusable path, and the failure would be less actionable.

## Consequences

Codex-specific routing and capability metadata must not advertise external
`agy` or `codex` workers as available. Stale explicit callers remain
diagnosable through the `UNAVAILABLE` result, while AGY users receive the
manual workflow linked above and no provider switch occurs implicitly.
