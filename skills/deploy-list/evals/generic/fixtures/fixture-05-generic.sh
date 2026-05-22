#!/usr/bin/env bash
# fixture-05-generic.sh — Language-agnostic project, generic preset, en lang
#
# Asserts the `generic` preset's minimal categorization (src/, lib/, config/,
# assets/) works without ecosystem-specific assumptions.
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

mkdir -p src lib config assets scripts docs .claude
touch src/main.go
touch lib/helper.go
touch config/app.yaml
touch assets/logo.png
touch scripts/build.sh
touch docs/readme.md
touch .claude/CLAUDE.md
git add -A
git commit -q -m "initial layout"

git checkout -q -b develop
for f in src/main.go lib/helper.go config/app.yaml assets/logo.png \
         scripts/build.sh docs/readme.md .claude/CLAUDE.md; do
    echo "x" >> "$f"
done
git add -A
git commit -q -m "feat: cross-layer changes"
DEPLOY=$(git rev-parse HEAD)

bash "$SCRIPT" \
    --date 2026/01/01 --author tester --project synthetic-generic \
    --tag '[GEN]' --description 'generic preset fixture' \
    --base master --head develop --deploy-commits "$DEPLOY" \
    --preset generic --lang en 2>/dev/null
