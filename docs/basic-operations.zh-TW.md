# 基本操作流程

> **語言**: [English](./basic-operations.md) · **繁體中文**

本頁說明 dhpk 的操作生命週期：安裝、日常指令流程、自動 review 循環，以及如何將既有專案遷移過來。完整的 `userConfig` 旋鈕參考請見 [`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)。

## 安裝

dhpk 遵循 [Claude Code plugin 標準發布模式](https://docs.claude.com/en/docs/claude-code/plugins)：同一份 marketplace + manifest 可從**兩個入口**使用，依你的習慣挑一個即可：

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Claude Code session 內** — `/plugin marketplace add …` / `/plugin install …`（或 `/plugin` 互動式瀏覽器）

兩個入口都讀同一份 `.claude-plugin/marketplace.json`，結果一致。

### Path A — 從 GitHub 安裝（推薦）

不用 clone。一般使用者的最短路徑。

```bash
# Terminal
claude plugin marketplace add hmj1026/dhpk
claude plugin install dhpk@dhpk
```

```text
# …或在 Claude Code 內
/plugin marketplace add hmj1026/dhpk
/plugin install dhpk@dhpk
```

要在安裝時就帶入設定，加 `--config`（若你想之後用 `/dhpk:setup` 互動回答就跳過）——完整旋鈕參考見 [`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)：

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-8.x,laravel-11,phpunit-11,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

要鎖定特定版本，後面接版本號：`claude plugin install dhpk@dhpk@v0.6.0`。可用技術棧／版本列在 `manifests/module-catalog.json`（SSOT）；精選組合在 `manifests/install-profiles.json`。Docker 前置須知請見 [`docs/docker-setup.md`](./docker-setup.md)。

安裝後，可隨時在 Claude Code 內重新設定：

```text
/dhpk:setup           # 重跑同一份問答
/dhpk:setup --show    # 印出目前生效設定
```

### Path B — 本地 clone + 互動安裝精靈

如果你想要在 Claude 之外有 shell 安裝精靈，或本來就會改 plugin 原始碼，走這條。**必須先 `git clone`**，因為精靈腳本在 repo 裡。

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh        # 互動（gum / python3 fallback）
```

精靈會帶你選技術棧／版本、設定 docker 前置條件、覆寫 review agent、選 hook profile，最後幫你執行 `claude plugin install`。加 `--dry-run` 只印出組好的指令、不實際執行。

任何時候都可以驗證 local checkout：

```bash
claude plugin validate ~/projects/dhpk --strict
```

要邊改 plugin 原始碼邊看效果（不走 install/reinstall 迴圈），請見 [§ 開發](#開發)。

### 更新／移除

```bash
claude plugin update dhpk              # 從 marketplace 拉最新版
claude plugin uninstall dhpk           # 移除 plugin
claude plugin marketplace remove dhpk  # 忘記 marketplace 註冊
```

在 Claude Code 內也可以用 `/plugin update dhpk`、`/plugin uninstall dhpk`、`/plugin marketplace remove dhpk`。

### 安裝疑難排解

| 症狀 | 可能原因 | 解法 |
|---|---|---|
| `marketplace add` 說路徑不存在 | 你走 Path B 但沒先 clone | 先跑 `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk`，或直接改用 Path A（不用 clone） |
| `claude plugin install dhpk@dhpk` 找不到 marketplace | `marketplace add` 沒跑過，或已被移除 | 重跑你那條路徑的 `marketplace add` 指令 |
| 裝完但 `/dhpk:*` 命令或 hooks 沒出現 | session 在安裝完成前就讀過 skill list | 在 Claude Code 內 `/reload-plugins`，或重啟 session |
| `claude plugin list` 看到 dhpk 但 `/dhpk:setup` 不存在 | plugin 裝起來但停用了 | `claude plugin enable dhpk`（或 `/plugin enable dhpk`） |
| `install.sh` 抱怨找不到 `gum` / `jq` | 互動 UI 的選用依賴沒裝 | 腳本會自動 fallback 到純 shell / `python3`，想要更好看可裝 `gum` 與 `jq`，不裝也能用 |
| 部分 skill 描述被截斷/漏掉（`/doctor` 可見） | 裝了很多模組 → skill-listing 預算超載（模組 skill 一律列出、不受 `modules` 限制，[#12](https://github.com/hmj1026/dhpk/issues/12)） | 提高 `settings.json` 中的 `skillListingBudgetFraction`（預設約 1% → 試 `0.02`–`0.03`），或少裝幾個模組／用 `/plugin` 在不需要的專案停用整個 plugin |

## 常見工作流

所有功能都能透過 `/dhpk:do` 進入——一個接收自然語言任務描述、並路由到正確 skill 的單一入口。以下範例說明輸入指令後實際發生的事。

### 1. 新功能開發

```text
/dhpk:do implement a password-reset email flow
```

Smart Router 匹配「implement … feature」→ `dhpk:adaptive-dev-workflow` → **Feature Delivery** 路徑。該 skill 載入 TDD guide，執行 RED→GREEN→REFACTOR 循環，最後以 code-review 與 security gate 收尾。每次寫檔後，post-edit hook 自動投下 sentinel；Stop hook 在 session 結束時提醒尚未清除的 reviewer。

### 2. 修 Bug

```text
/dhpk:do fix the login redirect loop
```

匹配「fix … bug」→ `dhpk:adaptive-dev-workflow` → **Bug Investigation & Fix**：先確認根因證據、撰寫回歸測試，通過 RED gate 後才動手修。

**`--openspec` / `--opsx` 旗標：** 在 `/dhpk:do` 加上 `--openspec`（別名 `--opsx`）可強制走 OpenSpec 撰寫流程（`opsx:new` → `opsx:ff`，接著停下等待人工審閱），而不直接進入實作。此旗標適用於 3 個「變更撰寫」路由 —— `dhpk:adaptive-dev-workflow`、`dhpk:bug-fix`、`dhpk:feature-dev` —— 並取代 `--plan`。在其餘路由（包含 `dhpk:opsx-apply-goal`）上此旗標無作用：會印出 `--openspec ignored: ...` 並照常執行原路由。

### 3. 程式碼 review 循環（自動）

不需要任何指令。每次編輯檔案後，hook 自動：

1. 為各相關 reviewer slot（code / db / sec / frontend / doc）投下 `.pending-*` sentinel
2. 在 Stop 時提醒並行派發 reviewer
3. sentinel 存在時，`git commit` 前會發出警告（可透過 `sentinel_commit_gate` 設定：`warn` / `block` / `off`——見 [`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)）

