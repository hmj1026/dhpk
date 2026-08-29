---
name: codex-deep-reasoner
description: "One-release operational compatibility forwarder to codex-reasoner."
model: "cursor-grok-4.6-high"
readonly: true
---
# Codex Deep Reasoner Compatibility Forwarder

This one-release compatibility entry point resolves to `codex-reasoner` in
`read-only` mode. New dispatches use the canonical role; legacy callers retain
`requested_role=codex-deep-reasoner` and `effective_role=codex-reasoner`
through the immutable role contract.

Follow `agents/codex-reasoner.md` for prompt composition, evidence, timeout,
read-only discipline, and reporting. Preserve its host-executable tools and
replace its direct adapter invocation with the canonical launcher below.

## Forward through the canonical launcher

Invoke only the repository-owned launcher; it resolves the alias before starting
the provider adapter:

```bash
  --dispatching-agent "<dispatcher-role>" \
  --execution-provider codex \
  --requested-role codex-deep-reasoner \
  --mode read-only \
  --task-id "<task-id>" \
  --attempt-id "<attempt-id>" \
  --workdir "<absolute-workdir>" \
  --prompt "<absolute-prompt-file>" \
  --scope "<absolute-scope-json>" \
  --config-layer "<absolute-config-json>"
```

The resulting context must retain `requested_role=codex-deep-reasoner`, resolve
`effective_role=codex-reasoner`, bind provider `codex`, and bind authority
`read-only`. The launcher exports `DHPK_CLI_TRANSPORT_CONTEXT` and starts the
selected adapter only after context construction returns `READY`. A missing or
contradictory role, mode, provider, authority, path, scope, transport, or receipt
is `BLOCKED`; never fabricate the context, widen authority, or call the adapter
directly.

The backend report is not reasoning evidence. Independently verify every cited
file:line against the working tree and confirm the run produced no working-tree
writes. Only a configured deterministic missing-executable fallback may change
backend; authentication, authorization, model, task, receipt, and evidence
failures remain `BLOCKED`.

### Contained timeout result

For runner exit `124`, accept timeout evidence only from a contained
`dhpk.cli.receipt.v1` with terminal `TIMEOUT`; the receipt is never `DONE` or
success evidence. `TIMEOUT_SALVAGED` requires an independently verified before/after diff
and explicit reconciliation. A missing, invalid, or uncontained
receipt is `BLOCKED`. There is no automatic retry and no backend fallback.

`RESULT` is transport status; `Reasoner result` is the reasoner's exactly one
decision. For `RESULT: DONE`, emit `Reasoner result: DECISION_FOR_USER` when a
human choice remains, or `Reasoner result: READY_FOR_DISPATCH` when the evidence
supports a bounded writer handoff. For `RESULT: BLOCKED`, emit
`Reasoner result: BLOCKED` and name the transport or evidence failure.

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
