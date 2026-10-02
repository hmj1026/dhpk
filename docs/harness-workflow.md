# dhpk harness workflow

`bin/dhpk harness` is the public workflow boundary for the dhpk plugin
distribution. It keeps the existing `bin/dhpk distribution` commands available
as compatibility adapters while giving every phase one argument, result, and
receipt contract.

## Phases

Release-capable work follows this order:

```text
preflight -> plan -> generate -> validate -> test -> probe -> verify -> release
```

The supported phase names are `preflight`, `plan`, `generate`, `validate`,
`test`, `probe`, `verify`, and `release`. Use `--json` for automation:

```sh
bin/dhpk harness preflight --json
bin/dhpk harness verify --json --task-id release-2026-08-22
```

The facade delegates inventory selection and package materialization to the
canonical distribution/compiler and artifact-store owners. It delegates the
repository test phase to the bounded test gate. A facade result must not be
treated as proof that a consumer runtime probe ran.

When a phase consumes a generated package, its receipt binds the exact target
commit and resolved target tree of the current checkout, together with an
explicit `CLEAN` or `DIRTY` worktree state. Release promotion and cross-phase
handoff require `CLEAN`; diagnostic/test phases may retain `DIRTY` evidence but
cannot promote it to release success. Package
provenance records the generated-input commit/tree separately; a resolvable
ancestor is eligible only when the canonical adapter proves that the package
bytes match the current target inputs. Stale package bytes or a foreign
generated-input identity remain `NOT_RUN` or `NO_SHIP` until regeneration.

## Result and exit contract

`lifecyclePhase` describes the TDD state (`PLANNED`, `RED`, `GREEN`,
`REFACTOR`, `VERIFIED`, or terminal `COMPLETE`). `outcome` describes the
evidence result. The two fields are intentionally independent.

| Outcome | Meaning | Exit |
| --- | --- | ---: |
| `PASS`, `COMPLETE` | Evidence passed; `COMPLETE` is aggregate release success | 0 |
| `FAIL` | Deterministic assertion or gate failed | 1 |
| `BLOCKED`, `NOT_RUN`, `NOT_CONFIGURED`, `SKIP_INCOMPATIBLE`, `UNAVAILABLE`, `NO_SHIP`, `PARTIAL`, `PUBLISHED_PENDING`, `PUBLISHED_UNHEALTHY`, `OVERRIDDEN` | Evidence is absent, non-pass, or explicitly held | 2 |
| invalid usage | Unknown phase, option, or missing argument | 64 |
| unexpected harness error | Unhandled facade failure | 70 |

Structural and package evidence remain separate from consumer runtime evidence.
For example, a package may be `PASS` while a required runtime probe is
`NOT_RUN` or `UNAVAILABLE`; that state cannot be promoted to full-platform
`COMPLETE`. The seven full-release surface IDs are owned by the inventory
platform matrix: `claude-core`, `codex-sync`, `codex-native`, `cursor-sync`,
`cursor-plugin`, `agent-plugin`, and `agy-plugin`.

## Receipts and resume

Each attempt writes one append-only `dhpk.harness.receipt.v1` envelope under
the runtime receipt store. The envelope is immutable; transition events are
immutable, ordered files with `event_sha256` and rolling `chain_sha256` values.
Use `--previous-receipt <path>` to hand an exact validated phase receipt to the
next phase, or `--retry-of <path>` for a new attempt linked to the prior one.
`--operation-key` and `--idempotency-key` are append-only claims within the
selected runtime receipt root: a matching terminal replay returns the original
phase and evidence without executing a second mutation, while a phase mismatch
is `BLOCKED`. Operation claims are reserved before the phase executor starts;
conflicting concurrent attempts are `BLOCKED` without executing the phase.
`--previous-receipt` accepts only a clean exact-checkout receipt from an earlier
phase with an eligible PASS/COMPLETE outcome and matching surface scope. A plan
fingerprint is required when the receiving phase consumes a generated plan
(currently `generate`); package phases compare it before execution.
`--retry-of` accepts a receipt from the same phase.
Receipt values are bounded and redacted before persistence. A receipt records
exact source commit/tree and plan/artifact fingerprints when a phase claims
source or package evidence.

The JSON result includes a receipt reference and a bounded resume command when
available. Re-run the resume command only after checking the exact checkout and
the receipt identity. A ready marker, mtime, or file existence alone is not
readiness proof; the consuming phase re-reads and re-hashes referenced bytes.

See [distribution surface ownership](distribution-surfaces.md) for the
inventory/compiler boundary and [platform installation](platform-installation.zh-TW.md)
for consumer installation and verification details.

## Issue #237 controlled runtime-proof runner

