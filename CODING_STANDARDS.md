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

## OpenSpec archive

- Treat archive as a source change. After it updates main specs, run strict
  specification and archived-change validation, then the affected contract
  tests using the same parallelism as CI before opening or updating a PR.
- A `MODIFIED` delta replaces the full requirement. Its heading and every
  retained scenario must match the main spec; reviewers must reject a delta
  that silently drops an existing scenario.
