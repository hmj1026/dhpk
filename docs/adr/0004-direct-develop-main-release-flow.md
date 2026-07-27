# Direct develop-to-main release flow

Status: accepted

dhpk cuts releases with a direct `develop` → `main` pull request and creates
the annotated immutable `vX.Y.Z` tag only after that pull request is merged.
The repository does not use a temporary `release/*` branch for normal releases.
This keeps the existing two-branch topology and the human merge gate while
avoiding the drift and tag-prefix correction that the previous git-flow release
branch procedure introduced. The tag workflow creates the GitHub Release from
the non-empty changelog section, preserves an existing Release on rerun, and
back-merges `main` into `develop`; publication is complete only after that
back-merge succeeds.
