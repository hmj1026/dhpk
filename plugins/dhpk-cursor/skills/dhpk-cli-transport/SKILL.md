---
name: dhpk-cli-transport
description: "Internal provider-neutral transport for Codex and AGY execution receipts. This package is distribution-owned and not invokable by users or routing."
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
