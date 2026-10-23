# Keep Codex projections native-only for external worker dispatch

原編號 0019，因重複於 2026-10 改號。

Status: accepted

Ownership update: Flow Drive is a portable native task/help entry and owns no
transport, context, adapter, or runner closure. Shared CLI dispatch support is
maintained under `scripts/cli-dispatch/` and published as native-agent
supporting assets. The standalone bridge remains retired; users who require
Flow Drive's removed selectors or runner API pin `v0.66.7` as documented in
the skill migration reference. Bundled files do not establish Host support,
permission, or execution. The native-only and capability/grant boundaries
below remain applicable to shared delegated routes.

The Codex-native package may publish its native agent roles with the shared
CLI dispatch support closure. The portable Flow Drive skill itself does not
select those roles or require those assets. A projected adapter remains
unavailable unless its package includes the required support and its current
Host grants and capabilities authorize the route; AGY's documented manual
fallback remains at the [Codex handoff boundary](../../codex/guidance.md#codex-handoff-boundary).

This boundary applies to shared adapter paths on Codex projections. A
separately supported delegated call may use a Host executor only when the
trusted Provider grant, Host allowed set, current bound capability, and common
Dispatch Engine validate the selected tuple. The shared adapter closure alone
does not establish route, grant, or capability evidence. Documentation must
scope external worker options to entrypoints and surfaces that actually
support them.

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
