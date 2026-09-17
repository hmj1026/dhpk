# Three-proof release model and rejected automation

Status: accepted

## Context

The release flow deliberately proves the release commit more than once. The
proofs happen at different authority boundaries: before merge, before an
immutable tag exists, and on the tag that produces publication provenance.
The repeated work is therefore not accidental duplication, but the release
flow is easy to misread as unnecessarily slow when that distinction is not
recorded.

## Decision

Every release commit is proven three times, by three distinct authorities:

1. **Pull-request CI** proves the proposed commit before the release PR is
   merged.
2. **The local pre-tag gate** proves the merged release commit after merge and
   before the immutable tag exists.
3. **The tag-triggered Release job** proves the immutable tag and produces
   publication provenance.

The `develop` push run and the `main` push run are the two former proofs removed
from the final model. The parent plan summarized the reason as “the same SHA
and the same workflow definition” as the pull-request run. The precise
invariant is the same release result under the same workflow definition: the
`develop` push reused the pull request's head/source SHA, while the `main` push
used the resulting merge commit; a pull-request event may instead use a
synthetic merge SHA. Those event-specific SHA values can differ, but the runs
checked the same release-result tree, so they added no new source revision or
information. The removal is staged: the repository's `main` ruleset must first
be verified to require the pull-request check, then the follow-up CI trigger
change removes the `push:` trigger.

The local pre-tag gate remains a separate proof because it is the last abort
point before an immutable tag exists and is performed by a different authority
from pull-request CI.

The human merge boundary remains mandatory. The release flow does not
auto-merge pull requests, auto-tag pushes to `main`, or replace the local gate
with a check that CI already produced evidence for the SHA.

## Consequences

- Release readiness has one named, durable proof sequence rather than an
  unexplained count of repeated checks.
- Removing the duplicate push runs will reduce waiting without removing the
  pre-merge, pre-tag, or tag-time authority boundary.
- A green check remains evidence that its governed scope is not broken; it is
  not by itself authorization to merge or publish.

## Alternatives considered

### Auto-merge pull requests on green

Rejected. Green proves “not broken”, not “correct”. A passing CI result does
not replace human judgment at the merge boundary.

### Auto-tag pushes to `main`

Rejected. It removes the last point at which a release can be aborted and
converts a human judgment about when a tag should exist into a derivation rule
that requires ongoing maintenance. Tags are immutable, and a rerun replays
the workflow definition stored at the tag. Two tags currently exist without a
corresponding release, which demonstrates why a failed tag cannot simply be
repaired by later workflow changes. This rejects unattended tagging from a
`main` push; the human-invoked publish runner may still create the tag after its
pre-tag gate succeeds.

### Replace the local gate with CI-evidence lookup

Rejected. The alternative saves two to three minutes, but introduces an
evidence-verification mechanism and therefore more contract surface to go
wrong. The local gate remains the simpler and more trustworthy proof before
the irreversible tag operation.

## Related decisions

- [ADR-0004 — Direct develop-to-main release flow](0004-direct-develop-main-release-flow.md)
