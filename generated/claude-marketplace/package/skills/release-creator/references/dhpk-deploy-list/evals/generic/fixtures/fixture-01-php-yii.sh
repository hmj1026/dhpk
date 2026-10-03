#!/usr/bin/env bash
# fixture-01-php-yii.sh — Synthetic Yii 1.x project, php-yii preset, en lang
#
# Asserts the `php-yii` preset categorizes protected/{controllers,models,views}
# correctly and filters protected/tests/, docs/, .claude/, composer artifacts.
#
# Output to stdout; check-golden.sh diffs against expected-fixture-01-php-yii.txt
set -uo pipefail

SKILL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
SCRIPT="$SKILL_DIR/scripts/deploy-list.sh"

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t deploy-list-fixture.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
git init -q
git symbolic-ref HEAD refs/heads/master
git config user.email ci@local
git config user.name ci
git config commit.gpgsign false 2>/dev/null || true

mkdir -p protected/{controllers,models,views/hello,tests} js docs .claude
touch protected/yii.php  # auto-detect marker (we still pass --preset explicitly)
touch protected/controllers/HelloController.php
touch protected/models/HelloModel.php
touch protected/views/hello/index.php
touch protected/tests/HelloTest.php
touch js/app.js
touch docs/readme.md
touch .claude/CLAUDE.md
touch composer.json
git add -A
git commit -q -m "initial layout"

git checkout -q -b develop
# Touch every file again to register as modified in diff
for f in protected/controllers/HelloController.php protected/models/HelloModel.php \
         protected/views/hello/index.php protected/tests/HelloTest.php \
         js/app.js docs/readme.md .claude/CLAUDE.md composer.json; do
    echo "x" >> "$f"
done
git add -A
git commit -q -m "feat: changes across layers"
DEPLOY=$(git rev-parse HEAD)

bash "$SCRIPT" \
    --date 2026/01/01 --author tester --project synthetic-php-yii \
    --tag '[GEN]' --description 'php-yii preset fixture' \
    --base master --head develop --deploy-commits "$DEPLOY" \
    --preset php-yii --lang en 2>/dev/null