若想立即觸發而不等 Stop：`/dhpk:review-pending`

### 4. 提交與建立 PR

```text
/dhpk:smart-commit        # 暫存變更檔案、產生 conventional commit 訊息、跑 pre-commit gate
/dhpk:create-pr           # 從分支 commit log 草擬 PR 標題與摘要
```

或用自然語言：

```text
/dhpk:do 幫我提交並建立 PR
```

### 5. 無人值守 OpenSpec session

適用於需要長時間執行、不需人在旁監看的變更實作——產生單一一段 `/goal` 指令（已內嵌 `/opsx:apply` 啟動指示），貼到新 session 即可執行：

```text
/dhpk:opsx-apply-goal my-change-id --max-duration 2h
```

**旗標：**

| 旗標 | 含意 |
|---|---|
| `<change-id>` | 必填。`openspec/changes/` 下的變更目錄名稱——不是自由文字；這是唯一一個 `/dhpk:do` 的任務描述會變成「id + 旗標」而非任務描述的路由（見第 1 項的路由說明）。 |
| `--turns N` | 覆寫自動計算的回合預算（預設：`max(20, min(120, 未完成任務數 × 4 + 20))`）。到達預算時 session 會寫入 `.resume-note.md` 並停止——這是硬性的檢查點，不只是建議。 |
| `--max-duration <Nm\|Nh>` | 加上時鐘停止條件（例如 `30m`、`2h`）。省略則沒有時間上限——只靠回合預算限制。 |
| `--min-coverage N` | 即使專案沒有原生覆蓋率設定，也強制套用 `N`% 的覆蓋率門檻。需要偵測到測試 runner；否則忽略（並附註說明）。 |
| `--codex` | 讓這次 session 的 `/goal` 字串內嵌 `CODEX=on` 的跨模型 doubt-cycle / 高風險同儕審查條款。與 `/dhpk:do` 自身的 `--codex` 無關——傳給 `/dhpk:do` 的 `--codex` **不會**自動轉發到這個旗標；要用就直接加在這裡。 |
| `--smoke` / `--no-smoke` | 強制開/關唯讀的即時執行探針門檻。兩者都不加則自動偵測：只有強訊號（明確的即時驗證任務、已派遣的 `e2e-runner`、或可推導的啟動指令）才會開啟，否則關閉。 |
| `--dry-run` | 只印出分析結果與 goal 字串，不附「可貼上」的 session 設定框架——用來在真正執行無人值守迴圈前先預覽。 |

