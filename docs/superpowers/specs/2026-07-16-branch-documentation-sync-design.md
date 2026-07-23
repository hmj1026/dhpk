# Branch Documentation Sync Design

## Purpose

Synchronize the current, maintained documentation with the behavior implemented
on `feature/tune-goal-dispatch-review-waves`. Runtime code, executable tests,
plugin manifests, and current configuration are the source of truth.

## Scope

Update maintained user and maintainer documentation where the branch changes
its public workflow or operating contract:

- English and Traditional Chinese README and operational guides.
- Configuration references and examples.
- Command, skill, agent, hook, and execution-policy documentation.
- Current contracts, code maps, and non-archived OpenSpec artifacts when they
  describe the affected behavior.

Do not rewrite historical changelogs, archived specifications, or test fixtures
unless a maintained document links to them as current guidance.

## Synchronization Rules

1. Describe `--worker=claude|codex|agy|auto`, its invocation precedence,
   selector order/fallback, availability handling, and independence from the
   separate `CODEX` review switch.
2. Document deterministic goal generation: the bounded task digest,
   conditional E2E roster, actionable selected clauses, and non-actionable
   blocked clauses.
3. Document one consolidated reviewer batch per wave, bounded confirm-only
   re-review, and post-review fix handback to the fast-worker tier.
4. Document post-edit advisory deduplication and debug-only skip output.
5. Document TDD/E2E ownership boundaries and symlink-safe Write guidance.
6. Preserve existing terminology and avoid copying internal implementation
   details into user-facing guides unless users must act on them.

## Discovery and Editing Strategy

Build an implementation-to-documentation matrix from the branch diff and
focused symbol/reference searches. For every behavior above, identify the
canonical maintained document, then update translated or secondary documents
to agree with it. Remove or rewrite stale statements rather than layering a
contradictory note beside them.

## Verification

- Search for obsolete literals and contradictory contracts.
- Run Markdown/reference integrity checks.
- Run plugin and catalog validation.
- Validate the active OpenSpec change.
- Run the full test suite outside the restricted sandbox when child-process
  tests require it.
- Review the final documentation-only diff for scope and translation parity.

## Success Criteria

- Every maintained document agrees with the current branch behavior.
- English and Traditional Chinese user-facing guidance cover the same features.
- No current link or example teaches the pre-branch behavior.
- All repository validation gates pass, with any baseline-only warnings called
  out explicitly.
