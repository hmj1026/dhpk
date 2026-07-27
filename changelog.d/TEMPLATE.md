<!--
Release-note fragment template. Ignored by validation — copy this file, do
not edit it in place.

For a user-visible feature, fix, deprecation, or breaking change, add:

  changelog.d/<category>.<slug>.md

  category: one of feat, fix, refactor, docs, test, chore, perf, ci, BREAKING
  slug:     kebab-case, unique across all pending fragments

  Content is exactly two lines:

    scope: <short-scope-token>
    note: <one sentence, matches the existing CHANGELOG.md bullet style>

For an internal-only change (tests, refactors with no user-visible effect,
internal tooling), add an empty marker instead of a fragment:

  changelog.d/<slug>.none

Both fragments and .none markers are consumed (deleted) when a release
promotes them into CHANGELOG.md — see scripts/lib/changelog-fragments.js
and scripts/ci/validate-changelog-fragments.js.
-->
scope: example-scope
note: One sentence describing the user-visible change.