**貼上的 `/goal` 字串實際內容：** 以「先定位再行動」開場——先執行一個 Bash 定位指令（`head -40 openspec/changes/<change-id>/tasks.md`），*再*呼叫 `opsx:apply`；若此時 skill 目錄還沒註冊好，附一條備援（`Unknown skill` → 下一回合重試一次 → 仍失敗 → 直接讀該變更目錄的 `proposal.md`/`design.md`/`tasks.md` 並直接實作）；一個會自我定位 `rules/execution-policy.md` 的指標（優先 `$CLAUDE_PLUGIN_ROOT`，其次最新安裝的 plugin cache 路徑，再其次退回 goal 字串自身的條件——絕不掃描檔案系統）——不論 `orchestration_dispatch` 設定為何都會內嵌，因為只有 dispatch 指示本身才受該設定控制；「`tasks.md` 所有 checkbox 都是 `[x]`」的條件；「沒有待處理的 reviewer sentinel」的通用檢查（`ls .claude/artifacts/sessions/.pending-*` 輸出 `NONE`）；針對這次變更**實際偵測到**的每個驗證門檻各一行（測試 runner、build、lint、覆蓋率、smoke——只列出適用的，不會強加）；以及停止條件（回合預算作為硬性檢查點——寫入 `.resume-note.md` 並結束 session，而非僅供參考；可選的時鐘上限；當剩餘任務全部卡在只有人類才能做的動作時，在 `tasks.md` 標註 `[blocked: <reason>]` 並停止的 blocked-on-human 條款；以及遇到明確政策衝突時停下並寫入 resume note 的 hard-rule-escalation 條款，而非硬猜）。完整結構見 `skills/opsx-apply-goal/SKILL.md` Step 6（Part 0-4）。

當 `orchestration_dispatch=on`（預設）時，產生的 `/goal` 條件也會內嵌一行 dispatch 指示，透過 `deep-reasoner` / `fast-worker` 路由實作工作（見下方第 9 項）。設為 `orchestration_dispatch=off` 可完整關閉該 dispatch 指示——實作工作一律內嵌執行，不再透過 worker agent 路由。

**4000 字元貼上上限：** Claude Code 的 `/goal` 輸入有大約 4000 字元的實際貼上上限。若組成的 goal 字串會超過此上限，`opsx-apply-goal` 會先自動精簡 Part 0——啟動句、dispatch 指示（`orchestration_dispatch=on` 時）、以及 CODEX 說明（設了 `--codex` 時）——規則不變、文字變短；若精簡後仍超過上限，則完全不會印出 `/goal` 指令——而是顯示字元數與該調整哪個設定或旗標（關閉 `orchestration_dispatch` 這個專案設定、或拿掉 `--codex` / `--smoke`）後再重新執行。

### 6. 從現有程式碼萃取規格

將現有模組的行為需求萃取為 `openspec/specs/<capability>/spec.md`（棕地專案導入規格驅動開發的起點）：

```text
/dhpk:spec-mine user-authentication
```

委派給 `spec-miner`（Opus）agent。省略 capability 名稱會顯示提示清單讓你選擇。

### 7. E2E 測試撰寫

```text
/dhpk:do write E2E tests for the checkout flow
```

路由到 `dhpk:post-dev-test`，委派 `e2e-runner` agent 負責 Playwright 測試套件撰寫。

### 8. Harness 健康檢測與修復

harness-* 工具家族各自負責不同面向——請依需求選用正確工具：

| 指令 / Skill | 負責面向 | 是否修改檔案 |
|---|---|---|
| `/harness-audit` | 確定性 7 大分類評分 | 否 |
| `dhpk:harness-budget` | Context window token 用量統計 | 否 |
| `dhpk:claude-health` | `.claude/` 設定健康、命名、plugin 同步 | 否 |
| `/harness-govern` | 端到端 measure → conform → fix → verify 循環 | 否（加 `--fix` 才套用修改） |
| `dhpk:harness-revise` | 精簡、去重、驗證（G1–G13 gap 分類） | 是 |
| `dhpk:harness-fill` | 補齊缺失的 `.claude/` 基礎設施 | 是 |

