---
name: dhpk-cli-transport
description: "Internal Codex and AGY CLI transport that validates an already-attested request and produces a contained terminal receipt; it never selects roles or accepts direct user invocation."
metadata:
  dhpk-invocation-class: explicit-only
  dhpk-invokable: false
disable-model-invocation: true
---

# Internal CLI transport

This is an internal support package. The canonical dispatcher creates a
`dhpk.dispatch.request.v2` with separate Host, Provider, Provider-scoped Model,
canonical Role, Effort, Transport, authority, scope, timeout, task identity,
and immutable prompt evidence. The Codex and AGY compatibility adapters
translate that request to the existing `0600`, regular, non-symlink
`dhpk.cli.context.v1` boundary and invoke `scripts/run-cli-transport.py`; they
never derive authority, select a role, or inherit an unbounded `PATH`.

The runner accepts only a request file, owns timeout observation and receipt
containment, and emits one terminal `dhpk.cli.receipt.v1` with its immutable
follow-up record embedded atomically. The adapter seam also normalizes the
same outcome to `dhpk.dispatch.receipt.v2`, preserving Host, Provider, Model,
Effort, Transport, fallback history, and independent verification. It
intentionally does not select a Provider or retry a Provider through a
different Transport. Direct legacy wrapper calls without
`DHPK_CLI_TRANSPORT_CONTEXT` are `BLOCKED`; provider commands never start.

The dispatcher may attest one `failure_class` on a request. It is transport
evidence, not a switching instruction, and must be one of
`CLI_UNAVAILABLE`, `AUTHENTICATION_OR_MODEL_UNAVAILABLE`,
`QUOTA_OR_RATE_LIMIT`, `SAFETY_OR_USER_DENIAL`, `TASK_OR_SEMANTIC_FAILURE`, or
`TIMEOUT_OR_INTERRUPTION`. A contained timeout is classified as
`TIMEOUT_OR_INTERRUPTION` in the terminal receipt. Requested and effective
provider fields remain unchanged; the canonical dispatcher policy decides any
subsequent handoff.

The wrapper bootstrap is the fixed system path `/usr/bin/python3` on
Linux/WSL and macOS. The context must attest that same named `python3` entry in
its restricted runtime allowlist. On macOS system Python builds that do not
expose descriptor-relative `os.mkfifo`, the runner uses libc `mkfifoat` against
the already-pinned directory descriptor; it never falls back to a path-based
or cwd-based FIFO creation. It never uses a Python path from the environment or
falls back to `timeout` or `gtimeout`; a host without that system runtime or
descriptor-safe FIFO capability is `BLOCKED`. Codex gets its bounded prompt
through stdin. AGY keeps its supported `-p` prompt and receives only `Y\n` as
its bounded confirmation stdin mode.

## When NOT to Use

- For selecting a role, widening a caller's capability, or constructing
  authority: those decisions belong to the attesting dispatcher.
- For an interactive provider session or a direct user task: use the Codex or
  AGY adapter that supplies an already-attested context.
- For a legacy wrapper call without `DHPK_CLI_TRANSPORT_CONTEXT`; it must
  return `BLOCKED` before any provider process starts.

## Inputs and scripts

- `scripts/prepare-cli-request.py` accepts the immutable context through its
  verified descriptor, validates its contained paths and role contract, and
  emits one bounded `dhpk.cli.request.v1`. It does not derive a role, prompt,
  model, timeout, workdir, or runtime authority.
- The attested context is the authoritative source for those values; adapters
  and this package may validate or narrow it, never replace it with a fallback.
- `scripts/run-cli-transport.py` accepts only that request descriptor. It
  invokes the provider using explicit argv and the request's declared stdin
  mode, observes the bounded timeout itself, and writes the terminal receipt.

## Output and verification

The compatibility runner writes one `dhpk.cli.receipt.v1` at the
context-attested receipt path. The Adapter boundary exposes the corresponding
canonical `dhpk.dispatch.receipt.v2` to the Dispatch Engine. Both are regular,
contained `0600` artifacts, redact provider material, retain the validated Role
contract, and record terminal `SUCCEEDED`, `FAILED`, `TIMEOUT`, or fail-closed
`BLOCKED` without starting an unauthorised Provider. When present, the receipt preserves the attested
`failure_class`; timeout receipts always carry
`TIMEOUT_OR_INTERRUPTION`. The transport never emits a silent provider switch.

Verify a transport change with the focused adapter and transport contracts:

```bash
node tests/run-codex.test.js
node tests/run-agy.test.js
node tests/run-cli-transport.test.js
```

Inspect a successful receipt's mode, containment, terminal state, role
contract, timeout fields, and redaction boundary; a direct legacy call must
instead produce `BLOCKED` and no provider side effect.
