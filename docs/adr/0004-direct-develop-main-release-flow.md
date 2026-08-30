# Direct develop-to-main release flow

Status: accepted

dhpk cuts releases with a direct `develop` → `main` pull request and creates
the annotated immutable `vX.Y.Z` tag only after that pull request is merged.
The repository does not use a temporary `release/*` branch for normal releases.
This keeps the existing two-branch topology and the human merge gate while
avoiding the drift and tag-prefix correction that the previous git-flow release
branch procedure introduced. The tag workflow creates the GitHub Release from
the non-empty changelog section, preserves an existing Release on rerun, and
reconciles `develop` with released `main`. Every release PR must use a merge
commit so generated package provenance remains anchored in the release candidate.
Before tagging, the publisher checks that the GitHub merge SHA is the fetched
`main` HEAD and has two parents. Post-release reconciliation first verifies that
`develop` is still exactly the release PR head, then compares trees. Only an
unchanged develop with an identical tree is aligned onto `main` with
`--force-with-lease` pinned to that expected SHA. A moved develop or differing
tree is blocking and requires an explicit recovery PR; publication is complete
only after the guarded reconciliation succeeds.
