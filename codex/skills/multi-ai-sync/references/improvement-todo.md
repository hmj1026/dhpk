# Multi-AI-Sync 改進待辦（Run Retrospective）

本文件整理本次執行 `multi-ai-sync` 遇到的實際問題，作為 skill 優化待辦。

## 待辦清單

| ID | Priority | 問題（本次觀察） | 待辦事項 | 優化方向 | 狀態 |
|---|---|---|---|---|---|
| MAI-001 | P0 | `.codex/skills/*` 路徑在此環境為唯讀，導致 4 個 Codex skills 無法同步 | 在 Step 0 增加可寫性探測；apply 內建 fallback root 與 blocker 訊息 | 容錯與降級路徑 | DONE |
| MAI-002 | P0 | `agents/config/multi-agents` 目前僅能 manual（17 項中的 13 項） | 定義「可自動驗證不改寫」與「可半自動轉換」邊界，產生 reviewer-ready patch 而非直接覆寫 | 風險分層與邊界清晰 | DONE (manual draft output) |
| MAI-003 | P1 | 初版 Gemini TOML 轉換曾出現 escaping 錯誤 | 新增 converter regression tests（含反斜線、三引號、code fence） | 轉換器可回歸測試 | DONE (self-test) |
| MAI-004 | P1 | `validate` 對 Gemini TOML 目前只檢查 token，不做語法解析 | 強化 `validate`：實際 parse TOML，輸出檔名與錯誤訊息 | 輸入驗證強化 | DONE |
| MAI-005 | P1 | plan / tasks / apply 三份輸出缺少統一的 execution id，追蹤不易 | 加入 `sync_run_id` 與一致的 artifact 命名規則 | 可追溯性 | DONE (apply) |
| MAI-006 | P1 | 套用後需人工回寫 `tasks.md` 勾選狀態 | 新增 `apply --update-tasks <tasks.md>`，依 apply report 自動勾選已套用項目 | 自動化閉環 | DONE |
| MAI-007 | P2 | Gate 常見 `PARTIAL`（hooks / gemini multi-agent skip-incompatible）容易被誤判為失敗 | 在 SKILL 與報告中明確定義 `PASS/PARTIAL/FAIL` 決策準則 | 判讀一致性 | DONE |
| MAI-008 | P2 | 大量檔案變更時，狀態檢視成本高 | 增加「變更摘要報告」（按目標平台與類型統計）作為固定輸出 | 可觀測性摘要 | DONE |

## 已完成的本次改進

- 新增 `apply` 子命令（支援 `--dry-run`、報告輸出、manual blocker 分類）。
- `SKILL.md` 新增 Step 0 Preflight 與 Step 3 apply 流程。
- Gemini command 轉換已改為可解析 TOML 格式（實測 parse `errors = 0`）。
- 新增 `.codex/skills` 唯讀 fallback（預設到 `artifacts/codex-skills-fallback`）。
- 新增 `apply --update-tasks` 與 `--manual-draft-output`，形成執行閉環。
- 新增 `self-test` 子命令，驗證 converter 輸出 TOML 可解析。
- `validate` 報告加入 Gate Criteria，明確 `PASS/PARTIAL/FAIL` 判讀。