The local runner is the exact-head promotion wrapper for a complete Issue #237
consumer-runtime proof. The installation and support policy remains in the
[platform installation SSOT](platform-installation.md). Run this wrapper from
a clean checkout of the exact merged commit. It starts an empty disposable
`HOME`, lets each consumer adapter clone only its allowlisted provider session
files from the explicitly supplied `DHPK_CURSOR_HOST_HOME` and
`DHPK_AGY_HOST_HOME` directories, executes the public `bin/dhpk harness
release` facade, and writes a redacted `0600` runner receipt under the
requested receipt root. The disposable HOME is removed after the attempt.

```sh
export DHPK_CURSOR_HOST_HOME=/absolute/path/to/disposable-cursor-session-source
export DHPK_AGY_HOST_HOME=/absolute/path/to/disposable-agy-session-source

node scripts/release/issue-237-runtime-proof.js \
  --root /absolute/path/to/dhpk \
  --receipt-root /tmp/runtime-receipts \
  --task-id issue-237-runtime-proof \
  --attempt-id attempt-unique \
  --json
```

### Preflight and attempt identity

Run `scripts/release/consumer-runtime-preflight.js` first with the task and
attempt IDs intended for the wrapper. Invoke both commands with the same
minimal environment. The preflight JSON reports readiness and selected tool
versions; it does not capture a complete tool snapshot. The operator must
separately record the resolved path, version, and SHA-256 of `node`, `git`,
`bwrap`, `claude`, `codex`, `cursor-agent`, `agy`, and `python3` before and
after the controlled run.

Executable preflight is containment-aware. A `cursor-agent` symlink whose
target is outside its `PATH` directory is skipped; `command -v` alone is not
proof that preflight will select it. Keep the intended Node and Codex
directories ahead of the physical Cursor bundle directory, then include that
bundle directory later in `PATH`. This prevents Cursor's bundled Node or an
older Codex from shadowing the recorded tools while still exposing a contained
`cursor-agent`. Keep the complete Cursor bundle intact because its launcher
uses sibling runtime assets.

Treat an attempt ID used by a non-`PASS` standalone preflight as retired before
the wrapper starts. Record that retirement in the operator log: standalone
preflight does not reserve the ID or persist a runner receipt. A tool-path,
version, or hash correction also uses a fresh exact-head checkout and a new
attempt ID. Do not automatically retry a controlled wrapper call; each
invocation is one immutable attempt.

### Runner-receipt projection

Publish and hash the persisted `runtime-proof.json`, not the raw stdout JSON.
The persisted file is an immutable redacted projection created before stdout
receives `runnerReceiptReference`: it adds `receiptReference` and `recordedAt`,
and the redactor may replace deeply nested evidence with `<truncated>`. Direct
byte equality or raw-object equality between the two representations is
therefore invalid.

To compare them, remove `runnerReceiptReference` from stdout, add the persisted
file's `receiptReference` and `recordedAt`, apply the repository receipt
redactor, and compare canonical JSON. Independently run `validateReceipt`
against the exact checkout and require the canonical seven surface rows in
order, all six required-runtime rows `PASS`, `cursor-sync` `PASS` or `NOT_RUN`,
one terminal `COMPLETE` event, valid event/chain hashes, contained receipt
paths, `0600` files, and `0700` receipt directories.

Before publishing a GitHub evidence comment, confirm the complete comment is
redacted and no larger than the project's 50,000-byte safety limit. Stream it
with `gh issue comment <number> --body-file -`; keep Markdown and JSON out of a
shell `--body` or `--comment` argument. Preserve the exact checkout and receipt
through the explicit human close gate.

The two host-home variables are session sources, not destinations. Do not point
them at a whole developer home, put credentials in command arguments, or copy
unallowlisted files. A non-`PASS` preflight stops before any consumer process is
started. A successful run is promoted only when the harness returns `COMPLETE`,
all six required-runtime rows are `PASS`, `cursor-sync` is `PASS` or `NOT_RUN`,
the preflight identity matches, the checkout remains clean, and the harness
receipt validates against the same commit and tree. Missing tools, sandbox,
or login stop before the consumer process. Missing runtime rows remain
non-terminal: the underlying harness may report `PUBLISHED_PENDING`, while the
wrapper returns `NO_SHIP` and exit 2. Preflight failures are returned as
`UNAVAILABLE` or `BLOCKED` with exit 2.

This runner is deliberately local and supervised. It does not install tools,
publish packages, alter the checkout, or make a GitHub merge decision. Preserve
the runner receipt for the release review; remove only the disposable runtime
home after the attempt and retry from a fresh exact-head checkout.

## Compatibility boundary

Existing commands remain valid during migration:

```sh
bin/dhpk distribution <surface> <generate|validate|verify> --json
```

These adapters retain their characterized diagnostics and internal exit codes.
The harness normalizes only at its own process boundary; it does not duplicate
surface selection, projection generation, package gates, or native runtime
probes.