**典型流程：**

```text
# 1. 快速診斷——看看哪裡有問題
/harness-audit

# 2. 檢查 context window 用量（token 預算）
/dhpk:harness-budget

# 3. 端到端治理循環（預設唯讀）
/harness-govern

# 4. 套用修復（精簡、去重、驗證）
/harness-govern --fix

# 5. 若 .claude/ 缺少 skills/agents/rules（新專案導入）
/dhpk:harness-fill
```

`/harness-govern` 是單一入口：依序執行 `/harness-audit`（評分）→ conform（最佳實踐對齊）→ `/harness-revise`（修復，僅在加 `--fix` 時）→ 驗證。可以 `/loop /harness-govern` 持續監控。

### 9. Implementation dispatch（自動）

在 `feature-dev`、`bug-fix`、`adaptive-dev-workflow` 的實作階段，工作現在會被路由而非直接撰寫：推理密集的工作（根因未知、演算法設計、跨檔案除錯）交給 `dhpk:deep-reasoner`（opus、唯讀——回傳 conclusion contract，絕不編輯檔案）；有明確 spec 的機械式工作（樣板程式、測試骨架、重新命名掃描、套用已核准的計畫）交給 `dhpk:fast-worker`（sonnet、可寫入——套用編輯、執行驗證、失敗 3 次後升級）；小型 diff（約 ≤2 個檔案、意圖明確）維持內聯處理；複雜的實作則串接兩者（`deep-reasoner` 產生修復 spec → `fast-worker` 套用）。當 dispatch 啟用時，禁止用 `general-purpose` 執行實作工作。完整分派表見 [`rules/execution-policy.md`](../rules/execution-policy.md) §"Implementation dispatch"。

