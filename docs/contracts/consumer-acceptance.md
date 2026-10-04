# Consumer acceptance contract

Status: accepted for issue #849. This contract defines the existing selected-
surface consumer gate's installation acceptance and bounded requirements
input. It does not claim that a consumer runtime was executed.

## Purpose and authority

The consumer gate reports two distinct things: observed installation results
and consumer acceptance. Acceptance describes whether the selected installation
contract and every declared requirement have adequate evidence. It is not a
runtime-verification flag, support-tier decision, marketplace approval, or
release-publication decision. The `consumer-gate.js` entrypoint and
`release-evidence.js` normalizer remain the public execution and normalization
boundaries.

The accepted requirement IDs for this slice are `REQ-849-01` through
`REQ-849-05` in the
[post-install validation specification](../../openspec/specs/consumer-post-install-validation/spec.md)
and the
[evidence normalization specification](../../openspec/specs/consumer-evidence-normalization/spec.md).

## Selected surfaces and Host mapping

The fixed selected-surface IDs are owned by
`scripts/release/consumer-gate.js`:

| Surface ID | Host value | Normalized evidence surface |
| --- | --- | --- |
| `claude-core` | `claude` | `claude` |
| `codex-sync` | `codex` | `codex-sync` |
| `codex-native` | `codex` | `codex-native` |
| `cursor-sync` | `cursor` | `cursor-sync` |
| `agent-plugin` | `cursor` | `agent-plugin` |
| `cursor-plugin` | `cursor` | `cursor-plugin` |

`--surface` selects exactly one known surface. With `--requirements`, it MUST
match a requirements scope containing exactly that one surface. A mismatch is
a usage error and no consumer adapter runs. The gate MUST NOT discover or add
surfaces from `PATH`, CI presence, or installed command-line clients. An
unrequested optional Host does not become required merely because its CLI is
available.

## Default configured scope

When neither `--surface` nor `--requirements` is supplied, the gate's default
scope is the set of consumer surfaces configured by the repository's local
target markers. It MUST NOT infer configuration from `PATH`, client binaries,
CI, or ambient environment variables. The repository-relative markers below
are the consumer-gate-owned map for this #849 contract; they apply ADR-0002's
[repository-local configured-scope principle](../adr/0002-scope-validation-to-configured-platforms.md):

| Consumer surface | Configured-scope marker |
| --- | --- |
| `claude-core` | `.claude-plugin/plugin.json` |
| `codex-sync`, `codex-native` | `.codex/config.toml` |
| `cursor-sync`, `agent-plugin`, `cursor-plugin` | Any existing marker in the list below |

The Cursor-family marker list is:

- `.cursor/.dhpk-installed.json`
- `plugins/dhpk-agent/plugin.json`
- `.cursor-plugin/plugin.json`
- `.cursor/plugins/local/dhpk-agent/plugin.json`
- `.cursor/plugins/local/dhpk-cursor/.cursor-plugin/plugin.json`

These files establish that a consumer delivery surface is configured for the
repository; they do not prove that a host or client application is installed.
In an unscoped default run, an unrequested surface without its marker is
recorded in `acceptance.excludedChecks` as `NOT_CONFIGURED`, with a reason that
names the absent marker, and its adapter is not invoked.

If no surface is configured and none was explicitly selected, no surface
adapter runs and acceptance includes a required `scope.configuration` check
with `surface: "consumer-scope"`, `kind: "contract"`, `status: "BLOCKED"`,
and `evidenceRef: null`. Its reason states that no configured target exists.
It is a missing-scope result, not a hidden required Host. When at least one
configured surface is selected, another unconfigured optional surface remains
excluded as `NOT_CONFIGURED` even if the selected installation contract
passes. This keeps `requiredChecks` non-empty for the genuinely empty scope
and prevents a vacuous or synthetic PASS.

An explicit `--surface` or a requirements-file scope overrides marker-based
discovery. The requested adapter runs even if its local marker is absent; the
adapter's observed result determines whether missing prerequisites block or
fail the required installation check. A requirements file is an explicit
scope: when `selectedSurfaces` is omitted, its `checks` surfaces define that
scope rather than falling back to automatic marker discovery.

## Requirements input

