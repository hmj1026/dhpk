# Keep Codex projections native-only for external worker dispatch

Status: accepted

The `codex-sync` and `codex-native` projections expose `flow-drive` and the
shared CLI dispatch context, but they do not publish the Claude-side
`agy-fast-worker` or `codex-bridge` adapters. Legacy headless external worker
selection that depends on those absent adapters is therefore unavailable:
routing and launcher checks fail closed before adapter execution, `auto`
remains native-only, AGY points to the [Codex handoff boundary](../../codex/guidance.md#codex-handoff-boundary)
for its documented manual fallback, and
`codex-bridge` remains intentionally unavailable. This preserves Codex's
curated subset and prevents an advertised route from depending on an absent
adapter.

This boundary applies to those legacy adapter paths on Codex projections.
Under #917, the portable Flow Drive runner may use a separately injected Host
executor only when the trusted Provider grant, Host allowed set, current bound
capability, and common Dispatch Engine validate the selected tuple. This scoped
Host contract does not install the missing adapters or make legacy headless
selection available. Claude- and Cursor-side
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

Codex-specific legacy routing and capability metadata must not advertise
absent `agy` or `codex` headless adapters as available. Stale explicit callers remain
diagnosable through the `UNAVAILABLE` result, while AGY users receive the
manual workflow linked above and no provider switch occurs implicitly.
Provider permission is a separate authorization boundary: an explicit user
answer or target selection cannot create a missing Codex adapter, route, or
capability, and unsupported
legacy external dispatch remains blocked. Current bound Host executor evidence
is a separate route-specific proof, never a blanket surface support claim.
