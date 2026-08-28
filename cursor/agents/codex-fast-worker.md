---
name: codex-fast-worker
description: "Deprecated compatibility alias for codex-worker."
model: "cursor-grok-4.6-high"
readonly: true
---
# Deprecated Codex Fast Worker Alias

This one-release compatibility entry point resolves to `codex-worker` in
`workspace-write` mode. Do not use it in new dispatches; callers must record
`requested_role=codex-fast-worker` and `effective_role=codex-worker` through
the immutable `dhpk.role-contract.v1` resolver.

The legacy report remains the mechanical-worker contract: the selected backend
does not prove completion, and the agent independently verifies the assigned
scope after the contained transport has returned. Missing context, a rejected
model, or a contradictory role/mode is `BLOCKED`; no fallback may fabricate
authority or verification.

## Legacy report schema

```
RESULT: DONE | PARTIAL | BLOCKED
## Codex Fast Worker Report
Backend: codex exec -m <model> -c model_reasoning_effort=<effort> (workspace-write)
Requested backend: codex
Selected backend: codex | claude (only with configured missing-executable fallback)
Availability: <codex executable available | missing executable: codex>
Fallback reason: <none | missing executable: codex; configured fallback=claude>
Model/effort: <model> / <effort>
Parallel: yes | no
Verify: <command> -> PASS | FAIL (N attempts)
Edited files (assigned-scope, from path-scoped status/diff):
- path/a
Out-of-scope observations:
- none
Out-of-scope writes:
- none
Verification scope: assigned files | report-only
```
