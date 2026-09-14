# 解決方案提案 — Codex 專案自訂角色註冊

依據：`investigation.md`。根因＝專案本地 `.codex/agents/*.toml` 只有在
(a) 專案於生效 `$CODEX_HOME/config.toml` 被標記 `trust_level = "trusted"`、且
(b) 未使用 `--ignore-user-config` 時，才會進入 `spawn_agent` 的 `agent_type` 列舉。

## 選項

### A（建議）修正 consumer gate 的探測前置條件

`scripts/release/consumer-gate.js` 的 `codex-sync` 探測改為：

1. 建立一次性 `CODEX_HOME`（憑證以 symlink 引用既有 `auth.json`，**不得複製憑證**）；
2. 在其 `config.toml` 預先寫入
   `[projects."<一次性專案絕對路徑>"] trust_level = "trusted"`；
3. **移除 `--ignore-user-config`**（隔離已由一次性 `CODEX_HOME` 達成）；
4. 斷言改為「`spawn_agent` 接受 `agent_type`，且四個角色各自 completed spawn + targeted wait」，
   而非依賴文字 PASS/FAIL 或子代理回覆內容。

- 優點：忠實反映真實使用者狀態；不動安裝器與角色檔；隔離性不降低。
- 缺點：gate 需自行管理一次性 home 與 trust 前置條件，並須在報告中明示此前置條件。
- 影響：`scripts/release/consumer-gate.js` 及其測試；OpenSpec task 2.2 / 2.4。
- 與 `design.md` Decision 3 的關係：該決策禁止 gate 供應 `-c agents.*` 註冊或
  建立／編輯**專案或使用者** `config.toml`。本方案不註冊角色、也不碰使用者設定，
  只在 gate 自建的一次性 `CODEX_HOME` 寫入信任記錄；實作時應同步更新 Decision 3 的措辭，
  明確允許「一次性 home 的信任前置條件」，避免實作者被既有政策文字擋住。
- 測試（TDD）：RED — 無 trust 記錄時 gate 須回報結構化
  `CUSTOM_AGENT_REGISTRY_UNAVAILABLE`（並保留既有一般失敗路徑不受影響）；
  GREEN — 有 trust 記錄時四角色全部 completed spawn + targeted wait。
- 回滾：單一檔案還原。

### B 安裝器改寫入 `$CODEX_HOME/agents/`

- 優點：不受專案信任閘控。
- 缺點：破壞「專案本地、隨 repo 走」的既有設計；跨專案角色互相污染；
  與現行 receipt / ownership / rollback 模型衝突。
- 建議：不採用。

### C 僅修正文件與分類

把 `CUSTOM_AGENT_REGISTRY_UNAVAILABLE` 的語意由「上游缺陷」改寫為
「專案未受信任或設定載入被抑制 → 角色來源未載入」，並在安裝文件說明
使用者首次於專案執行 Codex 時需信任該目錄。

- 優點：成本最低。
- 缺點：gate 仍產不出 task 2.2 所需的真實 runtime 證據。
- 建議：作為 A 的附帶項，非替代。

## 建議

採 **A ＋ C 的文件部分**。

## 風險

- Codex 若變更 trust 語意，gate 會再次失真；建議在 gate 保留
  「malformed 角色檔警告」與「`agent_type` 列舉內容」兩項次要證據。
- **False PASS**：註冊表為空時模型可能降級為無 `agent_type` 的一般 spawn 並回報成功。
  斷言必須檢查 `agent_type` 被實際接受，否則 gate 會誤判通過。
- 一次性 `CODEX_HOME` 若無憑證會回 401；務必以 symlink 引用，不複製 `auth.json`。

## 需撤回 / 降級的既有行動

- 交接文件 next action 5（以「registry unavailable」為框架的上游缺陷回報）**取消**：
  無上游缺陷證據。
- 降級保留：「註冊表為空時錯誤訊息為 `unknown agent_type`，未提示信任問題」
  可作為獨立的低優先可診斷性建議。

## OpenSpec 路由

不開新 change。沿用既有 `openspec/changes/fix-codex-agent-symlink-runtime`，
在其 task 2.2 / 2.4 下實作；`design.md` 的 Decision 3 與 Open Questions 需依本提案改寫。

## 下一步（唯一交接）

以 `dhpk:dhpk-tdd-workflow` test-first 實作選項 A；
編輯 `scripts/release/consumer-gate.js` 前先跑 GitNexus impact。
