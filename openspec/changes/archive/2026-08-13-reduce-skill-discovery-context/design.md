## Context

The current `scripts/ci/context-budget.js` measures every inventory skill on every declared publication surface, including optional entries whose descriptions remain host-discoverable. The 2026-08-13 baseline exits non-zero with 18 surface violations across 15 unique skills. The existing distribution inventory already carries stable IDs, public names, legacy names, lifecycle, surfaces, and platform projection metadata, while Codex and portable package validators already compare generated fingerprints. The change must extend those contracts without editing unrelated dirty platform-installation documentation or tests.

The Laravel family currently publishes separate version skills for 5.4, 6, 7, 8, 9, 10, 11, and Mix; PHPUnit publishes separate 9, 10, and 11 entries. Their full descriptions are useful after selection but needlessly repeated in always-visible metadata. React and Next have separate major-specific contracts and are explicitly deferred.

## Goals / Non-Goals

**Goals:**

- Define a machine-readable initial-discovery budget and a strict zero-violation gate for every declared Claude/Codex surface.
- Reduce descriptions to concise routing metadata while preserving positive triggers, exclusions, output expectations, safety boundaries, lifecycle visibility, and stable invocation identifiers.
- Introduce inventory-owned Laravel and PHPUnit family routers with explicit version maps and conditional references.
- Preserve all legacy Laravel/PHPUnit IDs through deterministic aliases, including aliases across every supported publication surface.
- Verify deterministic generation and parity of IDs, public names, aliases, budgets, and source fingerprints.
- Capture React/Next evidence and follow-up scope without merging those families.
- Keep audit, judge, stocktake, GitNexus, investigation, and review ownership distinct.
- Follow the inventory/plan conventions expected by `harden-agent-architecture-governance`, while allowing that dependency's implementation to land later.

**Non-Goals:**

- No implementation edits outside this OpenSpec change directory in the planning phase.
- No React/Next consolidation, source rewrite, or registration change.
- No removal, renaming, or deprecation of existing skill IDs or supported invocation syntax.
- No merge of specialist audit/judge/stocktake/GitNexus/investigation/review roles.
- No host capability claim that optional metadata is hidden when it is still discovery-visible.

## Decisions

### 1. Inventory-owned family router plus thin compatibility aliases

The distribution inventory remains the source of truth for stable ID, public name, lifecycle, surfaces, and alias ownership. Add a versioned `skill_routing_families` section with one family entry per Laravel and PHPUnit group, an explicit selector map, conditional reference paths, and alias rows. A legacy alias stores its original ID, canonical router ID, selector, invocation class, and surfaces. Laravel Mix uses an independent `toolchain: mix` selector under the Laravel family rather than pretending to be a framework major. Validators reject duplicate alias IDs, missing targets, ambiguous selectors, and surface membership drift.

Alternative considered: leave each version skill as an independent canonical description and trim text separately. Rejected because it retains duplicated routing context, cannot guarantee one family-level selection policy, and makes parity across projections harder to prove.

### 2. Keep descriptions as routing metadata; load detail conditionally

Canonical frontmatter descriptions will state only purpose, positive trigger, exclusion/boundary, and output or safety cue. The family router chooses a version based on an explicit version constraint, module/profile signal, or caller-selected alias, then loads only the matching conditional reference set. The always-visible validator measures the description; it does not count conditional reference bodies toward the discovery budget.

Alternative considered: increase budgets or mark optional entries hidden. Rejected because the host still publishes optional descriptions and budget inflation would preserve the context problem rather than fix it.

### 3. Use the existing deterministic projection boundaries

Claude and Codex projections will consume the same inventory-owned router/alias data. Existing public-name and projection validators remain the outer gates; a focused parity validator/test compares sorted stable IDs, public names, aliases, router selectors, budgets, and source fingerprints. Repeated materialization must be byte-identical. Intentional client adaptations remain explicit projection metadata rather than silent copies.

Alternative considered: author separate Claude and Codex alias lists. Rejected because independent lists create exactly the cross-surface drift this change is intended to prevent.

