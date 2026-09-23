# 跨 Host 的 command 工作流程

Codex 使用 `$<public-name>` 呼叫已安裝的 skill；Claude 原有的
`/dhpk:<command>` 入口轉接到同一份流程。使用 `$flow-guide help`
查詢參數；套件存在與實際可執行是不同的驗證結果。

## 名稱與遷移

| 原有入口 | Portable skill |
| --- | --- |
| `deep-analyze` | `$proposal-analyze` |
| `verify` | `$repo-verify` |
| `simplify` | `$code-simplify` |
| `smart-commit` | `$git-smart-commit` |
| `create-release` | `$release-creator` |
| `matrix-cell-onboard` | `$matrix-cell-onboard` |
| `codex-test-gen` | `$tdd-workflow test-generation <target>` |
| `check-coverage` | `$change-verdict --mode tests --coverage` |
| `precommit-fast` | `$precommit --fast` |
| `ts-check-status` | `$js-static-check-strategy status --path <directory>` |

其他通用流程直接使用 command 原名：`create-pr`、`git-worktree`、
`merge-prep`、`pr-summary`、`project-brief`、`doc-refactor`、`update-docs`、
`update-codemaps`、`precommit`、`dep-audit`、`harness-audit`、`review-pending`、
`spec-mine`。既有 `flow-guide`、`flow-drive`、`harness-govern` 維持名稱。

提交、發布、matrix onboarding、TDD 與 JS 靜態檢查的五個既有 skills
移除 `dhpk-` 前綴；stable ID 與 capability ID 保持不變。
其他帶前綴的 skills 不受影響。改名紀錄提供診斷，不發布重複的別名 skill。

用途決策清單以 ADR 記錄新增項目；原本 65 個 skills 的歷史基線保持不變，
目前的決策覆蓋全部 84 個 skills。

### Runner 與腳本遷移

下列獨占腳本路徑以 breaking cutover 移除，不發布相容 shim：

| 移除的路徑 | 所屬 Skill 目錄 |
| --- | --- |
| `scripts/precommit-runner.js` | `skills/precommit/scripts/` |
| `scripts/verify-runner.js` | `skills/repo-verify/scripts/` |
| `scripts/harness-audit.js` | `skills/harness-audit/scripts/` |
| `scripts/opsx-apply-resume/*.sh` | `skills/opsx-apply-resume/scripts/` |

setup installer 會把完整的本地 tree 複製到
`.claude/dhpk/skills/precommit/scripts/`、
`.claude/dhpk/skills/repo-verify/scripts/` 與
`.claude/dhpk/skills/harness-audit/scripts/`，若 runner 旁有
`lib/runner-utils.js` helper 也一併複製。Skill 會自動從自己的目錄解析
helper，不依賴 ambient dhpk checkout。resume helpers 由已安裝的
`opsx-apply-resume` Skill 直接使用；setup installer 不再複製它們，也不會移除
舊版安裝留在 `.claude/dhpk/scripts/opsx-apply-resume/` 的副本。確認沒有自己
的呼叫者後，請手動刪除這些副本。

setup installer 對舊的 root 檔案沒有 ownership receipt。只要 legacy runner
檔案存在，就會保留檔案、回報確切路徑與人工 reconciliation 動作，並在
preflight 以 exit 3 停止，即使帶有 `--force` 也一樣。實際安裝需要 Python 3
來執行 writer 以 file descriptor 為基礎的實體寫入；不可用時會在目標變更前以
exit 2 停止，`--dry-run` 則不需要 Python 3。

若要遷移有收據管理的安裝，請使用獨立的 receipt-aware Codex 流程
`scripts/hooks/install-codex-skills.sh`，不要把上面的無收據 setup copy 當成
遷移流程。該流程只允許遷移未被修改的受管理項目；已修改、未受管理或第三方
同名項目均保留並回報衝突。先處理衝突再重試。回退使用上一版本與相同的
receipt-aware 流程，不手動覆蓋整個目錄。

## 自足的 Skill 目錄

每個 canonical Skill 目錄本身就是完整的發布單位：`SKILL.md`、`references/`、
`scripts/` 及其他需要的檔案都放在目錄內。

- **Breaking：** 移除各 Skill 的 `skill-package.json` descriptor。publisher 與
  installer 都不再讀取 descriptor、不從 Skill 目錄外注入檔案，也不會隱含安裝
  其他 Skill。
- 多個 Skill 共用的 helper 會複製進每個需要它的 Skill。dhpk 維護者以僅限
  repository 的工具同步這些副本；consumer 不需要執行任何同步或建置步驟。
- Claude profile bundle 與 AGY package 現在會發布每個選取 Skill 的完整目錄；
  過去部分 Skill 只發布 `SKILL.md`。
- 新的 package receipt 不再包含 `skillPackageClosure`；仍帶有此欄位的舊
  receipt 依然有效。
- 升級有收據管理的 Codex 安裝時，新版 Skill 已不提供、且未被修改的
  descriptor 或 helper 會被移除；已修改或未受管理的檔案會保留並回報。
- Host 支援範圍不變。委派給其他 Skill 是選擇性的；必要的工具、Host 能力與
  獨立審查仍然適用。必要審查不可用時，結果為 `BLOCKED`。

以上描述的是規格與 fixture 測試過的行為。發布後的 consumer 安裝與 Host
probe 結果會另外記錄。

## 執行邊界

- `repo-verify` 執行檢查；`precommit` 可能執行格式修正。
- `dep-audit` 只有收到修正選項時才變更依賴。
- `create-pr` 預設預覽；release 與 Git 操作保留明確執行及授權邊界。
- `review-pending` 提供 reviewer 證據；gate clearance 是獨立的 runtime 操作。
- `harness-setup`、`opsx-apply-resume`、`ui-ux-verify` 有 Host 專用適配。
  Codex 發布需要 consumer 證據；工具或設定不足時明確回報不可用或受阻。

必要的 runners 與 references 隨套件提供。支援的 portable 流程不依賴
consumer 環境恰好存在 dhpk 原始碼；缺少選配 provider 時會回報狀態，
不視為已成功呼叫。
