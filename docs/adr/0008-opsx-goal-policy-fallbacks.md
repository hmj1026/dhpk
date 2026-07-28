# Harden `/goal` policy fallbacks and coupled-document review evidence

Status: accepted

dhpk's generated `/goal` orientation resolves execution policy through a fixed candidate chain: readable explicit plugin root, newest readable installed cache, then a source-checkout pair identified by `./.claude-plugin/plugin.json` and `./rules/execution-policy.md`; failed candidates do not trigger filesystem scanning, and the final state remains `POLICY-UNRESOLVED` with inline gates. In that unresolved state, both dispatch modes still require a fresh canonical reviewer artifact, including confirm-only reviews. Documentation review also checks same-batch normatively coupled OpenSpec `spec.md` and `design.md` files for the same finding pattern, recording both paths and evidence without expanding scope or changing sentinel lifecycle.

## Considered Options

- A parent-directory or filesystem search was rejected because it could load an unrelated
  policy and make a generated goal non-deterministic.
- Treating an explicit but unreadable plugin root as terminal was rejected because it hides a
  usable installed cache or source checkout.
- Omitting artifact requirements from `POLICY-UNRESOLVED` was rejected because the unresolved
  branch is exactly where the canonical review evidence could otherwise disappear.
- Requiring every reviewer specialist to duplicate coupled-document rules was rejected because
  it would drift from the shared reviewer contract and repeat policy text.
- Repository-wide semantic duplicate search was rejected because same-batch governing
  documents provide the bounded relationship needed for this review.

## Consequences

Self-hosted dhpk sessions can load their repository policy without weakening consumer behavior
or introducing path discovery. Fallback-generated goals remain auditable when the full policy
cannot be read. Documentation findings can identify an implementation/specification mismatch
in one review artifact, while code-quality ownership, sentinel clearance, verdict handling,
and consolidated reviewer waves remain unchanged.
