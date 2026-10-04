# Installation contract as the default consumer acceptance

Status: accepted design for issue #849

## Context

The selected-surface consumer gate already records installation and runtime
observations, but treating native execution as a prerequisite for every
installation made ordinary acceptance depend on a model or interactive
consumer. That conflates whether the supported installation contract was
materialized with whether a host runtime was separately exercised. It also
makes CI or an inherited execution variable capable of expanding the work
beyond the selected installation scope.

Issue #849 settles the contract for default selected-surface acceptance and the
bounded `--requirements` input used to keep explicit obligations visible.

## Decision

The existing `scripts/release/consumer-gate.js` remains the public selected-
surface entrypoint. Ordinary acceptance uses the selected installation
contract and makes no native runtime call. The CONSUMER envelope preserves raw
installation and runtime evidence separately, and the new schema-v2
`acceptance` object is the authoritative acceptance verdict.

The durable field-level contract is in
[`docs/contracts/consumer-acceptance.md`](../contracts/consumer-acceptance.md).
The selected surface IDs and Host mapping remain fixed in the consumer gate;
scope never expands because a CLI is present or a process is running in CI.

When neither `--surface` nor `--requirements` supplies an explicit scope, the
default includes only surfaces configured by the exact local target markers
defined in the
[consumer acceptance contract](../contracts/consumer-acceptance.md). This
follows [ADR-0002](0002-scope-validation-to-configured-platforms.md):
configuration is determined from repository files, never from `PATH` or client
availability. A marker selects a delivery surface but does not prove its host
client is installed. Unrequested unconfigured surfaces are recorded in
`excludedChecks` as `NOT_CONFIGURED`, name the absent marker, and invoke no
adapter. An explicit `--surface` or requirements scope overrides that filter
and runs its selected adapter, whose result establishes whether prerequisites
are available. If no local marker configures any surface and no scope was
explicitly selected, acceptance contains a required `scope.configuration`
BLOCKED check for `consumer-scope`, with a null evidence reference, and invokes
no surface adapter. This is a missing-scope result, not a hidden required Host.
When at least one configured surface is selected, another unconfigured
optional surface remains excluded as `NOT_CONFIGURED` independently of the
selected installation result. The empty configured scope cannot become a
vacuous PASS.

Every declared requirements-file check remains a required obligation. The
input may not invoke arbitrary commands or select adapters. Only
`capability: "installation-contract"` with `evidenceKind: "contract"` can use
installation evidence. Other capability/evidence pairs fail closed. Native
requirements stay PENDING when authorized and BLOCKED when unauthorized;
#849 implements no native executor. An obligation outside the selected adapter
scope remains required and BLOCKED without an adapter call. Unrequested,
optional surfaces are the only surfaces eligible for exclusion.

Each declared check is recorded in its original one-based input slot at
`surfaceResults.<surface>.requirementEvidence.checkN`. The evidence value
retains the validated requirement ID in its `id` field, while the acceptance
check's `evidenceRef` points to the stable slot path without embedding that ID.

Successful installation does not promote runtime evidence, set
`runtimeVerified`, change a support tier, establish marketplace approval, or
complete a release publication. In ordinary `codex-sync` acceptance the
installation contract may PASS while `runtimeEvidence.status` remains
`NOT_RUN`. For projected plugin checks, CI and inherited
`DHPK_CONSUMER_PROBE_EXECUTE` do not enable runtime execution; projected
installation evidence remains separate from the raw runtime state.

The `cursor-plugin` installation contract includes its required sibling Agent
Plugin package closure. This supports the documented consumer path while
leaving native `--plugin-dir` execution as separate runtime evidence.

## Compatibility and conflict boundary

This decision scopes the existing Codex named-role probe requirement to an
explicit native obligation. The role-dispatch scenarios in the
[post-install validation specification](../../openspec/specs/consumer-post-install-validation/spec.md)
remain the acceptance criteria when such a native check is requested; they are
not prerequisites for ordinary installation acceptance.

This ADR does not supersede ADR-0024's requirement for actual consumer
execution evidence before selecting or claiming a public plugin workflow,
native support, or submission readiness. It does not establish a fresh-session
runtime result or OpenAI approval. It also preserves the distinct release proof
boundaries in [ADR-0021](0021-three-proof-release-model.md): consumer
installation acceptance is not authorization to merge, tag, publish, or
deploy.

## Consequences

- Required installation failures remain FAIL; unresolved required checks,
  unavailable adapters, missing authorization, and explicit native requests
  remain non-passing.
- The report presents PASS, FAIL, or BLOCKED from required checks and preserves
  excluded observations without fabricating a success.
- Historical unversioned evidence remains on its original schema and does not
  gain synthesized acceptance or runtime verification.
- Native runtime execution remains an independently authorized evidence task;
  absence of a runtime executor is visible as PENDING or BLOCKED, not PASS.
