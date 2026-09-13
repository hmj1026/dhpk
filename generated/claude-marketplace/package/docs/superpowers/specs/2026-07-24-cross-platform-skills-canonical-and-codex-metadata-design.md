# Cross-Platform Canonical Skills and Codex Metadata

Date: 2026-07-24
Status: Design complete; pending written-spec review

## Problem

The repository currently has three skill surfaces:

- `skills/`: the primary repository skill tree;
- `modules/*/skills/`: module-owned canonical skill packages;
- `codex/skills/`: the Codex projection, containing both symlinks and physical copies.

The inventory found 68 root skill packages and 37 module skill packages. These
105 canonical package paths are the scope of the metadata audit; a Codex
projection is not counted as a second canonical skill.

The three same-intent skills below currently contain platform-specific drift:

- `bug-investigation`
- `multi-ai-sync`
- `skill-health-check`

The Codex projection currently contains eight symlinked entries and seven
physical entries. In addition, only four of the 105 canonical packages
currently have a Codex `agents/openai.yaml` metadata file. Without a canonical
source and automated gates, behavior and Codex discoverability can silently
diverge after the next edit.

## Goals

1. Establish one portable canonical implementation for the three same-intent
   skills.
2. Convert those three `codex/skills` entries to relative symlinks only after
   their trees are proven equivalent.
3. Add valid, deterministic `agents/openai.yaml` metadata to every canonical
   package under `skills/` and `modules/*/skills/`.
4. Make symlinked Codex projections inherit canonical content and metadata.
5. Add repeatable validation for missing metadata, invalid metadata, stale
   symlink projections, and unauthorized physical Codex copies.
6. Preserve the existing layout test and README correction already present in
   the working tree.

## Non-goals

- Rewriting unrelated skills.
- Making every module skill active in every host product.
- Changing module activation or installation semantics.
- Adding optional UI icons or brand colors without a concrete need.
- Creating a second root-level `openai.yaml`; the repository convention is
  `agents/openai.yaml`.
- Treating `agents/openai.yaml` as runtime compatibility. It is Codex interface
  metadata; the shared `SKILL.md`, references, and scripts still need to be
  portable.
- Removing the remaining physical Codex copies before their module-loading
  limitation and portability have been separately resolved.

## Design

### 1. Canonical package model

Every directory containing a `SKILL.md` in either location below is a canonical
package:

```text
skills/<skill-name>/
modules/<module-name>/skills/<skill-name>/
```

The canonical package owns its `SKILL.md`, supporting references/scripts, and
`agents/openai.yaml`. `codex/skills/<skill-name>` is a projection. It may be a
relative symlink to a canonical package, or a physical copy only when Codex
cannot load the canonical package through its module layout.

The canonical package path, rather than a duplicated Codex path, is the source
of truth for future edits. Relative links use the existing convention:
`codex/skills/<skill-name> -> ../../skills/<skill-name>`.

The source repository assumes a platform that preserves symlinks. If a future
installer targets a platform that cannot preserve them, it must provide an
explicit projection step; silently reintroducing hand-maintained copies is
outside this change.

### 2. Shared cross-platform contract

The merged `SKILL.md` for each of the three skills will be a platform-neutral
contract:

- frontmatter and routing text are checked against the actual loaders;
- the body defines the invariant workflow, evidence requirements, and output;
- commands resolve paths from the repository/workspace context;
- tool availability is handled by capability checks and fallbacks;
- platform-specific UI metadata belongs in `agents/openai.yaml` or another
  explicitly supported adapter surface;
- no platform-specific instruction is removed without a replacement and a
  regression check.

Existing frontmatter fields must be audited before editing. A field meaningful
only to one loader must either be safely ignored by the other loader or move to
a supported platform-specific surface. This is an acceptance gate, not an
assumption about unknown frontmatter behavior.

### 3. Merge contracts

#### `bug-investigation`

The root skill becomes the canonical base, augmented with useful Codex
evidence and repository-workflow constraints. The result retains the five
phases, an evidence chain from symptom to root cause, explicit separation of
diagnosis/fix proposal/implementation, and one output contract.

OpenSpec is an integration path selected by repository context, not an
unconditional platform-specific postcondition. The merge must not weaken the
evidence requirement or turn a verified root cause into a guess.

#### `multi-ai-sync`

The root skill becomes the canonical full tree. Codex-only capabilities such as
`agent_sync.py`, `apply_sync.py`, and required support files are incorporated
after their paths, permissions, and dependencies are made portable. Existing
root evaluation assets and references are preserved.

The merged contract defines one source-discovery, diff, dry-run, apply, and
verification flow. Runtime-specific command examples may remain as adapters,
but they use the same inputs, outputs, exit semantics, and safety gates.

#### `skill-health-check`

The canonical skill combines command-centric Codex checks with Claude-oriented
routing/progressive-loading checks. It distinguishes universal checks,
capability-dependent checks, and advisory checks that a host cannot expose.

