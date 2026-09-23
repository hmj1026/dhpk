#!/usr/bin/env bash
# fixture-03-node.sh — Synthetic Node/TS monorepo, node preset, en lang
#
# Asserts the `node` preset categorizes packages/<pkg>/src, apps/<app>/src,
# src/types, src/core, src/, public/, and filters tests/, dist/, build artifacts.
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

mkdir -p src/{types,core} packages/api/src apps/web/src public tests dist
touch package.json  # auto-detect marker
touch src/types/User.ts
touch src/core/router.ts
touch src/index.ts
touch packages/api/src/index.ts
touch apps/web/src/page.tsx
touch public/favicon.ico
touch tests/api.test.ts
touch dist/bundle.js
touch jest.config.js
touch tsconfig.json
git add -A
git commit -q -m "initial layout"

git checkout -q -b develop
for f in src/types/User.ts src/core/router.ts src/index.ts \
         packages/api/src/index.ts apps/web/src/page.tsx public/favicon.ico \
         tests/api.test.ts dist/bundle.js jest.config.js tsconfig.json \
         package.json; do
    echo "x" >> "$f"
done
git add -A
git commit -q -m "feat: cross-package edits"
DEPLOY=$(git rev-parse HEAD)

bash "$SCRIPT" \
    --date 2026/01/01 --author tester --project synthetic-node \
    --tag '[GEN]' --description 'node preset fixture' \
    --base master --head develop --deploy-commits "$DEPLOY" \
    --preset node --lang en 2>/dev/null
