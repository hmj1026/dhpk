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
edited-file accounting, and reporting. Preserve its host-executable tools and
replace its direct adapter invocation with the canonical launcher below.

## Forward through the canonical launcher

Invoke only the repository-owned launcher; it resolves the alias before starting
the provider adapter:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dhpk-cli-dispatch-context/scripts/launch-cli-dispatch.js" \
  --dispatching-agent "<dispatcher-role>" \
  --execution-provider codex \
  --requested-role codex-fast-worker \
  --mode workspace-write \
  --task-id "<task-id>" \
  --attempt-id "<attempt-id>" \
  --workdir "<absolute-workdir>" \
  --prompt "<absolute-prompt-file>" \
  --scope "<absolute-scope-json>" \
  --config-layer "<absolute-config-json>"
```

The resulting context must retain `requested_role=codex-fast-worker`, resolve
`effective_role=codex-worker`, bind provider `codex`, and bind authority
`workspace-write`. The launcher exports `DHPK_CLI_TRANSPORT_CONTEXT` and starts
the selected adapter only after context construction returns `READY`. A missing
or contradictory role, mode, provider, authority, path, scope, transport, or
receipt is `BLOCKED`; never fabricate the context or call the adapter directly.

## Mid-batch timeout recovery (multi-file dispatch only)

A runner exit `124` is timeout evidence only when the contained
`dhpk.cli.receipt.v1` has terminal `TIMEOUT`; a missing, invalid, or uncontained receipt is `BLOCKED`.
On the first verified timeout, request exactly one same-backend, same-model/effort recovery
scoped to `remaining ∪ unconfirmed`.
Never self-edit the unresolved files or repeat confirmed files.
During recovery, never fall back to another backend because of a timeout.

Second verified timeout: stop. Report `RESULT: PARTIAL` when any assigned file is confirmed
and `RESULT: BLOCKED` when none is; finish by naming both timeout observations, all three ledger sets, and the next action.

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