The command form works from the repository root and the skill package context.
Skipped capability checks are reported as skipped rather than silently passed.

### 4. Symlink conversion gate

For each of the three skills, conversion is allowed only when:

1. The canonical tree contains every required file from both variants.
2. No script, reference, test, or metadata file is lost.
3. Canonical and former Codex trees match in relative paths, contents, file
   types, and relevant executable modes.
4. Focused validation passes.
5. The relative link resolves and is not dangling.
6. `codex/AGENTS.md` and the layout test stop classifying the entry as a
   physical exception.

After conversion, the intentional physical allowlist is reduced from seven to
these four current module mirrors: `legacy-code-characterization`,
`php56-yii-dev`, `php-pro`, and `yii1-security-audit`. They remain a separate
follow-up because their reason is Codex module loading, not content drift.

### 5. Codex metadata contract

Every one of the 105 canonical packages contains `agents/openai.yaml` with:

- `interface.display_name`: a readable package name;
- `interface.short_description`: 25 to 64 characters;
- `interface.default_prompt`: an actionable prompt explicitly invoking the
  skill as `$<skill-name>`.

Existing valid metadata is preserved and normalized only when necessary.
Missing metadata is generated deterministically with the repository-local skill
creator generator, followed by human review of descriptions and prompts. A
generic generated value is not accepted merely because it parses.

The `$<skill-name>` token must agree with the canonical `SKILL.md` identity. A
directory/frontmatter mismatch is resolved before metadata generation.
Duplicate skill names across canonical paths are reported so routing cannot be
mistaken for one package.

Symlinked Codex packages inherit canonical metadata and do not receive a
second copy. For a remaining physical mirror, metadata is either a symlink to
the canonical metadata or is checked for exact equivalence after its source
relationship is verified.

### 6. Validation and regression gates

A dedicated metadata/layout validator will be added under `scripts/ci/`, or an
existing validator will be extended only if that keeps the contract clearer.
It validates:

- discovery of all canonical root and module packages;
- exactly one `agents/openai.yaml` per canonical package;
- required fields, YAML structure, and description length;
- frontmatter identity versus the metadata prompt token;
- Codex symlink targets and the four-entry physical allowlist;
- no dangling links or unexpected duplicate physical projections.

Focused tests cover the three merged skills and the metadata validator. The
existing `tests/codex-skill-layout.test.js` remains the projection-policy test
and is updated for the reduced allowlist.

The final verification set is:

```text
node tests/codex-skill-layout.test.js
node tests/multi-ai-sync-skill-contract.test.js
node scripts/ci/validate-plugin.js
node scripts/ci/catalog.js --check all
bash scripts/validate/validate-harness.sh
git diff --check
```

Each canonical `SKILL.md` is also checked with the available skill validator.
The full suite is run separately from focused tests; pre-existing
environment-dependent failures are reported as baseline failures rather than
reclassified as regressions from this change.

## Rollout

The implementation proceeds in reversible phases:

1. Freeze the inventory and add red tests for the three merge contracts, the
   105-package metadata contract, and the final physical allowlist.
2. Merge `bug-investigation`, then `multi-ai-sync`, then `skill-health-check`,
   running focused checks after each skill.
3. Compare resulting trees and convert only the three verified Codex
   directories to relative symlinks.
4. Generate metadata in root and module batches, review values, and add the
   validator.
5. Update documentation and run focused/plugin/harness gates, followed by the
   full-suite baseline comparison.

No phase deletes an unrelated user change. A failed parity check stops
conversion for that skill and leaves its physical projection in place.

## Error handling and recovery

- Merge conflict: preserve both behaviors and stop before symlinking.
- Missing or malformed metadata: fail with the canonical package path and
  field; do not leave a misleading placeholder.
- Generic generated metadata: revise the description or prompt and rerun the
  validator.
- Symlink parity failure: keep the physical directory and report differing
  paths.
- Module mirror mismatch: keep the four-entry allowlist and report the source
  relationship for later portability work.
- Unrelated full-suite failure: compare against the captured baseline and report
  it separately; do not weaken new gates to make the aggregate count green.

All changes are source-controlled and revertible by phase. Recovery must not
use broad deletion or reset commands.

## Success criteria

The design is implemented when:

1. The three skills have one reviewed canonical implementation each.
2. The three corresponding Codex directories are relative symlinks and pass
   exact-tree validation.
3. The physical allowlist contains only the four documented module mirrors.
4. All 105 canonical packages have valid metadata with correct identity and
   actionable prompts.
5. The validator catches missing metadata, malformed fields, dangling links,
   and unauthorized physical Codex copies.
6. Focused tests, plugin validation, catalog checks, harness validation, and
   `git diff --check` pass; unrelated baseline failures are documented.

## Review boundary

This document records the approved scope and proposed design only. It does not
claim that the skills have been merged, Codex directories converted, or the 101
missing metadata files generated. Those changes begin after this written design
is reviewed and accepted.
