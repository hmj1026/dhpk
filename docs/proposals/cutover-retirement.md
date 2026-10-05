# Proposed cutover and compatibility retirement procedure

Status: Proposed procedure for review. Source mapping is complete; concrete destination planning remains PARTIAL. Installation cutover and compatibility retirement remain NOT_RUN. Publishing or merging this document is not apply or retirement authority.

## Scope and evidence identity

This procedure is separate from the [#817 telemetry proposal](session-usage-telemetry/proposal.md). Existing owners: [distribution surface governance](../../openspec/specs/distribution-surface-governance/spec.md), [projection contract](../../openspec/specs/distribution-projection-contract/spec.md), [skill retirement migration](../../openspec/specs/skill-retirement-migration/spec.md). Current policy: [follow-up disposition](../contracts/host-runtime-followup-disposition.md). The versioned disposition contract owns the historical task mapping; its task states remain unchanged.

A read-only planning probe on source commit `f120e05d9f7b998f94774a38475d1907825c27ec` ran `bash bin/dhpk-install cursor plan --scope project --json` with exit 0. Its structural compile verdict was PASS, lifecycle verdict NOT_RUN, and preview mutation false. The detailed receipt is local, ignored provenance, unavailable in a fresh checkout. This dated probe established deterministic selection planning; it did not inspect installed destination ownership, migration or consumer acceptance. A concrete apply must use a fresh plan for its exact candidate and target.

## Existing public seams and ownership

The [installation guide](../platform-installation.md) is the operating source; [distribution surfaces](../distribution-surfaces.md) owns surface membership. `scripts/lib/dhpk-install-lifecycle.js:158` compiles source identity and selection; it does not read concrete destination path state. Graph query identified compileLifecyclePlan and installation/projection owners; cx definition confirmed the read-only contract. This proposal changes no executable behavior.

| Surface | Read-only seam | Receipt / destination owner | Later writer |
| --- | --- | --- | --- |
| Unified lifecycle | `bash bin/dhpk-install <surface> plan --scope project --json` | Selection identity; no destination receipt inspection implied | Generic writes remain BLOCKED / NOT_IMPLEMENTED |
| Codex sync | `install-codex-skills.sh --update --plan --json` from the selected consumer root | `.codex/.dhpk-installed.json`, schema-v3 managed entries | Existing explicit update/migrate/uninstall adapter |
| Cursor sync | `install-cursor-harness.sh --update --plan --json` from the selected consumer root | `.cursor/.dhpk-installed.json`, schema-v3 managed entries | Existing explicit update/migrate/uninstall adapter |
| AGY native | `node scripts/ci/install-agy-plugin.js plan --source plugins/dhpk-agy --json` | Canonical or explicitly selected target plus native provenance receipt | Explicit transactional migrate/update adapter |
| Shared project skills | Existing project projection validation and receipt inspection | `.agents/.dhpk-installed.json` owns shared content and Host bindings | Compiler-owned gen-agents-skills route; do not assume its default generation is read-only |
| Claude / client packages | Client status and package/provenance inspection | Client-managed selected package identity | Client package update/remove route |

These are source mappings, not commands executed against a live destination. Codex native stays experimental and isolated; active project/native overlap must fail duplicate discovery. Cursor native components and portable Agent Plugin are separate owners. Removing a Host binding must preserve shared skills still used by remaining Hosts.

## Required concrete plan before apply

The operator must select the consumer project/target, predecessor route and exact successor artifact. Bind source commit/tree, package version/digest, inventory revision, profile/selected stable IDs, Host/configuration, receipt schema and current digest, owned roots, per-path previous/current/expected fingerprints and intended action. Missing facts remain null/UNAVAILABLE. Re-run the correct adapter plan against that target; the generic selection receipt alone is insufficient.

| Observed path state | Planned treatment |
| --- | --- |
| Unchanged receipt-owned entry | Eligible only for its approved update/migrate/remove action |
| Modified receipt-owned entry | Preserve bytes; report path-specific conflict |
| Unowned or foreign entry | Preserve; no implicit adoption |
| Orphaned entry | Preserve and report; ownership does not follow filename similarity |
| Retargeted symlink, malformed or ambiguous receipt | Fail closed and preserve content |
| Candidate/receipt/path changed after planning | Invalidate plan and recompute before any write |
| Both AGY canonical and legacy targets | BLOCKED / AMBIGUOUS_TARGETS; no automatic selection |

Explicit approval for one collision covers only that path. Before authorized apply, save receipt and per-path identities, backup only the approved owned content, and record the transaction's exact changed-path list. Partial failure uses the adapter-owned journal/rollback; restore only provably transaction-owned changes, preserving foreign or newly modified content. If that proof fails, stop and report manual recovery rather than overwrite.

## Ordered acceptance gates

1. Complete historical T-1 with a concrete destination and successor identity, adapter plan, receipt and per-path fingerprints. Current checkpoint is PARTIAL because those facts were not selected or inspected.
2. Only if a demonstrated behavior gap exists, scope historical T-2 under its existing owner; require disposable collision/stale-plan/partial-failure evidence before implementation acceptance. No new behavior gap or implementation is asserted here.
3. After successor publication, perform exact-artifact installation/consumer acceptance for relevant Hosts and prove one intended discovery route. Native runtime evidence is conditional on the accepted trigger policy; installation evidence is not runtime evidence. Prove removal of one Host binding retains shared content/discovery for remaining Hosts. Current T-3: NOT_RUN.
4. Evaluate a named compatibility route only after applicable publication and successor acceptance. Enumerate consumers/references, lifecycle/deprecation window, scoped removal and recovery path. Require separate retirement authority. Current T-4: NOT_RUN.

## Outstanding facts and handoff

Destination project, predecessor installation receipt, successor publication identity and live path fingerprints: UNAVAILABLE in this planning checkpoint. Publication, consumer acceptance, migration, retirement and native model runs: NOT_RUN. Publishing this procedure changes no installed state, global configuration, generated output or compatibility route. It does not replace accepted policy. Detailed run evidence remains local and ignored.
