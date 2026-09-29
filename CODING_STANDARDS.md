# Coding Standards

This file is for reviewers. Apply only the checks relevant to the changed
surface; commands and generated-file inventories remain the source of truth.

## Generated distribution and provenance

- A change to canonical projection input, generator code, or a package-owned
  runtime asset requires regeneration and deterministic verification of every
  affected distribution surface.
- Review the checked-in provenance as data: its source commit and tree must
  describe the clean source revision used for generation, never uncommitted
  work or a later target checkout.
- Runtime-support overlays may share an explicitly inventory-declared physical
  source. A reviewer must reject undeclared overlap, but must not classify an
  attested overlay as a package collision.

## Consumer evidence

- A consumer adapter must receive the inventory or other authoritative context
  needed to interpret a generated package. Missing context must fail closed;
  it must not turn declared runtime support into a structural failure.
- Structural package validation and consumer-runtime evidence remain separate:
  an unavailable runtime is not static PASS, and a valid package must retain
  its structural evidence.

## Commits

- A commit message describes only the change. It carries no author, tool,
  agent, or model identity: no `Co-authored-by`, `Signed-off-by`, or
  generated-by trailer, and no attribution line in the body.
- Before pushing, inspect branch messages with
  `git log --format=%B origin/develop..HEAD` for author, tool, agent, or model
  attribution anywhere in the body. Check named trailers with
  `git log --format=%B origin/develop..HEAD | grep -iE '^(co-authored-by|signed-off-by|generated-by):'`;
  reword any matching commit.

## Tests

- Apply the rejection checklist in
  [skills/tdd-workflow/tests.md](skills/tdd-workflow/tests.md) to every added
  or rewritten assertion; a passing tautological test is not coverage.
- Add a test to the existing suite that owns its contract. A new
  `tests/*.test.js` file needs a reason the owner cannot hold it, such as an
  isolated environment or a runtime that would unbalance a shard.
- Share expensive setup through `tests/_lib/` rather than copying it, and keep
  each file within the default 180s budget of `tests/run-all.js` without a new
  `TIMEOUT_HINTS` entry.
- Delete a test only when another test collected by `tests/run-all.js` fully
  owns its contract, and the PR records before-and-after line and branch
  coverage showing no decrease for each affected production file.

## OpenSpec archive

- Treat archive as a source change. After it updates main specs, run strict
  specification and archived-change validation, then the affected contract
  tests using the same parallelism as CI before opening or updating a PR.
- A `MODIFIED` delta replaces the full requirement. Its heading and every
  retained scenario must match the main spec; reviewers must reject a delta
  that silently drops an existing scenario.
