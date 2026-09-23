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

        merge_commit_sha="$(gh pr list --head "$base_branch" --base "$release_branch" --state merged --limit 1 --json mergeCommit --jq '.[0].mergeCommit.oid // empty')"
        if [ -z "$merge_commit_sha" ]; then
            echo "release-runner: release PR for $base_branch is not merged" >&2
            exit 1
        fi

        git checkout "$release_branch"
        git pull --ff-only
        current_sha="$(git rev-parse HEAD)"
        if [ "$current_sha" != "$merge_commit_sha" ]; then
            echo "release-runner: merged release PR commit $merge_commit_sha is not current $release_branch HEAD $current_sha; refusing to tag" >&2
            exit 1
        fi
        merge_line="$(git rev-list --parents -n1 "$current_sha")"
        parent_count="$(printf '%s\n' "$merge_line" | awk '{print NF - 1}')"
        if [ "$parent_count" -ne 2 ]; then
            echo "release-runner: release PR must use Create a merge commit; refusing to tag a squash/rebase commit (HEAD has ${parent_count} parent(s))" >&2
            exit 1
        fi
        # Run the combined SOURCE+PACKAGE gate before creating an immutable
        # tag when this project supplies one. dhpk uses the conventional path;
        # other projects can provide a compatible Node gate through
        # DHPK_RELEASE_PUBLISH_GATE_SCRIPT. Projects without a combined gate
        # retain the PACKAGE-only fallback for compatibility.
        publish_gate_script="${DHPK_RELEASE_PUBLISH_GATE_SCRIPT:-}"
        if [ -z "$publish_gate_script" ] && [ -f "scripts/release/publish-gate.js" ]; then
            publish_gate_script="scripts/release/publish-gate.js"
        fi
        if [ -n "$publish_gate_script" ]; then
            if [ ! -f "$publish_gate_script" ]; then
                echo "release-runner: configured SOURCE+PACKAGE gate is missing: $publish_gate_script" >&2
                exit 1
            fi
            if ! node "$publish_gate_script" --version "$version"; then
                echo "release-runner: pre-tag SOURCE+PACKAGE gate failed; refusing to create immutable tag" >&2
                exit 1
            fi
        else
            package_gate_script="${DHPK_RELEASE_PACKAGE_GATE_SCRIPT:-}"
            if [ -z "$package_gate_script" ] && [ -f "scripts/release/package-gate.js" ]; then
                package_gate_script="scripts/release/package-gate.js"
            fi
            if [ -n "$package_gate_script" ]; then
                if [ ! -f "$package_gate_script" ]; then
                    echo "release-runner: configured PACKAGE gate is missing: $package_gate_script" >&2
                    exit 1
                fi
                if ! node "$package_gate_script" --version "$version"; then
                    echo "release-runner: post-merge PACKAGE gate failed; refusing to create immutable tag" >&2
                    exit 1
                fi
            fi
        fi
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
            echo "release-runner: ${base_branch} has unique tree content after release; sync-develop is blocked" >&2
            exit 1
        fi
        # Idle-align may rewrite develop onto main after a squash. Restore the
        # local worktree directly from the fetched remote ref without a
        # fast-forward pull.
        git checkout -B "$base_branch" "origin/${base_branch}"
        ;;
    *)
        echo "release-runner: phase must be prepare or publish" >&2
        exit 2
        ;;
esac
