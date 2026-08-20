## Context

dhpk has a canonical inventory and a shared compiler/artifact-store pair, but four package implementations still repeat projection policy, filesystem handling, validation, generator CLIs, and tests. This gives callers a large surface to learn and makes verification locality poor. Gemini CLI references are interwoven with the separate AGY native plugin even though AGY has a current, independently validated plugin Interface.

## Goals / Non-Goals

**Goals:**

- Make one inventory-driven distribution Module the only owner of common projection behavior.
- Keep every approved surface while reducing a content change to canonical source plus inventory selection.
- Remove all dhpk-owned Gemini CLI compatibility while retaining native AGY package and worker behavior.
- Retain only tests that establish a core, Adapter, CLI, or repository-integration Interface.

**Non-Goals:**

- Add Gemini CLI migration, extension support, or a new platform.
- Claim runtime consumer support from static package checks.
- Preserve old generator/validator command compatibility.

## Decisions

### One deep distribution Module

`compileDistribution`, `materializeDistribution`, and `verifyDistribution` remain the public Module Interface. The Module owns selection, intent, publication, provenance, rollback, and evidence result shape. `ProjectionArtifactStore` is its only filesystem seam. This preserves a known small Interface while deleting repeated Implementation logic.

### Declarative surface Adapters

Each retained surface declares only layout, source transforms, manifest template, and consumer probe. An Adapter cannot scan a conventional directory for membership, write directly, choose an output outside the plan, or reinterpret common verdicts. Cursor portable content remains owned by Agent Plugin; its native overlay contains only Cursor-native files unless an inventory-declared overlay is required.

### One distribution CLI, no compatibility layer

`dhpk distribution <surface> <generate|validate|verify>` is the sole public maintained command seam. Public documentation, CI, release gates, and consumer automation use it exclusively. Test-specific scripts may remain as private integration fixtures while their Adapter library contracts are retained; they are neither documented nor compatibility Interfaces. This lowers long-term Interface size without obscuring adapter-level deterministic checks.

### AGY is native; Gemini CLI is retired

AGY package validity is established through the native `plugin.json` layout and `agy plugin validate`. AGY remains experimental because structural, discovery, and runtime proof stay independent. Gemini CLI conversion, import, configuration, documentation, and tests are removed. References to an AGY provider model remain only where verified by the live `agy` command and are not Gemini CLI support.

### Test ownership replaces script-count ownership

Core projection invariants have one contract suite. Each Adapter has one suite for its unique transform/probe. CLI suites verify public arguments, JSON, and exit behavior. One integration gate generates temporary artifacts and compares the tracked projections. Exact counts, internal success prose, and repeated atomic-write scenarios are not public Interfaces and are removed.

## Risks / Trade-offs

- [Breaking commands disrupt automation] → Publish migration table and release note; provide no silent fallback.
- [Removing duplicate tests hides a true adapter defect] → Migrate only after a focused Adapter contract proves its unique behavior and the full integration gate passes.
- [AGY upstream paths differ by client release] → Record exact `agy --version`, validate package with the installed CLI, and report unavailable runtime probes honestly.
- [Generated projection drift] → Generate in a temporary root and compare provenance/output before accepting tracked output.

## Migration Plan

1. Create characterization tests at the new Module and Adapter seams.
2. Route all retained package generation and validation through the shared Module.
3. Replace CI with the four contract layers, then remove duplicate test/generator files.
4. Delete Gemini CLI code and references; verify no dhpk-owned Gemini CLI route remains.
5. Regenerate retained projections, update docs, run full gates, and release as breaking.

Rollback is a Git revert of the release commit. Consumer rollback uses the existing receipt-owned uninstall/rollback mechanism for each retained surface; it never deletes an entire consumer configuration directory.

## Open Questions

None. AGY native package and AGY fast-worker are retained; Gemini CLI support is removed.