`--requirements <JSON file>` accepts a UTF-8 JSON document with this shape:

```json
{
  "schema": "dhpk.consumer-requirements.v1",
  "selectedSurfaces": ["cursor-sync"],
  "checks": [
    {
      "id": "cursor-installation",
      "surface": "cursor-sync",
      "host": "cursor",
      "capability": "installation-contract",
      "trigger": "loader-change",
      "reason": "The Cursor project-local installation contract changed.",
      "question": "Does the installed projection satisfy the contract?",
      "evidenceKind": "contract",
      "authorization": { "authorized": false }
    }
  ]
}
```

The top-level object permits only `schema`, optional `selectedSurfaces`, and
`checks`. When `selectedSurfaces` is omitted, the gate derives its selected
explicit scope from the declared checks; it does not discover scope from the
machine.
An explicit `selectedSurfaces` list is non-empty, contains unique known IDs,
and is bounded by the six fixed surface IDs. `checks` contains 1–64 entries and
the input file is at most 64 KiB. Unknown fields, malformed JSON, invalid
surface/Host pairs, duplicate IDs, unsupported triggers, and invalid nested
authorization are rejected at the CLI boundary.

Each check contains exactly `id`, `surface`, `host`, `capability`, `trigger`,
`reason`, `question`, `evidenceKind`, and `authorization`:

- `id` is a unique lower-case slug matching `[a-z][a-z0-9-]{0,63}`. It has no
  dots. The validated ID is retained in the corresponding requirement
  evidence object's `id` field; the evidence reference uses a stable slot
  instead of embedding the ID in its path.
- `surface` is one of the six fixed IDs above; `host` must exactly match its
  table entry.
- `capability` and `host` are non-empty bounded single-line strings of at most
  80 characters. Unknown capabilities are retained as required blockers; they
  cannot choose a runtime or adapter.
- `trigger` is one of `new-host`, `loader-change`,
  `role-registration-change`, `tool-mapping-change`, `activation-defect`, or
  `explicit-native`.
- `reason` and `question` are required, non-empty bounded single-line strings
  of at most 240 characters.
- `evidenceKind` is `contract` or `native`.
- `authorization` contains exactly one boolean field, `authorized`. It is an
  assertion supplied by the caller, not permission for this gate to execute an
  unimplemented runtime probe.

The parser rejects control characters in bounded text. Requirements cannot
provide shell commands, executable names, adapter paths, or model selections.
The `--requirements` input is a declaration of applicability and obligation;
it is not an execution plan.

Each declared check is recorded at its stable, one-based position in the input
`checks` array under `surfaceResults.<surface>.requirementEvidence.checkN`.
For example, an input check at position 1 for `cursor-sync` is stored at
`surfaceResults.cursor-sync.requirementEvidence.check1`, and that value's
`id` field contains the validated input ID (such as `cursor-installation`).
The corresponding acceptance check uses that path in `evidenceRef`; the path
does not contain the requirement ID.

## Requirement resolution and scope

Every item in `checks` is a required obligation. If an item names a surface
outside `selectedSurfaces`, it remains in `acceptance.requiredChecks` as
`BLOCKED` with a reason and no adapter call. If a selected adapter cannot
evaluate the item's capability/evidence pair, that requirement remains
`BLOCKED`; it cannot cause a caller-selected adapter call. The selected
surface's separate gate-owned installation check may still run. A declared
item is never converted to an excluded `NOT_RUN` check. The
`activation-defect` and `explicit-native` triggers remain required until the
obligation is resolved or the supported scope is changed explicitly, and
installation evidence cannot satisfy either trigger.

For #849, only a non-native check with `capability: "installation-contract"`
together with `evidenceKind: "contract"` may use the actual selected surface's
installation evidence. Every other capability/evidence combination remains
required and non-passing. An in-scope native or explicit-native check is
`PENDING` when authorized and `BLOCKED` when unauthorized because this slice
has no native runtime executor. A check with the `activation-defect` or
`explicit-native` trigger has that same native-obligation behavior, even if
its capability and evidence kind otherwise match the installation pair. An
out-of-scope requirement is always `BLOCKED`, regardless of authorization.
None of these states invokes a native adapter. An optional surface with no
declared requirement and outside the selected scope may be omitted or recorded
as excluded with its applicability reason. Installation checks generated by
the gate owner cannot be removed or downgraded by caller input.

