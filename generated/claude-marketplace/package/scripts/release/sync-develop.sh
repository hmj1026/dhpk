#!/usr/bin/env bash
# sync-develop.sh
#
# Post-release develop reconciliation owned by the tag workflow's
# sync-develop job. The workflow supplies the merged release PR head SHA;
# develop must still point at that exact SHA before an idle tree alignment is
# allowed. Identical origin/main and origin/develop trees (including after a
# squash-merge release PR) then align develop onto main with --force-with-lease
# pinned to that unchanged SHA. Any movement or tree difference is blocking
# and requires an explicit recovery PR. This script never uses bare --force,
# push -f, or reset --hard.
#
# Usage: bash scripts/release/sync-develop.sh
# Env: DHPK_SYNC_REMOTE (default origin)
#      DHPK_RELEASE_EXPECTED_DEVELOP_SHA (required release PR head SHA)
set -euo pipefail

remote="${DHPK_SYNC_REMOTE:-origin}"
expected_develop_sha="${DHPK_RELEASE_EXPECTED_DEVELOP_SHA:-}"

if [ -z "$expected_develop_sha" ]; then
    echo "sync-develop: expected release PR head SHA is required; refusing to rewrite develop" >&2
    exit 1
fi
if ! [[ "$expected_develop_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    echo "sync-develop: expected release PR head SHA is invalid; refusing to rewrite develop" >&2
    exit 1
fi

git fetch "$remote" main develop
main_sha="$(git rev-parse "${remote}/main")"
develop_sha="$(git rev-parse "${remote}/develop")"

if [ "$develop_sha" != "$expected_develop_sha" ]; then
    echo "sync-develop: develop advanced or moved after release PR head (expected ${expected_develop_sha}, found ${develop_sha}; main=${main_sha}); preserving both branches" >&2
    echo "Recovery: create a recovery branch, resolve and test the tree difference, then open a PR to develop" >&2
    echo "Do not force-push develop or reset either branch." >&2
    exit 1
fi

if git diff --quiet "$main_sha" "$develop_sha"; then
    echo "sync-develop: release succeeded; develop unchanged and trees match; aligning develop to ${main_sha} (was ${develop_sha})"
    if ! git push --force-with-lease="refs/heads/develop:${develop_sha}" \
        "$remote" "${main_sha}:refs/heads/develop"; then
        echo "sync-develop: force-with-lease rejected; preserving refs (main=${main_sha}, develop=${develop_sha})" >&2
        echo "Recovery: re-fetch main and develop, inspect the refs, then create a recovery branch and PR to develop" >&2
        echo "Do not retry with bare --force or reset either branch." >&2
        exit 1
    fi
    git fetch "$remote" develop
    aligned_sha="$(git rev-parse "${remote}/develop")"
    if [ "$aligned_sha" != "$main_sha" ]; then
        echo "sync-develop: develop ref did not align to ${main_sha} after force-with-lease (main=${main_sha}, develop=${aligned_sha})" >&2
        echo "Recovery: re-fetch main and develop, inspect the refs, then create a recovery branch and PR to develop" >&2
        echo "Do not retry with bare --force or reset either branch." >&2
        exit 1
    fi
    echo "sync-develop: idle-align PASS"
    exit 0
fi

echo "sync-develop: develop unchanged but tree differs from released main; preserving refs (main=${main_sha}, develop=${develop_sha})" >&2
echo "Recovery: create a recovery branch, resolve and test the tree difference, then open a PR to develop" >&2
echo "Do not force-push develop or reset either branch." >&2
exit 1
