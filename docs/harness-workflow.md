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

When a phase consumes a generated package, its provenance source commit and
resolved source tree must match the current checkout exactly. Historical but
resolvable package bytes remain `NO_SHIP` until the package is regenerated for
that checkout.

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
Retries use a new attempt ID and retain the prior receipt reference. Receipt
values are bounded and redacted before persistence. A receipt records exact
source commit/tree and plan/artifact fingerprints when a phase claims source
or package evidence.

The JSON result includes a receipt reference and a bounded resume command when
available. Re-run the resume command only after checking the exact checkout and
the receipt identity. A ready marker, mtime, or file existence alone is not
readiness proof; the consuming phase re-reads and re-hashes referenced bytes.

See [distribution surface ownership](distribution-surfaces.md) for the
inventory/compiler boundary and [platform installation](platform-installation.zh-TW.md)
for consumer installation and verification details.

## Compatibility boundary

Existing commands remain valid during migration:

```sh
bin/dhpk distribution <surface> <generate|validate|verify> --json
```

These adapters retain their characterized diagnostics and internal exit codes.
The harness normalizes only at its own process boundary; it does not duplicate
surface selection, projection generation, package gates, or native runtime
probes.
