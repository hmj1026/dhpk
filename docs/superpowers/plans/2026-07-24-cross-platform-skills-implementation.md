# Cross-Platform Skills Implementation Plan

Design: `docs/superpowers/specs/2026-07-24-cross-platform-skills-canonical-and-codex-metadata-design.md`

## Global constraints

- Canonical inventory is exactly 105 packages: 68 under `skills/` and 37 under
  `modules/*/skills/`.
- Codex is a projection, not a second canonical inventory.
- After the three merges, `codex/skills/bug-investigation`,
  `codex/skills/multi-ai-sync`, and `codex/skills/skill-health-check` must be
  relative symlinks to `../../skills/<name>`.
- The only remaining physical Codex entries are
  `legacy-code-characterization`, `php56-yii-dev`, `php-pro`, and
  `yii1-security-audit`.
- Every canonical package must have `agents/openai.yaml`, with quoted
  `interface.display_name`, 25-64 character `short_description`, and a
  `default_prompt` containing the exact `$<skill-name>` token.
- Preserve all useful behavior/resources from both same-intent variants.
- Use zero-dependency Node validation and the repository's existing tinytest
  harness. Do not add a package manager dependency.
- Run focused tests after each task. Do not claim the full suite is green if
  environment-dependent baseline failures remain.
- Do not alter unrelated user changes or use broad reset/deletion recovery.

## Tasks

### Task 1: portable `bug-investigation` canonical merge

Merge the root and Codex behavioral contracts into `skills/bug-investigation`,
preserving evidence-first five phases, database/cross-layer tracing, repro
requirements, stop-loss handling, all references/scripts, and explicit
repository-policy selection between OpenSpec and brief-plan routing.

### Task 2: portable `multi-ai-sync` canonical merge

Merge the Codex agent-sync/apply helpers into the root canonical tree, preserve
root evaluation assets and references, and unify runtime entrypoint text so the
Codex directory can resolve to the canonical tree without content drift.

### Task 3: portable `skill-health-check` canonical merge

Merge the richer root checks and Codex command-pairing checks into one portable
skill. Preserve recursive discovery, Agent/Task and agent-surface checks,
cross-skill path checks, command capability checks, and portable invocation.

### Task 4: metadata validator and canonical metadata

Add `scripts/ci/validate-openai-metadata.js` and its dedicated test. Validate
canonical discovery, narrow quoted YAML shape, required fields, identity,
lengths, prompt token, duplicate names, projection symlinks, and the physical
allowlist. Generate/review metadata for all 105 canonical packages using the
repository-local skill creator generator.

### Task 5: projection conversion and documentation

After parity checks, convert exactly the three merged Codex directories to
relative symlinks. Update `codex/AGENTS.md` and projection tests. Verify no
dangling links and no unexpected physical copies.

### Task 6: final verification and review

Run focused tests, plugin validation, catalog checks, harness validation,
available skill validators, `git diff --check`, GitNexus change detection, and
the full test suite with a baseline comparison. Perform a final review before
handoff.
