# Host runtime follow-up disposition

Status: accepted policy record for #854. This contract records the disposition
of the twelve historical tasks from the three ignored OpenSpec follow-ups. It
does not claim that any task was executed or completed. The source plans remain
local provenance; this tracked contract is the fresh-checkout policy source.

## Current engineering scope under #888

[#888](https://github.com/hmj1026/dhpk/issues/888) consolidates the engineering
work from [#886](https://github.com/hmj1026/dhpk/issues/886#issuecomment-6007991007)
and [#887](https://github.com/hmj1026/dhpk/issues/887#issuecomment-6007991325).
Their closure records consolidation, not completion of historical native
observations or a live consumer migration.

The current package contract uses the shared common catalog, the existing main
Claude marketplace identity, and the skills-only OpenAI submission route.
Cursor and AGY remain supported with lower priority. Source, installation,
ownership, necessary-resource, and deterministic package checks provide the
engineering checkpoint. Native/model/GUI observations are conditional on a
corresponding integration change or explicit request; context and planner
comparisons remain separately requested research. The historical strict
eight-row baseline and every `FAIL`, `PARTIAL`, or `NOT_RUN` result retain their
original scope and status.

No named live consumer, predecessor/successor installation, or successor
publication is supplied by this consolidation. Cutover and removal therefore
remain deferred to a separately authorized owner; no generic live migration
executor is introduced. Historical named-profile receipts retain exact stored
scope for read, plan, uninstall, and recovery, and updates are `BLOCKED` before
mutation. Unannotated older receipts keep their existing structural migration
route. Protected local copies are preserved rather than counted as fresh
package membership.

The register and ignored follow-up task lists below remain historical
provenance. Current implementation progress and applicable verification are
recorded on #888; this disposition does not mark those historical tasks done.

## Decision vocabulary

`RETAINED` remains an owned task; `CONDITIONAL` is required only for its named
trigger; `RESEARCH` is an independently requested measurement; `OUT OF SCOPE`
removes a routine gate while preserving the historical task. No task below is
cancelled. A disposition never changes historical `NOT_RUN` or `FAIL` into
`PASS`.

## Traceability register

The exact source is `/home/paul/projects/dhpk/openspec/changes` in the original
checkout. SHA-256 hashes identify the provenance even when ignored plans are
absent from a fresh checkout.

| Follow-up | Source | SHA-256 | Disposition | Owner / required evidence |
|---|---|---|---|---|
| marketplace-native-observation-followup | tasks.md:3-6 | `94985128b3fc8d957bd2487051b04fc5f70ccd410c66831c2816ff762fe0fda9` | T-1 `CONDITIONAL`; T-2–T-4 `RESEARCH` | consumer/research owner; exact Host, artifact, session and configuration evidence when requested |
| marketplace-native-procedure-followup | tasks.md:3-6 | `bb8cfb5b152157eb6dad6f2575d207ecd840f311cc64a257611759a6e94069dd` | T-1/T-2/T-4 `RETAINED`; T-3 `RETAINED + CONDITIONAL INTEGRATION` | source, selector, parity and procedure owners; task-specific evidence, native evidence only on trigger |
| marketplace-cutover-retirement-followup | tasks.md:3-6 | `ce8bb3cff1ece266e146805e8c343785587a15490619a3e206715d2e4a39a694` | T-1/T-3 `RETAINED`; T-2/T-4 `CONDITIONAL` | migration owner; receipt, ownership, recovery, compatibility, publication and authorization evidence |

### Existing capability owners and evidence by qualified task

The links below identify existing capability owners, not person assignments.
Each evidence cell states what must be produced to close that task; a
disposition does not mean that the evidence exists or that the task is closed.

| Qualified task | Existing capability owner(s) | Evidence obligation |
|---|---|---|
| marketplace-native-observation-followup/T-1 | [Marketplace submission readiness](../../openspec/specs/marketplace-submission-readiness/spec.md); [consumer post-install validation](../../openspec/specs/consumer-post-install-validation/spec.md) | On a named trigger or explicit request, observe the applicable direct, indirect, follow-up, and boundary workflows in a fresh session for the exact candidate; bind output to source, artifact, profile, Host version, configuration, and session. Preserve unavailable evidence as non-pass. |
| marketplace-native-observation-followup/T-2 | [Skill discovery and context budget](../../openspec/specs/skill-discovery-context-budget/spec.md); [consumer post-install validation](../../openspec/specs/consumer-post-install-validation/spec.md) | For requested Cursor research in the supported GUI observation environment, record the rendered initial discovery list and complete context budget with exact candidate and GUI/configuration identity. Package evidence alone does not satisfy the rendered measurement. |
| marketplace-native-observation-followup/T-3 | [AGY CLI subagent plugin](../../openspec/specs/agy-cli-subagent-plugin/spec.md); [skill discovery and context budget](../../openspec/specs/skill-discovery-context-budget/spec.md) | For requested AGY research, record direct skill-discovery output and initial-context observation bound to candidate, supported Host/version, and configuration. Onboarding alone is not measurement evidence. |
| marketplace-native-observation-followup/T-4 | [Skill discovery and context budget](../../openspec/specs/skill-discovery-context-budget/spec.md) | For requested strict-baseline research, retain the unchanged evaluator's complete report and supporting Host results for all eight rows independently. Strict baseline passes only if every declared row passes; keep ChatGPT Work separate and unavailable rows non-pass. |
| marketplace-native-procedure-followup/T-1 | [Workflow plugin catalog](../../openspec/specs/workflow-plugin-catalog/spec.md); [orchestration evidence lifecycle](../../openspec/specs/orchestration-evidence-lifecycle/spec.md); canonical [flow-guide](../../skills/flow-guide/SKILL.md), [flow-drive](../../skills/flow-drive/SKILL.md), [tdd-workflow](../../skills/tdd-workflow/SKILL.md), [repo-verify](../../skills/repo-verify/SKILL.md), and [update-docs](../../skills/update-docs/SKILL.md) capability files | Record separate current task-specific completion outputs and focused branch/effect evidence for historical 4.2 planning and policy blockers, 4.3 implementation/TDD handoff, and 4.4 read-only verification/documentation effects. Close each only against its existing capability owner and evidence; carry forward review only when current policy requires it. |
| marketplace-native-procedure-followup/T-2 | [Skill discovery and context budget](../../openspec/specs/skill-discovery-context-budget/spec.md); [skill usage discovery](../../openspec/specs/skill-usage-discovery/spec.md); [skill directory self-containment](../../openspec/specs/skill-directory-self-containment/spec.md) | Record per-selector/task-version results for standalone-copy behavior, sibling-version exclusion, resource resolution, and public discovery counts against the current selectors and tests. Record each source gap or no-code decision independently. |
| marketplace-native-procedure-followup/T-3 | [Host provider capability matrix](../../openspec/specs/host-provider-capability-matrix/spec.md); [orchestration model configuration](../../openspec/specs/orchestration-model-config/spec.md); [AGY CLI subagent plugin](../../openspec/specs/agy-cli-subagent-plugin/spec.md); [provider/Host boundary decision](../adr/0020-provider-is-a-model-vendor-not-a-host-runtime.md) | Preserve evidence that #847 did not change model defaults. Reconcile schema and source/default gaps; for AGY, report schema, actual tool-call, timeout-negative, generated-artifact, and fresh-session results separately. When triggered, bind actual Host/version evidence to each claimed model, effort, permission, role, or tool behavior; scope any new gap to its existing owner. |
| marketplace-native-procedure-followup/T-4 | [Distribution projection parity](../../openspec/specs/distribution-projection-parity/spec.md); [consumer acceptance contract](consumer-acceptance.md) | Retain independent usage/provenance parity evidence and the selected installation-contract result. Identify each artifact and stage; keep structural, package, installation, and runtime results separate, and reconcile accepted policy changes under the current owner. |
| marketplace-cutover-retirement-followup/T-1 | [Distribution surface governance](../../openspec/specs/distribution-surface-governance/spec.md); [distribution projection contract](../../openspec/specs/distribution-projection-contract/spec.md); [skill retirement migration](../../openspec/specs/skill-retirement-migration/spec.md) | Produce source/spec references and a deterministic read-only plan identifying source, destination, receipt, supported Hosts, current path states, successor artifact, and plan seam. Package generation alone does not prove an installed migration. |
| marketplace-cutover-retirement-followup/T-2 | [Skill retirement migration](../../openspec/specs/skill-retirement-migration/spec.md); [distribution surface governance](../../openspec/specs/distribution-surface-governance/spec.md); [distribution projection contract](../../openspec/specs/distribution-projection-contract/spec.md) | Only after T-1 demonstrates an unowned behavior gap, record the existing owner and exact source/public seam. Use disposable fixtures for unchanged receipt-owned, modified managed, unowned/foreign/orphaned, collision, changed-after-plan, and partial-failure paths; prove preserved content is byte-identical. |
| marketplace-cutover-retirement-followup/T-3 | [Distribution surface governance](../../openspec/specs/distribution-surface-governance/spec.md); [distribution projection contract](../../openspec/specs/distribution-projection-contract/spec.md); [consumer acceptance contract](consumer-acceptance.md) | After successor publication, record exact-artifact acceptance and unique discovery for each relevant supported Host, plus coexistence evidence that removing one Host binding preserves shared content and discovery for remaining Hosts. Keep source, structural, package, and runtime results separate; run native checks only on a named trigger or explicit request. |
| marketplace-cutover-retirement-followup/T-4 | [Skill retirement migration](../../openspec/specs/skill-retirement-migration/spec.md); [distribution surface governance](../../openspec/specs/distribution-surface-governance/spec.md); [consumer acceptance contract](consumer-acceptance.md) | Consider retirement only after applicable successor publication and exact-artifact acceptance pass. Record remaining references, scoped removal and recovery path, and separate removal authority; missing or non-pass required evidence leaves retirement open. |

## Original tasks and disposition

### marketplace-native-observation-followup

**T-1 — CONDITIONAL / OUT OF SCOPE AS ROUTINE GATE.** Original: “Capture
Claude direct, indirect, follow-up, and boundary workflows in a fresh session
for the exact current candidate. Prerequisite: supported Claude configuration
and available execution context. Evidence: direct Host output bound to source,
artifact, profile, Host version, configuration, and session. If unavailable,
preserve the row as non-pass.” Routine complete workflow observation exits the
required backlog. A named loader/integration defect, affected mechanism, or
explicit native request still requires the exact affected cases; unavailable
evidence stays unavailable.

**T-2 — RESEARCH.** Original: “Capture Cursor's rendered initial discovery list
and complete context budget using the supported GUI observation environment.
Prerequisite: exact current candidate is installed or selected in that
environment. Evidence: observed list and budget result with candidate and
GUI/configuration identity; a package-only result does not satisfy runtime
observation.” This is opt-in discovery and budget research. A concrete defect or
explicit performance requirement can make a bounded check necessary; package
evidence never substitutes for requested rendered measurement.

**T-3 — RESEARCH.** Original: “Capture AGY's actual skill discovery and initial
context after normal operator onboarding. Prerequisite: supported AGY version
and configuration. Evidence: direct discovery output and context observation
bound to the candidate and Host; onboarding alone does not satisfy the task.”
This remains independent research with direct-observation requirements intact.

**T-4 — RESEARCH.** Original: “Run the unchanged strict evaluator against the
current evidence and account for all eight rows independently. Evidence: the
evaluator's complete report and supporting Host results. Close the strict
baseline only when every declared row passes; keep ChatGPT Work separately
identified and preserve every unavailable row as non-pass.” The evaluator is
unchanged, reports every row, and remains outside ordinary delivery; unavailable
rows remain non-pass.

### marketplace-native-procedure-followup

**T-1 — RETAINED.** Original: “Reconcile the original completion/workflow task
separately: preserve historical 4.2 planning and policy-blocker cases, 4.3
implementation/TDD handoff, and 4.4 read-only verification/documentation
effects. Check current task-specific completion outputs and focused branch/effect
evidence; carry forward only review work required by current policy. Close each
item only against its exact owner and evidence.” Source-gap rows remain separate
and are not closed by this policy. Current review follows the advisory reviewer
policy and does not restore retired Review Gate artifacts.

**T-2 — RETAINED.** Original: “Reconcile the original specialist-reference
task (historical 4.5). Check current task/version selection, standalone copy
behavior, sibling-version exclusion, resource resolution, and public discovery
counts against the existing selectors and tests. Record each source gap or
no-code decision independently.” These deterministic owner checks remain and
each gap requires its own evidence.

**T-3 — RETAINED + CONDITIONAL INTEGRATION.** Original: “Reconcile the original
optional Host/role task and historical 4.8/4.9. Record that the #847 baseline
did not change model defaults; do not inherit old proposed model values as a
current decision. Check the actual Host/version model, effort, permission,
role, and tool behavior when claimed. For AGY, retain schema, actual tool-call,
timeout-negative, generated-artifact, and fresh-session cases. If evidence shows
a source/default gap, define a separate owner-scoped implementation decision
rather than closing or suppressing it here.” The #847 decision and each AGY
case remain traceable. Native checks are conditional on an affected mechanism
or explicit native acceptance; no blanket Host matrix is required.

**T-4 — RETAINED.** Original: “Reconcile the original parity/installation-
contract task. Reuse current independent usage/provenance parity evidence and
identify the selected installation contract. Keep static parity, installation,
and runtime as separate stages; change an accepted specification only if
observed behavior differs from its current owner.” Parity, installation and
runtime remain separate. The final sentence is superseded where #848 changes
accepted applicability policy; owners may update policy without inventing a
behavior mismatch.

### marketplace-cutover-retirement-followup

**T-1 — RETAINED.** Original: “Map the current executable profiles and
installers to their accepted ownership and lifecycle contracts. Define the exact
source, destination, receipt, supported Hosts, current path states, successor
artifact, and read-only public plan seam. Evidence: source/spec references and a
deterministic plan result; package generation alone does not establish installed
migration.” The map and plan remain required. No installed migration is claimed.

**T-2 — CONDITIONAL.** Original: “If T-1 finds an unowned behavior gap, define
and implement the narrow plan/apply/recovery change under its existing owner.
Name exact source files and public seam before implementation. Use disposable
fixtures for unchanged receipt-owned paths, modified managed paths,
unowned/foreign/orphaned paths, path collisions, changed-after-plan state, and
partial failure. Show that preserved content remains byte-identical.” This starts
only after a demonstrated gap and owner decision; all listed fixtures remain
required when triggered.

**T-3 — RETAINED + CONDITIONAL NATIVE CHECKS.** Original: “After successor
publication, verify exact-artifact consumer acceptance and unique discovery for
each relevant supported Host. Verify that removing one Host binding preserves
shared content and discovery for the remaining Hosts. Keep source, structural,
package, and runtime results distinct.” Publication, applicable acceptance,
unique discovery, coexistence and shared-content preservation remain
prerequisites. Native checks are limited to the relevant trigger or explicit
request. This ticket performs none of those operations.

**T-4 — CONDITIONAL.** Original: “Consider a named compatibility route for
retirement only after T-3 passes for its relevant consumers. Record remaining
references, the scoped removal and recovery path, and the separate retirement
decision. If publication or any applicable consumer result is missing or
non-pass, leave retirement open.” Retirement remains separate after applicable
publication, acceptance, live-reference/recovery review and explicit removal
authority. No retirement or removal occurred.

## Authority and historical state

This contract preserves ownership, retention/recovery, coexistence, unique
discovery, compatibility, publication alternatives and authorization
boundaries. It does not close the parent issue, execute a Host/model workflow,
perform cutover or retirement, publish a package, or grant release/deployment
authority.
