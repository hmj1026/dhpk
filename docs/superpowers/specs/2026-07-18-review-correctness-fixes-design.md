# Review Correctness Fixes Design

## Goal

Resolve all six review findings without weakening existing release, execution-policy,
goal-budget, verification, or skill-size contracts. Completion requires the scoped
regression tests, the full test suite, and every repository validation gate to pass.

## Constraints

- Preserve unrelated staged and unstaged work.
- Use test-first RED/GREEN cycles for behavioral changes.
- Do not perform a real release or make network requests in tests.
- Keep `rules/execution-policy.md` as the canonical SSOT while retaining progressive
  disclosure through its reference documents.
- Keep the normal generated goal at or below 3,400 UTF-8 bytes and every generated
  goal below the 4,000-byte hard cap.

## Design

### Two-phase release runner

Replace the ambiguous single-pass runner with explicit `prepare` and `publish`
phases while retaining the five release configuration values.

- `prepare` checks out the base branch, synchronizes it, commits and pushes the
  prepared release changes, creates the release PR, and exits without checking out
  the release branch, tagging, or inspecting workflow runs.
- `publish` first queries the PR associated with the base branch and refuses to
  proceed unless GitHub reports it merged. It then synchronizes the release branch,
  creates and pushes the tag, and polls for a workflow run filtered to that exact
  tag. It watches only the matching run and fails after a bounded number of attempts
  if GitHub never exposes one. Finally, it returns to and synchronizes the base
  branch.
- Poll attempt and interval defaults remain production-safe but are overridable by
  environment variables so tests do not sleep.
- `skills/release-creator/SKILL.md` documents the two commands and the human merge
  boundary explicitly.

### Execution-policy contract restoration

Restore compact canonical clauses in `rules/execution-policy.md` for:

- Repository Discovery Gate triggers and human-approved exceptions.
- Dispatch fallback and whole-implement-step routing language.
- CODEX high-stakes and doubt-cycle triggers.
- Contiguous implementation waves, one consolidated parallel reviewer batch,
  confirm-only re-review, and new-scope review decisions.
- One corrected retry followed by replacement or a pending gate.
- Specialist fix-spec handback routing.

Reference documents continue to hold operational detail; the SSOT retains enough
normative wording for consumers and static contract tests.

### Goal-template budget

Compact repeated dispatch prose in `goal-templates.md` and point operational detail
to execution policy. Preserve all safety tokens and inline directives asserted by
the goal guardrail tests. Measure the production fixture in UTF-8 bytes after each
change until the normal case is at most 3,400 bytes.

### API transport failures

Treat a non-zero `curl` result as script failure. Preserve the transport exit status,
write a concise diagnostic to stderr, and emit no completed evidence record. Normal
GET and POST evidence formatting remains unchanged.

### Logical skill line counting

Count logical lines as the number of newline characters plus one only when non-empty
content does not end in a newline. This preserves existing counts for terminated
files and correctly rejects an unterminated 251st line, including grandfathered
baseline comparisons.

## Test Strategy

1. Add release-runner regressions proving prepare never tags, publish rejects an
   unmerged PR, polling is tag-filtered, the matching run is watched, and polling
   exhaustion fails.
2. Add an API regression with a stubbed `curl` transport failure and assert non-zero
   status plus absence of evidence output.
3. Add unterminated 251-line and grandfathered-baseline fixtures to the skill-size
   validator tests.
4. Run each new test before implementation and confirm it fails for the intended
   missing behavior.
5. Implement the smallest passing changes, then run the five originally failing
   contract files and the goal budget test.
6. Run `node scripts/ci/validate-plugin.js`,
   `node scripts/ci/catalog.js --check all`, `node tests/run-all.js`, and
   `bash scripts/validate/validate-harness.sh` until all pass.
7. Run GitNexus change detection and confirm only expected files, symbols, and flows
   are affected.

## Failure Handling

- A publish attempt with an unmerged or unresolvable PR exits before tag creation.
- A tag workflow that cannot be found within the poll bound is a release failure,
  never a silent success.
- Existing test failures outside the intended scope are checked against the current
  dirty baseline before attribution; no unrelated user changes are reverted.
- HIGH-risk SSOT or release-path changes remain constrained by contract tests and
  stubbed command-sequence assertions.