### 4. Preserve role boundaries while reducing context

Audit, judge, stocktake, GitNexus, investigation, and review skills remain separate inventory entries with separate descriptions and routes. Their descriptions may point to one another for handoff, but no alias may cause a role to be selected as a substitute for another role with different scope or evidence output.

Alternative considered: consolidate all audit/review variants into one meta-skill. Rejected because their outputs, authority, and evidence contracts differ and the approved contract explicitly preserves those distinctions.

### 5. Treat React/Next as evidence-only follow-up

The baseline report and plan will retain the measured React/Next entries as follow-up evidence. No React/Next router or alias is introduced here. A later change may decide whether a shared frontend family is safe after reviewing version-floor, Next coupling, and conditional-reference evidence.

Alternative considered: include React/Next in the same router migration. Rejected by the settled scope and existing independent version-floor requirements.

### 6. Gate implementation on the architecture-governance dependency

The design records that `harden-agent-architecture-governance` establishes inventory/plan conventions that implementation MUST consume. Planning may complete first, but no router, alias, inventory, canonical-description, or projection edit may begin until that dependency's compiler/inventory contracts are implemented and verified. This change does not duplicate or supersede those contracts.

## Risks / Trade-offs

- [Risk] A concise alias description may route a request to the wrong major when the project version is ambiguous. → Require an explicit version selector or return a bounded clarification; never infer a precise major from unrelated prose.
- [Risk] A legacy ID may remain in one projection but disappear from another. → Generate both projections from one alias manifest and compare sorted IDs plus fingerprints in parity tests.
- [Risk] Conditional references can be omitted or point outside the package. → Validate every router target as a safe repository path and run reference-resolution tests for every selector.
- [Risk] Budget remediation may remove useful safety cues. → Keep authorization, destructive-action, scope, and completion-boundary cues in always-visible metadata; use the existing role contracts for full detail.
- [Risk] Optional entries may be incorrectly described as undiscoverable. → Retain `discoveryVisible` reporting and document runtime/activation optionality separately.
- [Risk] React/Next follow-up could be mistaken for completed consolidation. → Mark the change explicitly as deferred and add a test that current React/Next IDs and source mappings remain unchanged.
- [Risk] The architecture-governance dependency may change field names before implementation. → Keep field semantics and acceptance criteria in this spec, then map them to the final inventory/plan schema during implementation with a compatibility note.

## Migration Plan

1. Record the current baseline report as a fixture/evidence artifact: 133 discovery-visible entries, 45 optional discovery-visible entries, 18 violations, and 15 unique violating skill IDs.
2. Add the router/alias schema and validator contracts in a backward-compatible form; validate existing inventory entries before changing canonical descriptions.
3. Create shared Laravel and PHPUnit router references and convert existing version entries to concise aliases while retaining IDs, surfaces, invocation classes, and module mappings.
4. Shorten the remaining violating descriptions, preserving routing and safety cues, and run strict context-budget validation until violations reach zero.
5. Generate Claude and Codex projections twice, compare byte fingerprints, then run alias invocation and cross-surface parity tests.
6. Verify no React/Next source or registration changed and record the follow-up evidence for a later change.

Rollback is inventory-first: restore the prior router/alias manifest and canonical description files, regenerate projections, and rerun the pre-change context-budget and projection checks. Do not delete the legacy source/reference paths until a separately reviewed compatibility window permits it.

## Resolved Defaults

- The inventory field is the versioned `skill_routing_families` section; each family owns `router_id`, `selectors`, `references`, and `aliases`.
- Laravel Mix is a `toolchain: mix` selector nested under the Laravel family and remains independently invocable through its legacy alias.
- Deterministic alias-resolution and projection-parity tests are mandatory on every surface. Live Claude/Codex invocation probes run where configured and otherwise retain `NOT_RUN`/`UNAVAILABLE`; static success never substitutes for consumer proof.
- React/Next consolidation requires a separate OpenSpec change with a deterministic version detector, preserved IDs, cross-surface alias parity, no new context-budget violation, and measured routing evidence. Until all are present, the families remain separate.
