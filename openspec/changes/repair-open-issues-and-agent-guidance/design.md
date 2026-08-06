## Context

The proposal crosses four runtime boundaries and three documentation layers:

1. Claude consumes skill frontmatter through an official YAML validator, while dhpk's current source gate uses a deliberately small parser.
2. `scripts/install.sh` has a jq-optional Python fallback that currently embeds user-controlled paths and preset names in Python source.
3. Codex has a canonical `codex/skills` projection, an installed native package, and project-local fallback trees whose receipt can predate the current naming scheme.
4. Skill-health and routing documentation are themselves agent-facing APIs. Matt Pocock's `wayfinder`, `wizard`, and `writing-for-agents` provide useful rules, but copying them as new standalone skills would duplicate routing and create another source of truth.
5. The paired `docs/basic-operations.md` and `docs/basic-operations.zh-TW.md` pages are the user-facing entry point, but recent sessions exposed operational drift: management and invocation need a sharper separation, normal-terminal Codex examples must not rely on `CLAUDE_PLUGIN_ROOT`, official consumer validation is distinct from repository validation, and OpenSpec planning/implementation/archive must not be collapsed into one completion claim.

The repository must continue to support the existing Claude plugin and supported project-local Codex installer, preserve user-owned files, and keep the OpenSpec artifact lifecycle explicit. The current 127 P2 advisories are not a general cleanup target; the two P1 health findings and the four named issues are the acceptance boundary.

## Goals / Non-Goals

**Goals:**

- Make all shipped skill frontmatter acceptable to the official Claude strict validator and retain a lightweight deterministic source check.
- Make preset/profile selection safe for valid paths containing apostrophes, report extraction failures deterministically, and add regression tests for the no-jq path.
- Detect and safely reconcile stale Codex receipts and duplicate fallback/native surfaces without deleting unowned project content.
- Close the two current P1 health findings and prevent their reintroduction.
- Encode Matt's high-value principles in existing routers, authoring/quality guidance, and human-action setup boundaries with checkable completion criteria.
- Require source-first authoring for skills and operational documents: use Context7 for an indexed library/CLI, fall back to the owning official documentation, record the source/version/query or URL, and run the applicable repository and official format checks before content is accepted.
- Produce an implementation order in which each wave has focused tests and a consumer/release evidence gate.
- Re-edit the paired basic-operation guides into an evidence-backed playbook that reflects the current skill router, installation surfaces, session handoff rules, and OpenSpec lifecycle.

**Non-Goals:**

- Do not introduce generic `wayfinder`, `wizard`, or `writing-for-agents` skills in this change.
- Do not build a general-purpose dashboard/provisioning script or execute browser, credential, migration, or cutover actions on behalf of an agent.
- Do not automatically overwrite or remove unowned `.codex` assets, resolve business ownership decisions, or rewrite all existing P2 advisories.
- Do not alter the OpenSpec main specs directly; implementation will apply the delta specs and archive only after verification.

## Decisions

### 1. Keep two frontmatter checks, but make the official check a release consumer gate

Canonical skills will use YAML scalar forms accepted by both the official Claude parser and dhpk's zero-dependency parser. The internal parser remains useful for fast local feedback, but it is not treated as proof of official compatibility. The release/consumer path will run `claude plugin validate ... --strict` against the staged plugin when the CLI is present; absence of the CLI is recorded as `NOT RUN`, never as an official PASS. Regression fixtures will cover the colon-containing descriptions that caused #143.

Alternative rejected: replacing the internal parser with a new full YAML dependency. That would increase the source gate's dependency and still would not prove the actual Claude consumer behavior.

### 2. Pass installer values as data and fail closed at the extraction boundary

The jq-optional path will invoke Python with arguments or environment variables and parse JSON from a file descriptor/path, rather than interpolating values into Python source. Profile lookup and module extraction will have explicit status checks; a failed lookup will stop the operation with a stable diagnostic and non-zero status before any install action. Tests will exercise a temporary plugin path containing an apostrophe, the no-jq branch, invalid preset data, and a dry-run.

Alternative rejected: escaping the current Python string interpolation. Escaping is brittle for future shell/Python metacharacters and leaves error propagation ambiguous.

### 3. Treat Codex reconciliation as an evidence-first projection check

The supported installer and consumer gate will compare source fingerprint, receipt version/schema, canonical names, destination type, and ownership before changing a project. A stale receipt or legacy name set will produce an explicit migration/update state with the exact command needed. Duplicate fallback/native surfaces and mismatched content will be classified in the existing PASS/WARN/BLOCKED matrix. Only dhpk-managed targets may be updated or pruned; collisions and adoption decisions remain visible and reversible.

Alternative rejected: silently auto-migrating every `.codex` entry. The current checkout contains both legacy and canonical names, so silent deletion could destroy user-owned content and would hide the issue #128 evidence.

### 4. Add targeted requirements to existing health and routing contracts

The two missing `When NOT to Use` sections will be restored with neighboring-route links that the linter can resolve. The health contract will add a zero-P1 regression assertion while leaving advisory P2 findings visible. Routing guidance will add a wayfinder threshold (unclear destination plus more than one session/agent), decision-ticket semantics, a plan/spec handoff, and writing-for-agents rules for context pointers, progressive disclosure, completion evidence, and single-source pruning.

Alternative rejected: adding a new router skill. `dhpk-adaptive-dev-workflow`, `dhpk-create-skill`, and `dhpk-skill-quality-judge` already own these decisions; extending them avoids a second invocation path.

