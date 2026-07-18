#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 6 ]; then
    echo "usage: release-runner.sh <prepare|publish> <version> <base-branch> <release-branch> <tag-prefix> <workflow>" >&2
    exit 2
fi

phase="$1"
version="$2"
base_branch="$3"
release_branch="$4"
tag_prefix="$5"
workflow="$6"
tag="${tag_prefix}${version}"

case "$phase" in
    prepare)
        git checkout "$base_branch"
        git pull
        git add -A
        git commit -m "chore(release): bump version to $version and update changelog"
        git push origin "$base_branch"
        gh pr create --head "$base_branch" --base "$release_branch" --title "Release $tag" --body "Release version $version"
        ;;
    publish)
        merged_at="$(gh pr view "$base_branch" --json mergedAt --jq '.mergedAt')"
        if [ -z "$merged_at" ]; then
            echo "release-runner: release PR for $base_branch is not merged" >&2
            exit 1
        fi

        git checkout "$release_branch"
        git pull
        git tag "$tag"
        git push origin "$tag"

        poll_attempts="${DHPK_RELEASE_POLL_ATTEMPTS:-30}"
        poll_interval="${DHPK_RELEASE_POLL_INTERVAL:-5}"
        if ! [[ "$poll_attempts" =~ ^[1-9][0-9]*$ && "$poll_interval" =~ ^[0-9]+$ ]]; then
            echo "release-runner: poll attempts must be positive and interval must be non-negative" >&2
            exit 2
        fi

        run_id=""
        for ((attempt = 1; attempt <= poll_attempts; attempt++)); do
            run_id="$(gh run list --workflow "$workflow" --branch "$tag" --event push --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
            [ -n "$run_id" ] && break
            [ "$attempt" -lt "$poll_attempts" ] && sleep "$poll_interval"
        done
        if [ -z "$run_id" ]; then
            echo "release-runner: workflow run not found for tag $tag" >&2
            exit 1
        fi
        gh run watch "$run_id"

        git checkout "$base_branch"
        git pull
        ;;
    *)
        echo "release-runner: phase must be prepare or publish" >&2
        exit 2
        ;;
esac
