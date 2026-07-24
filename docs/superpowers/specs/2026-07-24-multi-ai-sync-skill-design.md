# Multi-AI Sync Skill Contract Refactor

> **Status: Superseded.** This pre-implementation design was replaced by
> [the cross-platform canonical and Codex metadata design](2026-07-24-cross-platform-skills-canonical-and-codex-metadata-design.md).
> Its separate-physical-directory and Codex-only-extension assumptions are
> historical, not current repository policy.

Date: 2026-07-24
Status: Superseded by the cross-platform canonical and Codex metadata design

## Problem

`multi-ai-sync` has one Claude-side skill and one intentionally physical Codex
mirror. The two entry documents no longer describe the same workflow: the
canonical copy contains extra smoke and Gemini-agent translation steps, while
the Codex copy contains the Codex-only agent-sync extension. The current
instructions also require target directories that may not exist, mention a
`--force` option that the CLI does not expose, and describe a Gemini agent
translation path that the mapping policy marks as unsupported.

The skill body is also above the repository's preferred context budget and
duplicates details that already belong in reference files. These problems make
the skill less predictable at routing time and make future canonical/Codex
updates prone to drift.

## Goals

- Make the skill's trigger description concise, specific, and complete for
  cross-platform Claude-first synchronization requests.
- Define one reviewable workflow contract shared by the Claude and Codex
  entry documents while preserving the Codex-only agent-sync extension.
- Make plan-only, approved apply, and validation outcomes explicit and
  checkable.
- Remove instructions for unsupported or non-existent CLI behavior.
- Keep the main skill body below 250 lines, preferably near 150 lines, and
  route detailed mapping, risk, and output semantics through references.
- Add focused contract coverage so stale instructions cannot silently return.

## Non-goals

- Do not consolidate the canonical and Codex Python implementations.
- Do not remove Codex's `agent_sync.py`, manifest generation, or self-test
  coverage.
- Do not add a new `--force` CLI option merely to preserve stale prose.
- Do not implement Gemini agent parity; the current mapping policy remains the
  source of truth for unsupported categories.
- Do not delete the historical `EVALUATION_IMPROVEMENTS.md` artifact in this
  change.
- Do not change platform capability policy, sync mutation semantics, OpenSpec
  task format, or the plugin installation mechanism.

## Design

### 1. Shared skill contract

Rewrite both `SKILL.md` files around the same compact contract:

1. Resolve the current harness's sync CLI entrypoint.
2. Check that `.claude` and `CLAUDE.md` are readable.
3. Run the tool self-test before planning; a failure halts the workflow.
4. Generate a read-only plan containing coverage, mapping decisions, skip
   reasons, and evidence.
5. If the request is plan-only, stop after the plan and report that no files
   were mutated.
6. Require approval before generating tasks or applying changes.
7. Generate OpenSpec tasks from `adapted` mappings only.
8. Run and inspect the dry-run before applying the approved plan.
9. Apply changes, produce the target/category report, and preserve manual
   review items as a reviewer-ready draft.
10. Run the validation gate and report `PASS`, `PARTIAL`, or `FAIL` with
    failed and skipped evidence.

Each step will state its completion condition. The skill will not mention the
unsupported `--force` path or the obsolete `.gemini/agents` translation phase.
The exact mapping and risk semantics remain in the existing references and are
linked only when the relevant decision is reached.

### 2. Harness-specific entrypoints

The workflow will define the executable as a resolved `SYNC_CLI` value rather
than hard-coding `.codex` for every harness:

- Claude/plugin execution resolves the bundled `skills/multi-ai-sync` script
  from the plugin root.
- Codex project execution resolves `.codex/skills/multi-ai-sync`.

The command examples will use that resolved entrypoint consistently and will
retain `--root` where a consumer repository differs from the current working
directory. This keeps the body framework-agnostic without pretending that the
two harnesses materialize the skill at the same path.

### 3. Mode-aware preflight

Preflight will distinguish inspection from mutation:

- Source absence or malformed `.claude` structure blocks every mode.
- In plan-only mode, absent target roots are recorded as planned creation
  paths and do not block a read-only plan.
- Apply mode requires each selected target to be writable or to have a valid
  documented fallback. Existing read-only `.codex/skills` remains a fallback
  case, not an unexplained failure.
- A missing target root is not treated as a malformed target structure until
  the selected operation needs to write it.

The output contract will report each preflight item as `PASS`, `WARN`, or
`BLOCKED`, with the operation that caused the status.

### 4. Canonical/Codex boundary

The two physical directories will remain separate because Codex contains
additional agent-sync resources. Their shared sections will be kept
semantically identical. The Codex document will add only a short extension
covering `--root`, the extra agent bundle/manifest behavior, and the Codex
runtime path. It will not carry a second divergent copy of the general
workflow.

The existing references will remain the detailed source for platform mapping,
capability evidence, risk policy, and conflict arbitration. A small workflow
contract reference may be added only if moving details out of `SKILL.md` keeps
the navigation direct and avoids duplicating requirements.

### 5. Verification contract

Add a focused test for the skill package that checks both entry documents for:

- required routing sections and completion/output/verification headings;
- absence of `--force` and `.gemini/agents` instructions;
- the shared phase order and validation states;
- preservation of the Codex-only agent-sync extension;
- referenced script and reference paths remaining resolvable.

The test will supplement, not replace, the existing canonical/Codex Python
self-test parity suite.

## Error handling

- Self-test failure: stop before plan generation and report failing cases.
- Source or target structure that cannot be safely classified: stop and report
  the exact path, attempted check, and next action.
- Mapping conflict without an authoritative resolution: mark `needs-review`
  and do not auto-apply the item.
- Dry-run or apply failure: preserve the report, do not claim completion, and
  identify whether the failure occurred before or after mutation.
- Validation `PARTIAL`: report skipped/incompatible items separately from
  failures and require explicit approval before calling the run complete.

## Verification

After implementation:

1. Run `quick_validate.py` for the canonical skill and the Codex mirror.
2. Run the focused multi-AI skill contract test and the existing
   `tests/multi-ai-sync-parity.test.js`.
3. Run `skill-health-check` and confirm no new P0/P1 findings; the line-count
   finding for this skill should be resolved.
4. Run plugin, catalog, reference, strict skill/agent, harness, and
   `git diff --check` validation.
5. Run the full test suite and distinguish repository baseline or sandbox
   child-process failures from regressions introduced by this change.
6. Review the final diff to confirm that the physical Codex-only resources and
   unrelated TDD changes remain untouched.

## Success criteria

- A plan-only request can produce a read-only plan when target roots are
  absent, while apply still fails safely when no writable route exists.
- No documented command refers to an unsupported CLI flag or unsupported
  Gemini agent output.
- Claude and Codex users receive the same phase order, approval gate, output
  contract, and final status semantics.
- Codex agent-sync behavior remains available and explicitly documented.
- The skill body is concise, directly routed, and passes the repository's
  skill and plugin validation gates.
