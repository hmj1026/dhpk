---
name: dhpk-cli-transport
description: "Internal Codex and AGY CLI transport that validates an already-attested request and produces a contained terminal receipt; it never selects roles or accepts direct user invocation."
---
# Internal CLI transport

This is an internal support package. A dispatcher creates a `0600`, regular,
non-symlink `dhpk.cli.context.v1` containing its already-validated identity,
maximum role contract, scope, timeout, immutable prompt evidence, named runtime
path, and contained artifact locations. The
provider compatibility adapters translate that immutable context to
`dhpk.cli.request.v1` and invoke `scripts/run-cli-transport.py`; they never
derive authority, select a role, or inherit an unbounded `PATH`.

The runner accepts only a request file, owns timeout observation and receipt
containment, and emits one terminal `dhpk.cli.receipt.v1` with its immutable
follow-up record embedded atomically. It intentionally does not select a provider or retry a
provider through a different transport. Direct legacy wrapper calls without
`DHPK_CLI_TRANSPORT_CONTEXT` are `BLOCKED`; provider commands never start.

The wrapper bootstrap is the fixed Linux/WSL system path `/usr/bin/python3`.
The context must attest that same named `python3` entry in its restricted
runtime allowlist. It never uses a Python path from the environment or falls
back to `timeout` or `gtimeout`; a host without that system runtime is
`BLOCKED`. Codex gets its bounded prompt through stdin. AGY keeps its supported
`-p` prompt and receives only `Y\n` as its bounded confirmation stdin mode.

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

The only terminal output is a `dhpk.cli.receipt.v1` at the context-attested
receipt path. It is created as a regular, contained `0600` file, redacts
provider material, retains the validated role contract, and records terminal
`SUCCEEDED`, `FAILED`, `TIMEOUT`, or fail-closed `BLOCKED` without starting an
unauthorised provider.

Verify a transport change with the focused adapter and transport contracts:

```bash
node tests/run-codex.test.js
node tests/run-agy.test.js
node tests/run-cli-transport.test.js
```

Inspect a successful receipt's mode, containment, terminal state, role
contract, timeout fields, and redaction boundary; a direct legacy call must
instead produce `BLOCKED` and no provider side effect.