### 5. Make human-only procedures explicit and non-executable

`dhpk-project-setup` will describe the wizard boundary: inspect the repository first, enumerate stages and destinations (including secret classification), require a human confirmation gate, and provide static checks such as `bash -n`/shellcheck and destination tracing. Agents may generate or review the procedure but must not run interactive dashboards, credential entry, migration, or cutover steps autonomously.

Alternative rejected: adding a generic wizard template now. The repository does not yet have one stable human-only workflow whose destinations and secret policy could serve as a safe reusable default.

### 6. Make the basic-operation pages a paired, evidence-backed playbook

The implementation will inventory the current English and Traditional Chinese pages against concrete authoritative sources: `skills/dhpk-adaptive-dev-workflow/SKILL.md`, `skills/dhpk-next-step/SKILL.md`, `skills/dhpk-project-setup/SKILL.md`, `rules/execution-policy.md`, `docs/configuration.md`, `docs/skill-platform-migration.md`, `manifests/distribution-inventory.json`, the relevant OpenSpec specs, and the `scripts/install.sh`/Codex installer contracts. It will also use the recent installation, Codex projection, issue-audit, and OpenSpec session evidence. The pages will be reorganized around a short decision ladder (install → verify → route → implement → review → handoff), retain detailed sections for migration/troubleshooting, and add explicit "do not" boundaries for stale receipts, unowned collisions, native Codex support, normal-terminal environment variables, and incomplete OpenSpec lifecycle stages. Snapshot-only counts, versions, and receipt paths will be dated or removed. Both locales will be edited together and checked for section/command/link parity.

Alternative rejected: adding a separate quick-start or operator skill. The existing basic-operation pages already own this user-facing contract; a second guide would make routing and support-tier claims drift.

### 7. Verify sources and formats before authoring

Every skill or operational-document edit will begin with a small source matrix. For a library, framework, SDK, API, or CLI topic, the author will query Context7 when an authoritative entry is available; otherwise the author will use the owning project's official documentation. The matrix will record the source identity, version or retrieval date, query/URL, claims or syntax covered, and the repository/consumer validator that proves the resulting format. Skill frontmatter and invocation metadata will be checked by the local strict validators plus the official consumer validator when applicable; operational commands and links will be checked against the owning scripts, manifests, specs, and official docs. If no authoritative source can be resolved, the affected claim remains explicitly unresolved and cannot be presented as verified guidance.

Alternative rejected: relying only on model memory or repository prose. That can preserve a locally consistent but externally invalid CLI, frontmatter, or configuration contract.

## Risks / Trade-offs

- [Official CLI availability differs by environment] → keep the internal gate for fast feedback, run the official strict check in the consumer/release job, and make missing official evidence visible rather than silently green.
- [Legacy Codex receipts contain user edits] → read and classify first, back up or require explicit migration for collisions, and report counts/fingerprints in the receipt/evidence summary.
- [Expanded routing guidance increases always-loaded context] → keep descriptions as short context pointers, place mechanics in references, and apply a no-op/pruning check before adding new prose.
- [The basic-operation pages become a second source of truth] → link command semantics to current skills, rules, manifests, and OpenSpec specs; use the pages for decision order and reader-facing examples, not duplicated implementation details.
- [Authoritative documentation is unavailable or version-ambiguous] → record `NOT VERIFIED` with the missing source, do not silently infer syntax, and require an owner decision before publishing the claim.
- [English and Traditional Chinese pages drift] → edit them as one task, compare headings/commands/links, and run a bilingual parity/readability review before archive.
- [Issue waves touch shared generators and release gates] → sequence implementation by dependency, run focused tests after each wave, and run the full suite plus consumer checks before archive.
- [A documentation fix can drift from implementation] → every new routing/agent-facing rule gets a scenario in the delta spec and a health or link-validation assertion where practical.

## Migration Plan

1. Apply and test frontmatter/official validation changes for #143. Do not publish while any affected skill fails strict validation.
2. Apply installer value-transport and fail-closed changes for #144, then run no-jq/apostrophe regression tests.
3. Apply Codex stale-receipt, projection, and duplicate-surface diagnostics for #128. Verify legacy receipts in an isolated temporary project and preserve collision backups.
4. Add the two missing health sections and the zero-P1 regression for #145; confirm P2 findings remain advisory and documented.
5. Build the source matrix with Context7 or owning official documentation, then integrate wayfinder, writing-for-agents, and wizard-boundary guidance into the existing skills; validate routing/reference links and format claims before accepting prose.
6. Re-edit the paired basic-operation guides from the current skills and recent session evidence; run link, command, support-tier, and English/Traditional Chinese parity checks.
7. Run internal validators, official Claude strict validation, focused installer/Codex/health/document tests, the full suite, native package generation/verification, and the consumer gate. Archive only after all source, format, and runtime evidence is recorded.

Rollback is wave-scoped: revert the affected implementation and its tests/docs together, leave unowned project assets untouched, and retain any explicit migration backup. A failed official consumer check blocks release rather than triggering an automatic downgrade.

## Open Questions

- Should the official Claude validator run in a pinned CI image (preferred for repeatability) or only in the existing release consumer job when the CLI is available?
- Does the stale-receipt diagnostic need a new receipt schema field, or can the existing version/fingerprint plus legacy-name classification express the state without a migration?
- Which existing project-setup procedure is the first candidate for a reusable wizard template after this umbrella change lands?
