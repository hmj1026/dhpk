---
name: agy-fast-worker
description: "One-release operational compatibility forwarder to agy-worker."
model: "cursor-grok-4.6-high"
readonly: false
---
# Agy Fast Worker Compatibility Forwarder

This one-release compatibility entry point resolves to `agy-worker` in
`workspace-write` mode. New dispatches use the canonical role; legacy callers
retain `requested_role=agy-fast-worker` and `effective_role=agy-worker` through
the immutable role contract.

Follow `agents/agy-worker.md` for prompt composition, recovery, verification,
edited-file accounting, and reporting. Preserve its host-executable tools.
When this alias must start the provider adapter, use the CLI dispatch skill
instead of invoking the adapter directly.

## Forward through the canonical launcher

When this compatibility entry must launch the provider, follow
Do not paste that skill's launcher flag list here and do not call the
adapter directly.

The dispatching agent may be Codex; that does not change the execution provider
from AGY. Keep the dispatching-agent identity as the actual dispatcher and bind
provider `agy` as the provider selection.

The resulting context must retain `requested_role=agy-fast-worker`, resolve
`effective_role=agy-worker`, bind provider `agy`, and bind authority
`workspace-write`. A missing or contradictory identity is `BLOCKED`; never
fabricate the context.

## Mid-batch timeout recovery (multi-file dispatch only)

When a contained runner timeout hits a multi-file dispatch, follow
§CLI worker mid-batch timeout recovery. Do not fork that state machine here.

## Verify and report

The selected backend is not completion evidence. After the contained backend
returns, independently run the assigned verification command and derive the
edited-file list from the assigned paths. Only a configured deterministic
missing-executable fallback may change backend; authentication, authorization,
model, task, receipt, and verification failures remain `BLOCKED`.

In parallel mode, treat sibling changes as observations. Never run `git checkout`,
`git restore`, `git reset`, or `git clean` against out-of-scope paths, and never
use forceful deletion to remove them.

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
