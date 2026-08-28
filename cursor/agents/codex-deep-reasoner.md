---
name: codex-deep-reasoner
description: "Deprecated compatibility alias for codex-reasoner."
model: "cursor-grok-4.6-high"
readonly: true
---
# Deprecated Codex Deep Reasoner Alias

This one-release compatibility entry point resolves to `codex-reasoner` in
`read-only` mode. Do not use it in new dispatches; callers must record the
requested and effective roles through the immutable role contract.

The legacy entry remains a read-only reasoning contract, not an alias that
permits an in-process substitute. The resolver carries the requested alias and
canonical effective role into the contained transport; missing or contradictory
role/mode evidence is `BLOCKED` before any backend is launched.

## Legacy report schema

```
RESULT: DONE | TIMEOUT_SALVAGED | BLOCKED
## Codex Deep Reasoner Report
Backend: codex exec -m <model> -c model_reasoning_effort=<effort> (read-only)
Requested backend: codex
Selected backend: codex | deep-reasoner (only with configured missing-executable fallback)
Availability: <codex executable available | missing executable: codex>
Fallback reason: <none | missing executable: codex; configured fallback=deep-reasoner>
Model/effort: <model> / <effort>
Parallel: yes | no
Verify: file:line evidence -> PASS | FAIL
Reasoner result: READY_FOR_DISPATCH | DECISION_FOR_USER | BLOCKED
Out-of-scope observations:
- none
Out-of-scope writes:
- none
Verification scope: report-only
```
