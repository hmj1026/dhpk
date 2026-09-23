#!/usr/bin/env bash
# fixture-02-laravel.sh — Synthetic Laravel project, laravel preset, en lang
#
# Asserts the `laravel` preset categorizes app/Domain, app/Http, app/Models,
# database/migrations, resources/views, routes/, config/, and filters tests/,
# storage/, bootstrap/cache/.
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

mkdir -p app/{Domain,Http/Controllers,Models} \
         database/migrations resources/views \
         routes config tests/Feature storage/logs bootstrap/cache \
         .github/workflows
touch artisan  # auto-detect marker
touch app/Domain/Order.php
touch app/Http/Controllers/HomeController.php
touch app/Models/User.php
touch database/migrations/2024_01_01_create_users.php
touch resources/views/home.blade.php
touch routes/web.php
touch config/app.php
touch tests/Feature/HomeTest.php
touch storage/logs/laravel.log
touch bootstrap/cache/services.php
touch composer.json
touch .github/workflows/ci.yml
git add -A
git commit -q -m "initial layout"

git checkout -q -b develop
for f in app/Domain/Order.php app/Http/Controllers/HomeController.php \
         app/Models/User.php database/migrations/2024_01_01_create_users.php \
         resources/views/home.blade.php routes/web.php config/app.php \
         tests/Feature/HomeTest.php storage/logs/laravel.log \
         bootstrap/cache/services.php composer.json .github/workflows/ci.yml; do
    echo "x" >> "$f"
done
git add -A
git commit -q -m "feat: cross-layer changes"
DEPLOY=$(git rev-parse HEAD)

bash "$SCRIPT" \
    --date 2026/01/01 --author tester --project synthetic-laravel \
    --tag '[GEN]' --description 'laravel preset fixture' \
    --base master --head develop --deploy-commits "$DEPLOY" \
    --preset laravel --lang en 2>/dev/null