模型覆寫：`deep_reasoner_model`（預設 `opus`）、`fast_worker_model`（預設 `sonnet`）——見 [`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)。設定 `orchestration_dispatch=off` 可完整還原 v0.22.0 之前的行為。

**`CODEX=on` 高風險並行 peer 路徑**：對於高風險的實作階段設計／診斷決策，這個派發步驟可以額外把 Codex 加入作為 `deep-reasoner` 之外的第二個獨立 peer——實際如何 opt-in、「獨立」在此的具體意涵，見下方第 10 項。

### 10. Codex 雙助理協作

dhpk **預設 codex-free**。Opt-in 後會解鎖兩個相關但不同的東西：

**A. Implementation dispatch 中的 Codex peer。** 設定 `CODEX=on` 後，高風險的實作階段決策（根因診斷、架構選擇）不再只有 `deep-reasoner`：dhpk 會把 `deep-reasoner` 與 Codex（透過 `mcp__codex__codex`）**並行派發，且雙方互不知道對方的結論**——任一方的 prompt 都不會被餵入對方的結論、判斷或理論——完成後比對兩個獨立結果，並在報告中明確標出分歧。這條「盲式獨立」規則同時適用於 `codex-architect`、`codex-brainstorm`、`codex-implement`、`codex-code-review` 這幾個 skill，以及 `multi-ai-sync`、`feature-verify`、`test-review`、`code-investigate`、`issue-analyze`。完整規則見 [`rules/execution-policy.md`](../rules/execution-policy.md) §"Multi-AI / dual-perspective independence"。

**B. 六個直接委派給 Codex 的 skill** —— `codex-architect`、`codex-brainstorm`、`codex-cli-review`、`codex-code-review`、`codex-explain`、`codex-implement` —— 可直接呼叫（例如 `/codex-code-review`），不需要經過 `/dhpk:do`。

這六個 skill 裡有五個（除了 `codex-cli-review`——它透過 `Bash` 直接呼叫 `codex` CLI 執行檔，不需要 MCP server）需要 `mcp__codex__codex` / `mcp__codex__codex-reply` 工具，這來自**直接註冊 Codex CLI 自己的 `codex mcp-server` 子指令**作為 MCP server——**並非**安裝 `openai/codex-plugin-cc` plugin，那是另一個獨立、可選的介面。安裝步驟與 `CODEX=on` 的 opt-in 機制（`/dhpk:do` 的 `--codex` flag／自然語言觸發）見 [`docs/configuration.zh-TW.md`](./configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕)。

這與下方的**同步 Codex CLI 內容**是兩回事——那是把 dhpk 自己的 skill 鏡射進專案的 `.codex/` 目錄，給獨立的 `codex` CLI 工具使用，完全不涉及 MCP server。

## 同步 Codex CLI 內容

同時使用 Claude Code 與 Codex CLI 的專案：

```bash
# 在任意專案根目錄執行：
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

預設以 symlink（或用 `--copy` 複製）把插件的 `codex/{skills,agents}` 連到專案的 `.codex/`。具冪等性 — 插件版本 bump 後可用 `--update` 重跑。`codex/agents/` 現在提供 11 個角色（4 個手動維護的通用角色 + 7 個由 `scripts/gen-codex-agents.js` 從 Claude 標準 agent 產生，原本只有 4 個）。雙 harness 模型詳見 `codex/AGENTS.md` 與 `codex/README.md`。

### Codex Plugin Marketplace（實驗性）

dhpk 也提供 Codex plugin manifest（`.codex-plugin/plugin.json` + `plugins/dhpk/` 下的精簡 marketplace-target wrapper），讓 Codex CLI 自己的 plugin marketplace 可以原生探索並安裝 `codex/skills/` 鏡像。有兩種安裝方式：

**方式 A — 交給 AI 執行。** 在 Codex CLI 對話中貼上：

```text
請把 hmj1026/dhpk 加入 Codex plugin marketplace 來源，安裝其中的 dhpk
plugin，並確認已列在已安裝清單中。執行：
  codex plugin marketplace add hmj1026/dhpk
  codex plugin add dhpk@dhpk
  codex plugin list
回報 codex plugin list 的結果，並檢查 codex/skills/ 的內容是否真的解析
進安裝的 plugin cache 內 —— Codex 有一個已知的上游問題
（openai/codex#26037），透過 marketplace-target wrapper 引用的 skill
有時不會被複製進 runtime cache。
```

**方式 B — 自己手動執行指令：**

```bash
codex plugin marketplace add hmj1026/dhpk   # 或開發時用本機路徑
codex plugin add dhpk@dhpk
codex plugin list
```

> **Plugin mode 目前在 Codex 上仍屬實驗性 / 不穩定**（已對照 `codex-cli 0.142.5` 驗證）。Marketplace 探索與安裝可以正常運作，但從本機/repo marketplace 載入 skill 在上游仍不穩定（見 [openai/codex#26037](https://github.com/openai/codex/issues/26037)）。目前唯一穩定可用的路徑仍是上面的 `install-codex-skills.sh` — marketplace manifest 是額外補充，並非取代。

詳見 `.codex-plugin/README.md` 與 `plugins/dhpk/README.md`。

## 遷移現有專案

若專案已有自己的 `.claude/` harness，請依分階段計畫進行：

1. **階段 A — baseline**：快照安裝前的 hook 輸出與測試結果。
2. **階段 B — 並行安裝**：以 `userConfig.review_agents` 指向專案既有 agent 安裝插件。兩套 hook 並行觸發。
3. **階段 C — 探索**：確認 `/agents` 與 `/plugin details dhpk` 顯示預期的元件。
4. **階段 D — hook 對齊**：比對插件側 sentinel 與專案側差異。記錄所有預期內的差異。
5. **階段 E — 切換**：透過 `.claude/settings.local.json`（`"hooks": {}`）停用專案內建 hook；跑回歸測試。
6. **階段 F — 清理**：刪除已由插件提供的專案內檔案；保留專案特定的覆寫。

每個階段都有 rollback gate。刪除任何東西前，先 tag `pre-dhpk-migration`。

## 開發

要迭代插件原始碼本身（不走 install/reinstall 迴圈），用 `--plugin-dir` 直接載入 working tree：

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude --plugin-dir ~/projects/dhpk
```

對插件檔案的編輯，需要 `/reload-plugins` 後才會生效（hook、MCP、LSP），或重啟 session（monitor、skill 列表）。

Marketplace 安裝路徑（`claude plugin install`）會把插件複製到 `~/.claude/plugins/cache/`，所以對原始 repo 的編輯在那裡不會生效，必須 `claude plugin update dhpk` 才會更新。
