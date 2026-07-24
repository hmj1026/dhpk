# TDD Skill and Fast-Worker Integration

Date: 2026-07-24  
Status: Approved

## Problem

dhpk already has a `tdd-guide` agent that owns RED and test-first decisions, but
the three mechanical implementation workers also accept test scaffolds and
apply the `tdd-guide` GREEN handback. They need shared guidance for behavioral
tests, public-interface seams, non-tautological assertions, and boundary-only
mocking without taking ownership of test strategy or architecture.

The external source at
`/home/paul/projects/matt-pocock_skills/skills/engineering/tdd` supplies the
desired generic TDD reference through `SKILL.md`, `tests.md`, and `mocking.md`.

## Goals

- Ship the external TDD guidance as a discoverable dhpk skill.
- Keep one canonical skill under `skills/tdd/` and expose the same package to
  Codex through `codex/skills/tdd`.
- Preload the skill for `tdd-guide`, `fast-worker`, `codex-fast-worker`, and
  `agy-fast-worker`.
- Preserve role boundaries: `tdd-guide` owns RED/seam decisions; fast workers
  implement an approved GREEN/task spec and verify it.
- Keep non-test work from being forced through a TDD loop.

## Non-goals

- Do not add TDD preloading to `e2e-runner`; it already owns Playwright
  journey semantics and explicitly excludes PHPUnit/unit TDD.
- Do not change dispatch routing, worker backends, model tiers, or sentinel
  behavior.
- Do not add a new test framework, runner, package, or executable script.

## Design

### Skill package

Create `skills/tdd/` with:

- `SKILL.md`: concise, framework-agnostic RED/GREEN/REFACTOR guidance plus
  dhpk's two operating modes.
- `tests.md`: behavior-focused test examples and anti-patterns.
- `mocking.md`: system-boundary mocking and dependency-injection guidance.
- `agents/openai.yaml`: skill-list metadata.

The skill keeps the source's useful principles but adds a subagent boundary:
when loaded by a fast worker, the dispatcher task spec is the pre-approved seam
and behavior contract. The fast worker must not pause for a new user seam
approval, invent behavior, or start a new RED cycle. It applies only the
specified GREEN/test-scaffold change, using the guidance to keep tests focused
on observable behavior and boundary mocks.

### Agent preload

Add `skills: ["tdd"]` to the four agents above. The existing agent contracts
remain authoritative for tools, scope, output, verification, and backend
selection. The skill is advisory context for test-bearing work; it does not
replace the `tdd-guide` dispatch requirement.

### Dual-track exposure

Add `codex/skills/tdd` as an in-repo symlink to the canonical package. The
Codex agent generator is rerun so the generated `tdd-guide` role remains in sync
with its source instructions. No separate Codex-only TDD fork is introduced.

### Documentation/index

Add the skill to `skills/INDEX.md` under feature and bug development so the
manual navigation surface matches the manifest-discovered skill.

## Verification

Run the following after implementation:

1. `quick_validate.py skills/tdd` for frontmatter and naming.
2. `node skills/skill-health-check/scripts/skill-lint.js --skills-dir skills`
   and fix all new TDD P0/P1 findings.
3. `node scripts/gen-codex-agents.js` and verify the generated Codex role.
4. `node scripts/ci/validate-plugin.js` and
   `node scripts/ci/catalog.js --check all` for manifest/catalog integrity.
5. `node scripts/ci/validate-references.js`, `node tests/run-all.js`, and
   `bash scripts/validate/validate-harness.sh`.
6. `git diff --check` and a final diff-scope review.

## Decision

The approved implementation equips the fast-worker family with TDD context,
but constrains that context to the already-approved GREEN/task-spec boundary.
This gives test-bearing worker runs the missing test-quality guidance without
turning a mechanical worker into a second test strategist or duplicating the
Playwright-specific `e2e-runner` contract.
