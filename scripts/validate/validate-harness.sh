#!/bin/bash
# validate-harness.sh — 檢查 .claude/ 資產格式正確性
# 檢查項：
#   1. agents/*.md frontmatter 完整（name / description / model / tools）
#   2. commands/**/*.md 有 frontmatter
#   3. rules/*.md 無明顯 broken link（相對路徑 .md）
#   4. skills/*/SKILL.md 存在
#   5. hooks 腳本可執行
#   6. artifacts 目錄結構
#
# 退出碼：
#   0 = 全通過
#   1 = 有錯誤
#   2 = 有警告（非阻塞）
set -o pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 1

ERR=0
WARN=0

say() { echo "  $*"; }
fail() { echo "  [FAIL] $*"; ERR=$((ERR+1)); }
warn() { echo "  [WARN] $*"; WARN=$((WARN+1)); }
ok()   { echo "  [OK] $*"; }

echo "== 1. Agents frontmatter =="
for f in .claude/agents/*.md; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == "INDEX.md" ]] && continue
    head -20 "$f" | grep -q '^name:' || { fail "$base 缺 name:"; continue; }
    head -20 "$f" | grep -q '^description:' || fail "$base 缺 description:"
    head -20 "$f" | grep -q '^model:' || warn "$base 缺 model:"
    head -20 "$f" | grep -q '^tools:' || warn "$base 缺 tools:"
done
[[ $ERR -eq 0 ]] && ok "agents 全部通過"

echo ""
echo "== 2. Commands frontmatter =="
CMD_COUNT=0
CMD_MISSING=0
while IFS= read -r f; do
    CMD_COUNT=$((CMD_COUNT+1))
    base="$(basename "$f")"
    [[ "$base" == "INDEX.md" ]] && continue
    if ! head -5 "$f" | grep -q '^description:'; then
        warn "$(echo "$f" | sed 's|^.claude/commands/||') 缺 description"
        CMD_MISSING=$((CMD_MISSING+1))
    fi
done < <(find .claude/commands -name '*.md' 2>/dev/null)
ok "commands 檢查完 $CMD_COUNT 支，$CMD_MISSING 支缺 description"

echo ""
echo "== 3. Rules broken link 檢查 =="
for f in .claude/rules/*.md .claude/rules/**/*.md; do
    [[ -f "$f" ]] || continue
    # 抓 `*.md` 相對路徑引用
    while IFS= read -r link; do
        target="$(echo "$link" | grep -oE '[A-Za-z0-9_./-]+\.md' | head -1)"
        [[ -z "$target" ]] && continue
        # 跳過絕對路徑 / URL / 範本（含 20YYMMDD 時間戳或 {...} 佔位符）
        [[ "$target" == /* || "$target" == http* ]] && continue
        [[ "$target" =~ 20[0-9]{6} ]] && continue
        [[ "$target" =~ \{.*\} || "$target" == *latest.md ]] && continue
        dir="$(dirname "$f")"
        resolved="$dir/$target"
        [[ -f "$resolved" || -f "$target" || -f "$ROOT/$target" ]] || warn "$f 引用不存在 $target"
    done < <(grep -oE '`[^`]*\.md`' "$f" 2>/dev/null)
done
ok "rules broken link 檢查完"

echo ""
echo "== 4. Skills SKILL.md =="
for d in .claude/skills/*/; do
    [[ -d "$d" ]] || continue
    if [[ ! -f "$d/SKILL.md" ]]; then
        warn "$d 缺 SKILL.md"
    fi
done
ok "skills 檢查完"

echo ""
echo "== 5. Hook 腳本可執行 =="
for s in .claude/hooks/*.sh .claude/statusline.sh; do
    [[ -f "$s" ]] || continue
    [[ -x "$s" ]] || fail "$s 無執行權限（chmod +x）"
done
[[ $ERR -eq 0 ]] && ok "hook 腳本全可執行"

echo ""
echo "== 6. Artifacts 目錄 =="
for d in reviews plans audits adr sessions; do
    [[ -d ".claude/artifacts/$d" ]] || warn ".claude/artifacts/$d 不存在（session-start 未跑？）"
done
ok "artifacts 結構檢查完"

echo ""
echo "=========================================="
if [[ $ERR -gt 0 ]]; then
    echo "FAIL: $ERR 個錯誤 / $WARN 個警告"
    exit 1
elif [[ $WARN -gt 0 ]]; then
    echo "PASS (with warnings): $WARN 個警告"
    exit 2
else
    echo "PASS: 全部通過"
    exit 0
fi
