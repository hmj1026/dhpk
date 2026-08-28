#!/usr/bin/env bash
# sync-develop.sh
#
# Post-release develop reconciliation owned by the tag workflow's
# sync-develop job. Identical origin/main and origin/develop trees (including
# after a squash-merge release PR) align develop onto main with
# --force-with-lease pinned to the fetched develop SHA. Unique tree content
# keeps a conflict-loud --no-ff merge. This script never bare --force, never
# push -f, and never reset --hard.
#
# Usage: bash scripts/release/sync-develop.sh
# Env: GITHUB_REF_NAME (tag name for the merge message; default main)
#      DHPK_SYNC_REMOTE (default origin)
set -euo pipefail

remote="${DHPK_SYNC_REMOTE:-origin}"
tag_name="${GITHUB_REF_NAME:-main}"

git fetch "$remote" main develop
main_sha="$(git rev-parse "${remote}/main")"
develop_sha="$(git rev-parse "${remote}/develop")"

if git diff --quiet "$main_sha" "$develop_sha"; then
    echo "sync-develop: idle trees match; aligning develop to ${main_sha} (was ${develop_sha})"
    git push --force-with-lease="refs/heads/develop:${develop_sha}" \
        "$remote" "${main_sha}:refs/heads/develop"
    echo "sync-develop: idle-align PASS"
    exit 0
fi

echo "sync-develop: unique tree content; --no-ff back-merge ${tag_name}"
git checkout -B develop "$develop_sha"
if ! git merge --no-ff "$main_sha" \
    -m "chore(release): back-merge ${tag_name} into develop"; then
    echo "sync-develop: merge conflict. Preserve both branches."
    echo "Recovery: git checkout -b recovery/back-merge-${tag_name} develop"
    echo "          git merge --no-ff main"
    echo "          resolve, test, and PR the result to develop"
    echo "Do not force-push develop or reset either branch."
    exit 1
fi
git push "$remote" HEAD:develop
echo "sync-develop: back-merge PASS"
