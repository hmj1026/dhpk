---
name: agy-fast-worker
description: "Deprecated compatibility alias for agy-worker."
model: "cursor-grok-4.6-high"
readonly: true
---
# Deprecated Agy Fast Worker Alias

This one-release compatibility entry point resolves to `agy-worker` in
`workspace-write` mode. Do not use it in new dispatches; callers must carry
the requested and effective roles through the immutable role contract.

The legacy report remains a backend-specific mechanical-worker contract. The
contained transport owns execution and receipts, while the worker independently
verifies the requested scope; authentication, model, authority, and verification
failures are `BLOCKED` and never become an inferred fallback.

## Legacy report schema

```
RESULT: DONE | PARTIAL | BLOCKED
## Agy Fast Worker Report
Backend: agy --model "<model>" --mode accept-edits -p (non-interactive)
Requested backend: agy
Selected backend: agy | claude (only with configured missing-executable fallback)
Availability: <agy executable available | missing executable: agy>
Fallback reason: <none | missing executable: agy; configured fallback=claude>
Model/effort: <model> / baked into model name
Parallel: yes | no
Verify: <command> -> PASS | FAIL (N attempts)
Edited files (from git status --porcelain diff):
- path/a
Out-of-scope observations:
- none
Out-of-scope writes:
- none
Verification scope: assigned files | report-only
```
