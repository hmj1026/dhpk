---
name: agy-fast-worker
description: 'One-release operational compatibility forwarder to agy-worker.'
tools: Bash, Read, Write, Grep, Glob
model: sonnet
effort: low
skills: ["dhpk-tdd-workflow"]
---

# Agy Fast Worker Compatibility Forwarder

This one-release compatibility entry point resolves to `agy-worker` in
`workspace-write` mode. New dispatches use the canonical role; legacy callers
retain `requested_role=agy-fast-worker` and `effective_role=agy-worker` through
the immutable role contract.

Follow `agents/agy-worker.md` for prompt composition, recovery, verification,
edited-file accounting, and reporting. Preserve its host-executable tools and
replace its direct adapter invocation with the canonical launcher below.

## Forward through the canonical launcher

Invoke only the repository-owned launcher; it resolves the alias before starting
the provider adapter:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dhpk-cli-dispatch-context/scripts/launch-cli-dispatch.js" \
  --dispatching-agent "<dispatcher-role>" \
  --execution-provider agy \
  --requested-role agy-fast-worker \
  --mode workspace-write \
  --task-id "<task-id>" \
  --attempt-id "<attempt-id>" \
  --workdir "<absolute-workdir>" \
  --prompt "<absolute-prompt-file>" \
  --scope "<absolute-scope-json>" \
  --config-layer "<absolute-config-json>"
```

The dispatching agent may be Codex; that does not change the execution provider
from AGY. Keep `--dispatching-agent` as the actual dispatcher identity and
`--execution-provider agy` as the provider selection.

The resulting context must retain `requested_role=agy-fast-worker`, resolve
`effective_role=agy-worker`, bind provider `agy`, and bind authority
`workspace-write`. The launcher exports `DHPK_CLI_TRANSPORT_CONTEXT` and starts
the selected adapter only after context construction returns `READY`. A missing
or contradictory role, mode, provider, authority, path, scope, transport, model,
or receipt is `BLOCKED`; never fabricate the context or call the adapter directly.

## Mid-batch timeout recovery (multi-file dispatch only)

A runner exit `124` is timeout evidence only when the contained
`dhpk.cli.receipt.v1` has terminal `TIMEOUT`; a missing, invalid, or uncontained receipt is `BLOCKED`.
On the first verified timeout, request exactly one same-backend, same-model recovery
scoped to `remaining ∪ unconfirmed`. Never self-edit the unresolved files or repeat
confirmed files. During recovery, never fall back to another backend because of a timeout.

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
