#!/usr/bin/env bash
# fixture-07-anchor-mode.sh — Synthetic project for --anchor mode regression
#
# Asserts:
#   - rg --fixed-strings finds source files containing the anchor string
#   - Built-in excludes (.claude/, protected/tests/coverage/html/, gemini/attachmets/) skip
#     anchor-bearing files that should NOT deploy
#   - Universal preset filter (docs/, README) still filters anchor-bearing docs
#   - Stats body emits "anchor 範圍" line (not "diff 範圍") via ANCHOR_MODE=1
#
# Uses zh-TW lang + php-yii preset.
# Output to stdout; check-golden.sh diffs against expected-fixture-07-anchor-mode.txt
set -uo pipefail

# Skip fixture if rg is not installed — anchor mode is rg-dependent.
if ! command -v rg >/dev/null 2>&1; then
    echo "# fixture-07: ripgrep (rg) not in PATH, skipping anchor mode fixture" >&2
    exit 0
fi

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

# Yii preset auto-detect markers.
mkdir -p protected/config protected/views protected/controllers protected/models
touch protected/yii.php

ANCHOR='2026/02/09 paul [DemoTag]anchor-mode fixture0205'

# Files that SHOULD be in the main group (deployable + anchor present).
printf '<?php\n// %s\nclass A {}\n' "$ANCHOR" > protected/controllers/AController.php
printf '<?php\n// %s\nclass B {}\n' "$ANCHOR" > protected/models/B.php
printf '<?php\n// %s\nclass C {}\n' "$ANCHOR" > protected/components/CComponent.php
mkdir -p protected/components
printf '<?php\n// %s\nclass D {}\n' "$ANCHOR" > protected/components/D.php

# Anchor present but should be EXCLUDED (built-in excludes).
mkdir -p protected/tests/coverage/html .claude/skills
printf '<!-- %s -->\n' "$ANCHOR" > protected/tests/coverage/html/A.php.html
printf '# %s\n' "$ANCHOR" > .claude/skills/note.md

# Anchor present but should be FILTERED by preset (docs).
mkdir -p docs
printf '# %s\n' "$ANCHOR" > docs/release-note.md

# Files without anchor (noise — should NOT appear).
touch protected/models/Other.php
touch protected/controllers/OtherController.php

git add -A
git commit -q -m "anchor mode fixture"

bash "$SCRIPT" \
    --date 2026/02/09 --author paul --project synthetic-anchor \
    --tag '[DemoTag]' --description 'anchor-mode fixture0205' \
    --anchor "$ANCHOR" \
    --preset php-yii --lang zh-TW 2>/dev/null
