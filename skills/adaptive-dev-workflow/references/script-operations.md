# Script Operations

只在使用者明確要求「下一步要跑什麼腳本 / 指令」、或回覆需要具體 command template 時讀取本檔。

## Available Scripts

> **路徑**：scripts 隨 dhpk plugin 出貨於
> `${CLAUDE_PLUGIN_ROOT}/skills/adaptive-dev-workflow/scripts/`。
> 若 `CLAUDE_PLUGIN_ROOT` 未設定（手動安裝），fall back 到
> `~/.claude/skills/adaptive-dev-workflow/scripts/`。以下用 `$SCRIPTS` 代表該目錄。

1. `python3 $SCRIPTS/prepare_workflow_profile.py`
   - 建立或更新 `profile.yaml`
2. `python3 $SCRIPTS/prepare_dev_scope.py`
   - 建立 `dev-scope.md`、`legacy-reference.md`，必要時建立 Generic Docs 模板
   - 若 `--work-item-system openspec`，預設要求對應的 change directory 已存在
3. `python3 $SCRIPTS/workflow_gate_check.py`
   - `feature` / `bugfix`：檢查 profile、work-item、legacy、RED gate
   - `lightweight`：只確認 heavy gate 應該被 skip，仍需另外回報 targeted verification
4. `python3 $SCRIPTS/openspec_gate_check.py --change <name>`
   - OpenSpec change 的 apply-ready adapter
   - 前置條件：需安裝 `openspec` CLI；若不存在，腳本回報 `Result: ERROR` 並以 exit 2 結束（不會丟出 traceback）

## Command Templates

```bash
SCRIPTS="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/adaptive-dev-workflow/scripts"

# 建立/更新 profile
python3 "$SCRIPTS/prepare_workflow_profile.py" \
  --language "<language>" \
  --runtime "<runtime>" \
  --current-version "<current>" \
  --target-version "<target>" \
  --architecture "<architecture>" \
  --test-strategy "<test-strategy>" \
  --style "<style-summary>" \
  --dependency-policy "<policy-summary>" \
  --work-item-system "<openspec|docs|other>"

# 建立 change scope
python3 "$SCRIPTS/prepare_dev_scope.py" \
  --change "<name>" \
  --reason "<reason>" \
  --ticket "<ticket>" \
  --path "<impacted-path>" \
  --work-item-system "<openspec|docs|other>"

# 通用 gate 檢查
# feature / bugfix 必填；lightweight 只做 skip confirmation
python3 "$SCRIPTS/workflow_gate_check.py" \
  --workflow-type "<feature|bugfix|lightweight>" \
  --profile ".workflow/profile.yaml" \
  --work-item "<path-or-id>" \
  --legacy-reference "<path>" \
  --red-proof "<path>"
```

## Project-Specific Shortcuts

本檔只保留通用 command template。若需要專案預填值或 shortcut，改讀 `projects-index.md`，再依使用端專案的
`@rules/dev-workflow-project.md` 套用。
