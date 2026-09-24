scope: release
note: Release PRs now rehearse the tag-only verification (shared `release-verify.sh` dry-run plus the consumer gate) before merge, CI and the tag job share one test environment, and `release-runner.sh prepare` derives its file scope from `prepare-release.js paths`.
