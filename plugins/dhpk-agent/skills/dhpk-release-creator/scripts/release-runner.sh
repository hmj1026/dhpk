#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 6 ]; then
    echo "usage: release-runner.sh <prepare|publish> <version> <base-branch> <release-branch> <tag-prefix> <workflow> [release-file ...]" >&2
    exit 2
fi

phase="$1"
version="$2"
base_branch="$3"
release_branch="$4"
tag_prefix="$5"
workflow="$6"
tag="${tag_prefix}${version}"
shift 6
release_files=("$@")

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "release-runner: version must match X.Y.Z" >&2
    exit 2
fi

case "$phase" in
    prepare)
        if [ "${#release_files[@]}" -eq 0 ]; then
            echo "release-runner: prepare requires explicit release files" >&2
            exit 2
        fi

        git checkout "$base_branch"
        git pull --ff-only

        dirty="$(git status --porcelain --untracked-files=all)"
        unexpected_paths=""
        while IFS= read -r status_line; do
            [ -z "$status_line" ] && continue
            path="${status_line:3}"
            case "$path" in
                *" -> "*) path="${path##* -> }" ;;
            esac
            allowed=0
            for release_file in "${release_files[@]}"; do
                if [ "$path" = "$release_file" ]; then
                    allowed=1
                    break
                fi
            done
            if [ "$allowed" -eq 0 ]; then
                unexpected_paths="${unexpected_paths}${path}\n"
            fi
        done <<< "$dirty"
        if [ -n "$unexpected_paths" ]; then
            printf 'release-runner: unexpected worktree changes:\n%b' "$unexpected_paths" >&2
            exit 1
        fi

        for release_file in "${release_files[@]}"; do
            if [ -e "$release_file" ]; then
                git add -- "$release_file"
            elif git diff --cached --quiet -- "$release_file"; then
                git add -u -- "$release_file"
            fi
        done
        for release_file in "${release_files[@]}"; do
            if ! git diff --cached --name-only -- "$release_file" | grep -Fqx -- "$release_file"; then
                echo "release-runner: release file was not staged: $release_file" >&2
                exit 1
            fi
        done
        git commit -m "chore(release): bump version to $version and update changelog"
        git push origin "$base_branch"
        gh pr create --head "$base_branch" --base "$release_branch" --title "Release $tag" --body "Release version $version"
        ;;
    publish)
        if [ "${#release_files[@]}" -ne 0 ]; then
            echo "release-runner: publish does not accept release files" >&2
            exit 2
        fi

        merged_at="$(gh pr list --head "$base_branch" --base "$release_branch" --state merged --limit 1 --json mergedAt --jq '.[0].mergedAt // empty')"
        if [ -z "$merged_at" ]; then
            echo "release-runner: release PR for $base_branch is not merged" >&2
            exit 1
        fi

        git checkout "$release_branch"
        git pull --ff-only
        if [ -n "$(git tag --list "$tag")" ]; then
            echo "release-runner: tag $tag already exists; tags are immutable" >&2
            exit 1
        fi
        git tag -a "$tag" -m "Release $tag"
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
        # --exit-status makes a failed GitHub Actions run fail this release
        # runner instead of allowing a tag to be reported as published.
        gh run watch "$run_id" --exit-status

        git fetch origin "$release_branch" "$base_branch"
        main_sha="$(git rev-parse "origin/${release_branch}")"
        develop_sha="$(git rev-parse "origin/${base_branch}")"
        echo "release-runner: origin/${release_branch}=${main_sha} origin/${base_branch}=${develop_sha}"
        if [ "$main_sha" = "$develop_sha" ]; then
            echo "release-runner: integration branch is aligned to ${release_branch}"
        elif git diff --quiet "origin/${release_branch}" "origin/${base_branch}"; then
            echo "release-runner: trees match but SHAs differ; idle-align did not land" >&2
            exit 1
        else
            echo "release-runner: ${base_branch} has unique tree content after release; --no-ff back-merge kept"
        fi
        # Idle-align rewrites develop onto main after a squash, so local
        # develop is not an ancestor of origin/develop. Update the worktree
        # from the fetched ref without a fast-forward pull.
        git checkout -B "$base_branch" "origin/${base_branch}"
        ;;
    *)
        echo "release-runner: phase must be prepare or publish" >&2
        exit 2
        ;;
esac