## Installation and runtime observations

The CONSUMER envelope retains raw `surfaceResults` and distinct
`installationEvidence` and `runtimeEvidence` records. Ordinary `codex-sync`
acceptance verifies installation, ownership, physical role materialization,
resource closure, and surface discovery; it does not start a Codex prompt or
named-role probe. A successful check leaves the raw `codex-sync`
`runtimeEvidence.status` as `NOT_RUN`.

The `agent-plugin` probe uses Cursor Agent tooling. The `cursor-plugin`
installation contract includes validation of the sibling Agent Plugin package
closure required by its consumer route. These package and structural checks may
pass installation acceptance while raw runtime remains `NOT_RUN` or
`UNAVAILABLE`. Neither `CI` nor inherited `DHPK_CONSUMER_PROBE_EXECUTE` may
activate plugin-directory runtime execution through the ordinary acceptance
path. No runtime result is inferred from package copy or static materialization.

## Version 2 report and verdict

A new CONSUMER report carries `schemaVersion: 2` and:

```json
{
  "schemaVersion": 2,
  "acceptance": {
    "verdict": "PASS",
    "requiredChecks": [
      {
        "id": "install.cursor-sync",
        "surface": "cursor-sync",
        "kind": "installation",
        "reason": "The selected installation contract passed.",
        "status": "PASS",
        "evidenceRef": "surfaceResults.cursor-sync.installationEvidence"
      },
      {
        "id": "requirement.cursor-installation",
        "surface": "cursor-sync",
        "kind": "contract",
        "reason": "The declared installation contract passed.",
        "status": "PASS",
        "evidenceRef": "surfaceResults.cursor-sync.requirementEvidence.check1"
      }
    ],
    "excludedChecks": []
  },
  "surfaceResults": [
    {
      "surface": "cursor-sync",
      "status": "NOT_RUN",
      "installationEvidence": { "status": "PASS" },
      "requirementEvidence": {
        "check1": { "id": "cursor-installation", "status": "PASS" }
      }
    }
  ]
}
```

Each output check has exactly `id`, `surface`, `kind`, `reason`, `status`, and
`evidenceRef`. `kind` is `installation`, `contract`, `native`, or `research`;
`PENDING` is an acceptance status, not an observed consumer status. Each list
contains at most 100 entries, and IDs are unique across both lists. A passing
check requires an `evidenceRef`. A non-null reference uses a supported path
under `surfaceResults`, addresses the same surface, and resolves to an observed
object whose `status` exactly equals the check's status. The serialized
`surfaceResults` remains an array: `<surface>` in the reference is a logical
selector for the entry whose `surface` field matches, followed by object-field
segments. It is not a JSON array index or literal property on the array. The
normalizer rejects dangling, cross-surface, or mismatched-status references.

`requiredChecks` is non-empty. Acceptance is calculated only from that list:

| Required check outcomes | Acceptance verdict |
| --- | --- |
| Any `FAIL` | `FAIL` |
| No `FAIL`, and any status other than `PASS` | `BLOCKED` |
| Every status is `PASS` | `PASS` |

Excluded checks retain their real status and reason but do not affect the
verdict. The top-level CONSUMER `verdict` MUST equal `acceptance.verdict`. The
policy CLI exits 0 for `PASS`, 1 for `FAIL` or `BLOCKED`, and 2 for usage or
requirements-input errors.

The `codex-sync` default can therefore report installation PASS and raw runtime
`NOT_RUN` in one envelope without conflating those results. A projected plugin
installation PASS can coexist with raw runtime `UNAVAILABLE` or `NOT_RUN`.
Installation acceptance never sets `runtimeVerified: true`. That field is
permitted only when backed by valid, current native capability evidence; #849
does not generate such evidence. A v2 normalizer rejects or removes an
unsupported `runtimeVerified: true` value.

Historical reports without `acceptance` retain their original unversioned
schema, status semantics, and exit conventions. Reading a historical report
does not synthesize `schemaVersion: 2`, acceptance checks, or runtime
verification.
