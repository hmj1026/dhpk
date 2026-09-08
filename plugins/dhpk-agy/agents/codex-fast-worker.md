---
name: codex-fast-worker
description: 'One-release operational compatibility forwarder to codex-worker.'
tools: ["run_command", "read_file", "write_to_file", "grep_search", "list_dir"]
model: pro
---

# Codex Fast Worker Compatibility Forwarder

This one-release compatibility entry point resolves to `codex-worker` in
`workspace-write` mode. New dispatches use the canonical role; legacy callers record
`requested_role=codex-fast-worker` and `effective_role=codex-worker` through
the immutable role contract.

Follow `agents/codex-worker.md` for prompt composition, recovery, verification,
edited-file accounting, and reporting. Preserve its host-executable tools.
When this alias must start the provider adapter, use the CLI dispatch skill
instead of invoking the adapter directly.

## Forward through the canonical launcher

When this compatibility entry must launch the provider, follow
`skills/dhpk-cli-dispatch-context/SKILL.md`.
Do not paste that skill's launcher flag list here and do not call the
adapter directly.

The resulting context must retain `requested_role=codex-fast-worker`, resolve
`effective_role=codex-worker`, bind provider `codex`, and bind authority
`workspace-write`. A missing or contradictory identity is `BLOCKED`; never
fabricate the context.

## Mid-batch timeout recovery (multi-file dispatch only)

When a contained runner timeout hits a multi-file dispatch, follow
`skills/flow-guide/references/implementation-dispatch.md`
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
