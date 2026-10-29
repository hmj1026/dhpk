#!/usr/bin/env bash
# fixture-04-python.sh — Synthetic Python project, python preset, en lang
#
# Asserts the `python` preset categorizes src/<pkg>/core, src/<pkg>/models,
# src/<pkg>/, migrations/, templates/, static/, and filters tests/, __pycache__/,
# build artifacts, packaging metadata.
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

mkdir -p src/myapp/{core,models} migrations templates static tests __pycache__ build
touch pyproject.toml  # auto-detect marker
touch src/myapp/core/engine.py
touch src/myapp/models/user.py
touch src/myapp/api.py
touch migrations/001_init.py
touch templates/index.html
touch static/main.css
touch tests/test_api.py
touch __pycache__/foo.cpython-311.pyc
touch build/lib.x86_64/foo.py
touch requirements.txt
git add -A
git commit -q -m "initial layout"

git checkout -q -b develop
for f in src/myapp/core/engine.py src/myapp/models/user.py src/myapp/api.py \
         migrations/001_init.py templates/index.html static/main.css \
         tests/test_api.py __pycache__/foo.cpython-311.pyc \
         build/lib.x86_64/foo.py requirements.txt pyproject.toml; do
    echo "x" >> "$f"
done
git add -A
git commit -q -m "feat: cross-module edits"
DEPLOY=$(git rev-parse HEAD)

bash "$SCRIPT" \
    --date 2026/01/01 --author tester --project synthetic-python \
    --tag '[GEN]' --description 'python preset fixture' \
    --base master --head develop --deploy-commits "$DEPLOY" \
    --preset python --lang en 2>/dev/null
