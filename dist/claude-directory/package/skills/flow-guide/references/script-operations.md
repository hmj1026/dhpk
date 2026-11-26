# Script Operations

只在使用者明確要求「下一步要跑什麼腳本 / 指令」、或回覆需要具體 command template 時讀取本檔。

## Available Scripts

> **路徑**：scripts 位於本 Skill 目錄內的 `$SKILL_DIR/scripts/`。
> `$SKILL_DIR` 指含有所選 `SKILL.md` 的實體目錄；它是路徑記號，不是環境變數，
> 也不向 plugin cache、repository root 或 `~/.claude` 推測。以下用 `$SCRIPTS`
> 代表該目錄；目錄或腳本不存在時回報 `BLOCKED_RESOURCE_MISSING`。

1. `prepare_workflow_profile.py` (not shipped in the Directory Plugin)
   - 建立或更新 `profile.yaml`
2. `prepare_dev_scope.py` (not shipped in the Directory Plugin)
   - 建立 `dev-scope.md`、`legacy-reference.md`，必要時建立 Generic Docs 模板
   - 若 `--work-item-system openspec`，預設要求對應的 change directory 已存在
3. `workflow_gate_check.py` (not shipped in the Directory Plugin)
   - `feature` / `bugfix`：檢查 profile、work-item、legacy、RED gate
   - `lightweight`：只確認 heavy gate 應該被 skip，仍需另外回報 targeted verification
4. `openspec_gate_check.py` (not shipped in the Directory Plugin)
   - OpenSpec change 的 apply-ready adapter
   - 前置條件：需安裝 `openspec` CLI；若不存在，腳本回報 `Result: ERROR` 並以 exit 2 結束（不會丟出 traceback）

## Command Templates

> Not shipped in the Directory Plugin: `prepare_workflow_profile.py`, `prepare_dev_scope.py`, `workflow_gate_check.py`. Follow the matching stage in [the Manual Procedure](manual-procedure.md) and report `mode: manual`.

## Project-Specific Shortcuts

本檔只保留通用 command template。若需要專案預填值或 shortcut，改讀 `projects-index.md`，再依使用端專案的
`@rules/dev-workflow-project.md` 套用。
