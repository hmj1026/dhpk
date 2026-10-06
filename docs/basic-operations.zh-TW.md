# 基本操作

> **語言**： [English](./basic-operations.md) · **繁體中文**

## 驗收適用性

已安裝結構與選定生命週期檢查是預設驗收邊界。CLI 存在不代表 native runtime
已執行；只有受影響的整合、啟用缺陷或明確要求才觸發 native 檢查。操作紀錄要
保留 `NOT_RUN`、`UNAVAILABLE` 與 `BLOCKED`。

本頁說明 dhpk 的操作生命週期：安裝、日常指令流程、自動 Review 週期，以及
如何將既有專案遷移到 dhpk。Codex/Cursor 的安裝、狀態與回滾細節請看
[平台安裝 SSOT](./platform-installation.zh-TW.md)；完整的 `userConfig` 旋鈕請看
[`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)。

## 決策階梯

`manifests/install-profiles.json` 的 `common` collection 是唯一主要安裝預設。
目前 Host 路徑、支援狀態與 receipt 管理由[平台安裝 SSOT](./platform-installation.zh-TW.md)
說明。Static package evidence 不等於 runtime evidence；在對應 consumer 被實際觀察前
應記錄 `NOT_RUN`、`BLOCKED` 或 `UNAVAILABLE`。

新請求依序執行：**檢查** repository 與 session 狀態 → **確認** 已安裝的
surface → **選擇** Claude、支援的 Codex sync 或實驗性的原生 Codex surface →
透過 Claude `/dhpk:flow-guide`（分類）、`/dhpk:flow-drive`（執行）、Cursor
產生的 command，或 Codex `$flow-guide`／`$flow-drive`（Codex 沒有
`/dhpk:*` command）或明確 family skill **路由** → 以 TDD 與編輯前 impact check
**實作** → **Review／驗證**證據 → **交接**並只給一個下一步指令。
Plugin 管理（`claude plugin …`、`codex plugin …`）不會呼叫 skill。

行為 SSOT 包括 [`rules/execution-policy.md`](../rules/execution-policy.md)、
[`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)、
[`docs/skill-platform-migration.zh-TW.md`](./skill-platform-migration.zh-TW.md)、
[`docs/distribution-surfaces.zh-TW.md`](./distribution-surfaces.zh-TW.md)、
[`distribution-inventory.json`](../manifests/distribution-inventory.json)、
[`scripts/install.sh`](../scripts/install.sh)、支援的
[`install-codex-skills.sh`](../scripts/hooks/install-codex-skills.sh)，以及支援的
[`install-cursor-harness.sh`](../scripts/hooks/install-cursor-harness.sh)。OpenSpec
變更提案、specification 與 task 證據位於 `openspec/changes/`；validator 通過不等於
版本控制交付完成。

當目的地不清楚且工作會跨 session，先記錄 wayfinder checkpoint：候選目的地、
目前 frontier，以及一個下一步決策。單一 session 且目的明確的請求直接進入路由。

不知道先用哪一個入口時，先看：
[技能與 Slash Command 快速速查（非專業版）](./skill-command-cheat-sheet.zh-TW.md)。

## 分發面政策

dhpk 刻意提供多個不同支援等級的 surface：

| Surface | 等級 | 意義 |
|---|---|---|
| Claude marketplace | Supported | 主要 consumer 安裝與更新路徑。 |
| `claude --plugin-dir` | Development-only | Working-tree 迭代，不是 release channel。 |
| `scripts/install.sh` | Convenience wrapper | 執行 Claude 安裝契約，不是另一個分發管道。 |
| `install-codex-skills.sh` | Supported | 穩定且 canonical 的 Codex project sync 路徑；runtime activation 與 native `dhpk@dhpk` plugin 互斥。 |
| `install-cursor-harness.sh` | Supported | 穩定的 Cursor project-local sync 路徑（`.cursor/`）。 |
| Codex plugin marketplace | Experimental | 僅供 disposable isolated `CODEX_HOME` 實驗的實體 publication package；runtime activation 與 project-local sync 互斥，在另一次升級決策前維持 Experimental。 |
| OpenAI Public Plugin Directory | Submission candidate（`NOT_PUBLISHED`） | 平台核准並發布後，才是 Codex 與 ChatGPT Work 的預定日常路徑；local/repository marketplace 只供開發與測試。 |
| Antigravity / AGY sync | Adapter/package | Antigravity project skills 使用 `.agents/skills` mapping，rules/workflows 仍在 `.agent`；AGY 使用原生 plugin package 與 validator。 |

OpenAI Public Plugin 尚未出現在公開目錄。發布前，僅在現有流程仍適用時使用下方的
supported 與 compatibility 程序。公開 listing 發布後才成為預定日常路徑；一次性舊安裝
cutover executor 尚未交付。目前的 native Codex marketplace 是另一個 experimental
package；local repository marketplace 不會發布 OpenAI listing。詳見
[提交準備 SSOT](./openai-submission.zh-TW.md)。

Plugin 管理指令（`claude plugin …`、`codex plugin …`）與 skill invocation 分開。
每個 host 只選一條 Codex runtime route：日常工作使用支援的 project-local
`codex-sync`，或只在 disposable isolated `CODEX_HOME` 使用 experimental native
package。
Claude workflow 從 `/dhpk:flow-guide`、`/dhpk:flow-drive` 或明確 family skill
進入；Cursor 在 `install-cursor-harness.sh` 之後使用產生的 command；Codex 在
project-local `.codex/` 同步後從 `$flow-guide`／`$flow-drive` 進入（Codex 沒有
`/dhpk:*` command）。

## 安裝

dhpk 遵循標準的 [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins)：
同一個 marketplace + manifest 提供兩個 surface，請選擇適合自己的方式：

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Claude Code session 內** — `/plugin marketplace add …` / `/plugin install …`
  （或互動式 `/plugin` browser）

兩個 surface 都讀取本 repository 的 `.claude-plugin/marketplace.json`，結果相同。

### Path A — GitHub（推薦）

不需要 clone，適合一般使用者。

GitHub marketplace 使用目前選定的 common 預設集合。Claude 安裝、更新、
migration、receipt 與 collision 的操作程序由[平台安裝 SSOT](./platform-installation.zh-TW.md)管理。

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

可用 `--config` 旗標預先設定 config（也可以安裝後透過 `/dhpk:setup` 互動回答）：
完整旋鈕請看 [`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)。

```bash
claude plugin install dhpk@dhpk \
  --config modules=php-8.x,laravel-11,phpunit-11,library-author \
  --config docker_containers=php-fpm,mysql \
  --config hook_profile=standard
```

若要固定 release，可在最後附加版本，例如 `claude plugin install dhpk@dhpk@v0.6.0`。
可用 stack／版本以 `manifests/module-catalog.json`（SSOT）為準，整理好的 bundle
位於 `manifests/install-profiles.json`。Docker 前置條件請看
[`docs/docker-setup.zh-TW.md`](./docker-setup.zh-TW.md)。

安裝後可隨時重新設定：

```text
/dhpk:setup           # 重新回答相同問題
/dhpk:setup --show    # 顯示目前有效設定
```

### Path B — Local clone + interactive installer

需要在 Claude 外的 shell 執行 wizard，或正在修改 plugin source 時使用。
這是便利／開發路徑，不是第二個 release channel。**必須先 `git clone`**，因為
installer 位於 repository 內。

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh        # interactive (gum / python3 fallback)
```

未選 stack module 時，installer 使用目前選定的 common 預設集合。[平台安裝
SSOT](./platform-installation.zh-TW.md)負責目前 Host 安裝／更新／移除指令與
receipt 行為；本指南保留 local-clone 作為開發入口。

請使用以下 source gate 驗證 local checkout：

```bash
node scripts/ci/validate-plugin.js
node scripts/ci/validate-skills.js --strict
```

這些指令只驗證 repository source，不代表 official consumer。Claude marketplace 指向
`generated/claude-marketplace/package` 這個實體 package；它在進入 marketplace cache 前排除
development-only 的 root `CLAUDE.md`。請用以下指令確認生成物沒有 drift：

```bash
node scripts/ci/gen-claude-marketplace-package.js --check
```

Claude CLI 可用時，release consumer gate 會驗證 staged package；如果
`claude plugin list --json` 回傳 `installPath`，也會再執行
`claude plugin validate <installed>/.claude-plugin/plugin.json --strict` 驗證 installed cache。
installed-cache 檢查的 official non-zero 結果會阻擋完成；若 CLI 沒有回傳 `installPath`，會記錄
`NOT RUN` 警告並回傳 `FAIL`，阻擋完成，不得宣稱 official PASS。CLI 不可用時同樣記錄
`NOT RUN`，不要宣稱 official PASS。

若要在 plugin 開發時直接使用 working tree、避免反覆 reinstall，請看
[§ 開發](#開發)。

### 更新／移除

```bash
# user scope 安裝（CLI 預設）
claude plugin update -y dhpk@dhpk
# project scope 安裝
claude plugin update --scope project -y dhpk@dhpk
claude plugin uninstall dhpk@dhpk      # 移除 plugin
claude plugin marketplace remove dhpk  # 移除 marketplace 設定
```

請使用安裝 plugin 時相同的 scope。更新指令預設使用 user scope，因此
project scope 安裝必須加上 `--scope project`；在非 TTY 或 CI 環境請使用
`-y`／`--yes` 跳過確認提示。

在 Claude Code 內也可使用 `/plugin update dhpk@dhpk`、`/plugin uninstall dhpk@dhpk`、
`/plugin marketplace remove dhpk`。

使用支援的 Codex projection 時，先更新 Claude，再重新整理 project-local 檔案。
`CLAUDE_PLUGIN_ROOT` 只在 Claude Code plugin runtime（hooks、commands、Bash tools）內
自動 export；普通 terminal 請明確指定持久 checkout，例如 `DHPK_ROOT=/absolute/path/to/dhpk`，
不要把 ephemeral marketplace cache path 寫進 project command。

```bash
claude plugin update -y dhpk@dhpk
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --update
```

若 project 有舊版 Codex receipt 或未加 dhpk prefix 的 skill directory，先明確 migrate：

```bash
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh" --migrate --update
```

`--migrate` 只接管 legacy source 完全相符且 receipt-owned、未修改的 destination。
User-owned、已編輯、retargeted、格式錯誤或 ambiguous 的 entry 會保留並報告。
`--force` 只略過 project-root heuristic，不會繞過 ownership、collision、symlink、
containment 或 modified-file safety。`--uninstall` 只移除 receipt-owned 且未修改的 entry。
完整 rename／merge／rollback 請看 [`skill-platform-migration.zh-TW.md`](./skill-platform-migration.zh-TW.md)。

要移除兩個 surface，依相反順序執行：plugin root 還在時，先在每個 project 以
`--uninstall` 移除 Codex projection，再執行 `claude plugin uninstall dhpk@dhpk`，最後
視需要移除 marketplace。這也適用於 copy mode。

### 安裝疑難排解

| 症狀 | 常見原因 | 修正 |
|---|---|---|
| `marketplace add` 說找不到 path | Path B 忽略了 `git clone` | 先執行 `git clone https://github.com/hmj1026/dhpk ~/projects/dhpk`，或改用不需 clone 的 Path A |
| `claude plugin install dhpk@dhpk` 說找不到 marketplace | `marketplace add` 未執行或已移除 | 重做所選 path 的 `marketplace add` |
| 安裝後沒有 `/dhpk:*` 或 hooks | session 在安裝完成前已載入 skill list | Claude Code 內執行 `/reload-plugins` 或重啟 session |
| `claude plugin list` 有 dhpk 但沒有 `/dhpk:setup` | plugin 已安裝但 disabled | `claude plugin enable dhpk@dhpk`（或 `/plugin enable dhpk@dhpk`） |
| `install.sh` 顯示找不到 `gum`／`jq` | 可選 UI dependency 缺少 | script 會 fallback 到 plain shell／`python3`；需要較好介面時再安裝 `gum`、`jq` |
| skill description 在 `/doctor` 被截斷或消失 | modules 太多造成 skill-listing budget overflow（module skill 不論 `modules` 都會列出，[#12](https://github.com/hmj1026/dhpk/issues/12)） | 提高 `settings.json` 的 `skillListingBudgetFraction`（約 1% 可改 `0.02`–`0.03`），或減少 modules |
| version advisory 要更新 `.claude/dhpk-versions.json`，但它是 symlink | Write tool 不接受 symlink target | 執行 `realpath .claude/dhpk-versions.json`，把驗證後 entry 寫入 real path；`scripts/version-diff.sh` 也會印出安全指示 |

## 常見工作流

dhpk 為日常開發提供單一安全的前門與結構化的交付出口：

```text
inspect → verify surface → route → plan/classify → implement → review → verify → handoff
```

當知道目標但尚未決定調度哪項能力時，Claude 使用 `/dhpk:flow-guide`，Codex 使用 `$flow-guide`，Cursor 使用對應的本地指令。明確已知特定任務時，可直接呼叫專案技能或 slash 指令。

快速查閱清單可參考：[技能與 Slash Command 快速速查（非專業版）](./skill-command-cheat-sheet.zh-TW.md)。

### 標準五步開發工作流

日常開發請遵循以下 5 步標準推進節奏，每一步均有明確的輸入、執行指令與完成門禁（Completion Criteria）：

#### 步驟一：確認環境與安裝狀態
- **操作**：
  - 執行 `/dhpk:flow-guide help`（Codex: `$flow-guide help`）列出所有註冊的可用技能與指令。
  - 執行 `/dhpk:setup --show` 檢查當前啟用的技術棧模組（如 PHP、Laravel、JS、Python 等）與 Hook 配置。
- **完成標準**：確認環境 active modules 與當前專案需求相符，無需額外調整配置。

#### 步驟二：任務諮詢、探索與路由
- **操作**：
  - **流程諮詢**：不確定指令或作法時，直接提問：
    ```text
    /dhpk:flow-guide route 實作使用者密碼重設郵件通知
    /dhpk:flow-guide route 排查使用者登入驗證碼逾時問題
    ```
    加上 `--go` 旗標（如 `/dhpk:flow-guide route --go <task>`）可對 `implicit-eligible` 目標自動觸發一次有界交接；若目標為 `explicit-only` 則僅顯示建議語法，不自動執行。
  - **程式碼探索與根因排查**：面對陌生模組、歷史變更或 Bug 時，使用唯讀診斷：
    ```text
    /dhpk:code-trace --mode explore <模組或類別名稱>       # 探索符號、呼叫鏈與架構
    /dhpk:code-trace --mode diagnose <錯誤訊息或異常現象>    # 收集可證偽的失敗證據
    /dhpk:code-trace --mode history <函式或檔案>          # 比對 Git 演進與破壞性原因
    ```
- **完成標準**：產出明確的責任歸屬與任務邊界，或確定一項有證據支持的可證偽根因；不在此步驟修改程式碼。

#### 步驟三：規格確認後實作與 TDD
- **操作**：
  - 當驗收條件、OpenSpec change 或修復方案確認後，呼叫實作入口：
    ```text
    /dhpk:flow-drive <confirmed-spec-or-change-id>
    ```
  - **測試驅動開發（TDD）**：使用 `tdd-workflow`（或由 `tdd-guide` subagent 引導）推進 RED → GREEN → REFACTOR。先寫可觀察行為的失敗測試（RED），以最小代碼通過測試（GREEN），再進行重構。
- **實作決策與調度規範（Co-located Rules）**：
  - **決策前置狀態**：開始實作前必須具備明確狀態標記：`CLEAR`、`REASONER_REQUIRED`、`HUMAN_REQUIRED` 或 `BLOCKED`。若涉及領域邊界應先諮詢 `architect`；仍有不確定性時取得唯讀 Reasoner 結果後才允許 Writer 介入。
  - **OpenSpec 生命週期**：跨 session 或複雜大型工作，應先以 `/opsx:new` 建立 `openspec/changes/<id>/` artifacts。實作完成必須滿足所有 Task 核選、通過適用驗證門禁、解決 Review 意見，才能執行歸檔（Archive）；測試通過或 Plan 批准不等於歸檔憑證。
  - **Planner 諮詢範疇**：`--plan` 可搭配 `--plan-mode=bounded`（限制最多 4 次直接讀取且無子代理）或 `--plan-mode=discovery`（最多 12 次讀取與 2 個子代理）。未指定時預設 `auto`，在無 Material Risk Signal 且依據充足時自動採 bounded。
  - **Worker 調度邊界**：`orchestration_dispatch=on`（預設）時，雙檔案以下明確任務可留在 inline；大型機械化變更指定 `--worker=<claude|codex|agy>`。
  - **Codex CLI 整合**：dhpk 預設不啟用 Codex。使用 `--worker=codex` 走 CLI 機械 Worker；`--reasoner=codex-cli/<model>[:<effort>]` 走獨立推理；`--second-opinion=codex-exec` 取得單次盲審意見。缺少執行檔時回報可選後端不可用，不繞過安全檢查。
- **完成標準**：所有變更均具備聚焦驗證（Focused Verification）與綠燈測試證據；不遺留未說明的測試跳過。

#### 步驟四：變更審查與品質門禁
- **操作**：
  - **即時專業審查**：修改代碼後，依變更檔案路徑自動分派對應領域 Reviewer：
    ```text
    /dhpk:review-pending                              # 審查當前所有修改中檔案
    /dhpk:review-pending --files="app/Models/User.php" # 審查指定檔案清單
    ```
  - **獨立品質裁決**：以唯讀方式評審代碼規範、安全漏洞、測試覆蓋或變更風險：
    ```text
    /dhpk:change-verdict --mode code                  # 程式碼品質與架構規格
    /dhpk:change-verdict --mode security              # OWASP 與敏感資料審計
    /dhpk:change-verdict --mode tests --ac-trace      # 驗收條件與測試對齊
    /dhpk:change-verdict --mode risk                  # 變更爆炸半徑與破壞性風險
    ```
  - **提交前驗證管線**：
    ```text
    /dhpk:precommit --fast                            # 本機快速檢查（靜態分析 + 單元測試）
    /dhpk:precommit                                   # 完整管線（lint:fix -> build -> test:unit）
    /dhpk:verify                                      # 專案跨層完整驗證（含整合與 E2E）
    ```
- **門禁與交付順序**：
  - Review 發現之 CRITICAL 問題必須在交付前修復。
  - 交付順序固定為：全數 Task 與門禁通過 → 歸檔/同步 OpenSpec → 加入 Changelog 碎片 → 開啟 Draft PR（目標 `develop`）→ 以 `gh run watch` 監看 CI 執行至完成 → 人工 Merge Gate。
  - 交接紀錄必須誠實標註 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN` 或 `UNAVAILABLE`，不得將未執行標記為通過。
- **完成標準**：無任何 CRITICAL 阻礙，Precommit 全綠，所有審查意見與門禁狀態皆有憑證。

#### 步驟五：分組提交、PR 與上線
- **操作**：
  - **智慧分組提交**：按凝聚度（Cohesion）將改動分群，產生符合專案風格的 Commit 訊息與 Git 指令：
    ```text
    /dhpk:smart-commit
    /dhpk:smart-commit --scope resources/assets/js --type refactor
    ```
  - **建立 Pull Request**：自動提取 Ticket 編號並組裝 PR 摘要：
    ```text
    /dhpk:create-pr                                   # 乾跑預覽（--dry-run 預設）
    /dhpk:create-pr --execute                         # 正式建立 PR（目標為 develop）
    ```
  - **發布與部署清單**：
    ```text
    /dhpk:create-release                              # 升版、更新 Changelog 與 Tag
    dhpk-deploy-list --tag="[RELEASE-1.0.0]" --description="上線摘要" --lang=zh-TW
    ```
- **完成標準**：Git working tree 乾淨無殘留，PR 建立成功且 CI 檢查全數通過。

### 獨立協助工作流

除上述主工作流外，特定情境可直接調用獨立代理人：
- **E2E 測試流程**：`/dhpk:flow-guide route write E2E tests`，交由 `e2e-runner` 負責，僅撰寫 spec、helper、fixture 與 artifact；若遭遇 application failure 則回傳修復規格交由 Worker 處理。
- **文件同步更新**：架構異動時由 `doc-updater` 依證據同步 codemap 與使用文件。
- **OpenSpec 長任務狀態接續**：使用 `/dhpk:opsx-apply-resume [<change-id>]`，在 Token 耗盡前快照現場，並在新 Session 中接續推進。<a id="6-unattended-openspec-session-large-uncertainty-on-ramp"></a>

---

### 核心工作流技能參數詳解與範例

以下詳細說明標準五步工作流中各核心技能的所有可用參數、型別與預設值、邊界限制與實戰範例：

#### 1. flow-guide（工作流諮詢、路由與政策導引）

- **定位**：唯讀的工作流程顧問與路由中心。負責導航、策略查詢、狀態檢查與有界交接。不具備修改代碼或執行 explicit-only 命令的權限。
- **呼叫語法**：`/dhpk:flow-guide <action> [--go] [<query>]`（Codex: `$flow-guide <action> [--go] [<query>]`）
- **參數說明**：
  | 參數 | 類型 / 選項 | 必填 | 說明 |
  |---|---|---|---|
  | `<action>` | `help` \| `route` \| `rules` \| `next` \| `close` | 是 | 欲執行的單一動作（五選一）。 |
  | `help` | 子指令 | — | 查詢技能目錄；若附加技能名稱（如 `help flow-drive`）則顯示單一技能用法卡片。 |
  | `route` | 子指令 | — | 依據自然語言需求匹配最佳技能或工作流。 |
  | `rules` | 子指令 | — | 查詢當前階段的政策指引、Pre-plan 清單或交付標準。 |
  | `next` | 子指令 | — | 根據當前工作目錄、Git 分支與狀態，建議下一步行動。 |
  | `close` | 子指令 | — | 收尾門禁檢查：核對改動檔案、測試證據、Review 狀態與風險。 |
  | `[--go]` | 布林旗標 | 否 | 僅在 `route` 動作生效。若目標為可隱式執行（implicit-eligible），自動進行一次有界交接；若為 explicit-only 目標則僅提示語法。 |
  | `[query]` | 字串 | 否 | 欲諮詢的任務描述、錯誤現象、或特定技能名稱。 |
- **實戰範例**：
  ```text
  # 查詢特定技能的參數說明卡片
  /dhpk:flow-guide help flow-drive

  # 諮詢新任務的最佳流程（純建議，不執行下游）
  /dhpk:flow-guide route 實作使用者密碼重設郵件通知

  # 諮詢並自動交接給可隱式執行的目標（如直接轉交排查）
  /dhpk:flow-guide route --go 排查使用者登入驗證碼逾時問題

  # 查詢當前工作階段的建議下一步
  /dhpk:flow-guide next

  # 在準備提交或結案前進行全面門禁審核
  /dhpk:flow-guide close
  ```

#### 2. flow-drive（已確認規格實作入口）

- **定位**：明確實作（explicit-only）入口，負責執行驗收邊界已確認的變更。不選路由、不草擬提案、不跳過測試。
- **呼叫語法**：`/dhpk:flow-drive <confirmed-spec-or-change-id> [options]`（Codex: `$flow-drive ...`）
- **參數說明**：
  | 參數 | 類型 / 選項 | 預設值 | 說明 |
  |---|---|---|---|
  | `<confirmed-spec-or-change-id>` | 字串 | （必填） | 已確認的規格名稱或 OpenSpec Change ID（例如 `auth-oauth2-flow`）。 |
  | `--plan[=<model>:<effort>]` | 字串（可選值） | 無 | 在實作前啟動 Planner 進行審查；可選指定模型與強度（例如 `opus:xhigh`、`sonnet:high`）。 |
  | `--plan-mode=<mode>` | `auto` \| `bounded` \| `discovery` | `auto` | Planner 審查範圍（需搭配 `--plan`）。`bounded` 嚴格限制最多 4 次讀取且無子代理；`discovery` 允許深入探索。 |
  | `--worker=<worker>` | `claude` \| `codex` \| `agy` \| `auto` | `auto` | 指定本次變更實作的 Worker 類型（通常使用當前模型）。 |
  | `--worker-target=<target>` | `<provider>/<model>[:<effort>]` | 無 | 明確指定 Worker 的供應商與模型目標（例如 `anthropic/claude-3-7-sonnet`）。 |
  | `--cross-provider` | 布林旗標 | 關閉 | 在 `--worker=auto` 時允許考慮外部跨供應商候選（如 Codex），不影響明確指定的 target。 |
  | `--reasoner=<target>` | `<provider>/<model>[:<effort>]` | 無 | 請求外部獨立 Reasoner 進行唯讀架構或複雜決策審查（例如 `codex-cli/gpt-6.1-sol:high`）。 |
  | `--architect` / `--no-architect` | 布林旗標 | 依政策 | 控制本次實作是否強制執行架構層面審查。 |
- **實戰範例**：
  ```text
  # 最簡實作：以當前環境實作已確認的 change
  /dhpk:flow-drive change-add-user-avatar

  # 包含限定範圍（Bounded）的 Planner 審查
  /dhpk:flow-drive change-add-user-avatar --plan --plan-mode=bounded

  # 使用高強度模型進行規劃並指定 Worker
  /dhpk:flow-drive payment-webhook-retry --plan=opus:xhigh --worker=claude

  # 包含外部 CLI Reasoner 第二意見與架構審查
  /dhpk:flow-drive refactor-auth-tokens --architect --reasoner=codex-cli/gpt-6.1-sol:high
  ```

#### 3. code-trace（程式碼追蹤、根因診斷與工具選取）

- **定位**：唯讀的代碼探索與診斷工具。追查呼叫鏈、重現失敗、回溯 Git 變更，或挑選最佳代碼導航工具。
- **呼叫語法**：`/dhpk:code-trace [--mode <mode>] [options] <target>`
- **參數說明**：
  | 參數 | 類型 / 選項 | 預設值 | 說明 |
  |---|---|---|---|
  | `--mode <mode>` | `explore` \| `diagnose` \| `history` \| `select-tool` | 自動推斷 | 追蹤模式。`explore`（探索符號/流程）、`diagnose`（排查 Bug/回歸）、`history`（Git 演進）、`select-tool`（工具挑選）。 |
  | `--depth <depth>` | `brief` \| `normal` \| `deep` | `normal` | 報告詳盡程度。 |
  | `--dual` | 布林旗標 | 關閉 | 派發兩個完全隔離的獨立探索視角，最後交叉比對共識與分歧。 |
  | `--explain` | 布林旗標 | 關閉 | 針對探索目標輸出逐步的白話解釋與資料流說明。 |
  | `<target>` | 字串 | （必填） | 符號名稱、類別、檔案路徑、錯誤訊息或異常現象描述。 |
- **實戰範例**：
  ```text
  # 深度探索認證流程架構
  /dhpk:code-trace --mode explore --depth deep "App\Services\AuthManager"

  # 雙視角獨立探索複雜的訂單狀態機
  /dhpk:code-trace --mode explore --dual "OrderStateMachine"

  # 排查具體 Bug 根因與重現條件
  /dhpk:code-trace --mode diagnose "OAuth2 redirect loop on Safari"

  # 調查特定函式近期變更歷史與破壞性原因
  /dhpk:code-trace --mode history "UserController::updateProfile"

  # 查詢當前操作的最佳導航工具路徑（cx vs gitnexus vs grep）
  /dhpk:code-trace --mode select-tool "Find all callers of PaymentGateway::charge"
  ```

#### 4. change-verdict（變更審查與多維度品質裁決）

- **定位**：唯讀的品質審查技能，從代碼標準、安全、測試覆蓋、文件一致性與變更風險等多個面向輸出獨立裁決（`READY`、`BLOCKED` 或 `INCONCLUSIVE`）。
- **呼叫語法**：`/dhpk:change-verdict --mode <mode> [options] [scope]`
- **參數說明**：
  | 參數 | 類型 / 選項 | 預設值 | 說明 |
  |---|---|---|---|
  | `--mode <mode>` | `code` \| `pr` \| `security` \| `tests` \| `docs` \| `risk` | （必填） | 審查維度。`code`（代碼規範/規格）、`pr`（PR 衛生度）、`security`（OWASP 安全）、`tests`（測試覆蓋）、`docs`（文件一致）、`risk`（變更爆炸半徑）。 |
  | `--ac-trace` | 布林旗標 | 關閉 | 僅用於 `tests` 模式。將驗收條件逐條追蹤對應到具體測試案例與運行結果。 |
  | `--second-opinion=codex-exec` | 字串 | 無 | 請求外部獨立的 Codex CLI 執行盲審第二意見，並將其結果隔離呈現。 |
  | `[scope]` | Git commit / branch / 檔案列表 | 當前未提交變更 | 審查範圍（例如 `HEAD~1..HEAD`、`main..feature` 或 `app/Models/`）。 |
- **實戰範例**：
  ```text
  # 審查當前所有未提交代碼修改是否符合標準
  /dhpk:change-verdict --mode code

  # 對特定分支差異進行 OWASP 安全漏洞審計
  /dhpk:change-verdict --mode security origin/main..HEAD

  # 驗收條件逐條對齊測試覆蓋率
  /dhpk:change-verdict --mode tests --ac-trace

  # 評估當前修改的破壞性變更風險與爆炸半徑
  /dhpk:change-verdict --mode risk

  # 審查文件與實作的一致性
  /dhpk:change-verdict --mode docs docs/basic-operations.md
  ```

#### 5. review-pending（待審變更即時派工）

- **定位**：自動比對當前工作目錄變更，依據檔案副檔名與路徑派遣對應領域專業 Reviewer（代碼、資料庫、安全、前端等）。
- **呼叫語法**：`/dhpk:review-pending [--files=<rel-paths>]`
- **參數說明**：
  | 參數 | 類型 | 預設值 | 說明 |
  |---|---|---|---|
  | `--files=<rel-paths>` | 逗號分隔字串 | `git diff HEAD --name-only` | 限定審查的相對檔案路徑清單。省略時自動審查所有修改中檔案。 |
- **實戰範例**：
  ```text
  # 審查所有當前修改中（Staged + Unstaged）的檔案
  /dhpk:review-pending

  # 僅針對特定受影響檔案派發審查
  /dhpk:review-pending --files="app/Models/User.php,routes/api.php"
  ```

#### 6. tdd-workflow（測試驅動開發工作流）

- **定位**：引導嚴格遵循 RED → GREEN → REFACTOR 的行為驅動開發流程，拒絕無效的套套邏輯測試（Tautological Tests）。
- **呼叫語法**：`/dhpk:tdd-workflow <mode> [target]`
- **參數說明**：
  | 參數 | 類型 / 選項 | 必填 | 說明 |
  |---|---|---|---|
  | `<mode>` | `standard` \| `test-generation` \| `fast-worker` | 是 | 執行模式。 |
  | `standard` | 模式 | — | 標準 TDD 流程。依序推進 RED（失敗測試）→ GREEN（最小通過代碼）→ REFACTOR（重構）。 |
  | `test-generation` | 模式 | — | 針對現有生產代碼接縫，生成以可觀察行為為核心的最小測試骨架。 |
  | `fast-worker` | 模式 | — | 由已確認的 RED 規格或 Task 描述，交由 Worker 進行機械式的 GREEN 實作。 |
  | `[target]` | 字串 | 否 | 目標檔案、函式或功能接縫名稱。 |
- **實戰範例**：
  ```text
  # 啟動標準 TDD 流程實作新行為
  /dhpk:tdd-workflow standard "使用者輸入錯誤密碼三次後鎖定帳號 15 分鐘"

  # 針對現有 API Controller 產生可觀察行為的測試骨架
  /dhpk:tdd-workflow test-generation "app/Http/Controllers/Api/OrderController.php"

  # 機械化完成 GREEN 測試通過階段
  /dhpk:tdd-workflow fast-worker "tests/Unit/DiscountCalculatorTest.php"
  ```

#### 7. precommit（提交前品質驗證管線）

- **定位**：封裝確定性的提交前品質檢查管線，自動依專案生態系執行 Lint 修復、編譯建置與單元測試。
- **呼叫語法**：`/dhpk:precommit [--fast]`
- **參數說明**：
  | 參數 | 類型 | 說明 |
  |---|---|---|
  | `--fast` | 布林旗標 | 快速模式。僅執行快速靜態檢查與單元測試，跳過耗時的大型建置與整合檢查。省略時執行完整管線（`lint:fix -> build -> test:unit`）。 |
- **實戰範例**：
  ```text
  # 執行日常快速提交前檢查
  /dhpk:precommit --fast

  # 執行完整嚴格驗證管線
  /dhpk:precommit
  ```

#### 8. repo-verify / /dhpk:verify（專案完整驗證）

- **定位**：唯讀執行專案各層級的完整驗證（Lint、型別、單元測試、整合測試、E2E）。
- **呼叫語法**：`/dhpk:verify [<mode>] [--integration=<path>] [--e2e=<path>]`（Codex: `$repo-verify ...`）
- **參數說明**：
  | 參數 | 類型 / 選項 | 預設值 | 說明 |
  |---|---|---|---|
  | `<mode>` | `fast` \| `full` | `full` | 驗證模式。`fast`（Lint + 單元測試）；`full`（Lint + Typecheck + Unit + Integration + E2E）。 |
  | `--integration=<path>` | 字串 | 無 | 指定自訂的整合測試路徑。 |
  | `--e2e=<path>` | 字串 | 無 | 指定自訂的端到端（E2E）測試路徑。 |
- **實戰範例**：
  ```text
  # 執行全庫完整驗證
  /dhpk:verify

  # 僅執行快速驗證
  /dhpk:verify fast

  # 執行完整驗證並指定自訂測試目錄
  /dhpk:verify full --integration=tests/Integration --e2e=tests/E2E
  ```

#### 9. smart-commit（智慧分組原子提交）

- **定位**：分析未提交檔案，按凝聚度（Cohesion）智慧分組，依 Conventional Commits 風格生成 Commit 訊息，輸出可複製執行的 Git 指令。
- **呼叫語法**：`/dhpk:smart-commit [--scope <path>] [--type <type>] [--ai-co-author]`
- **參數說明**：
  | 參數 | 類型 | 說明 |
  |---|---|---|
  | `--scope <path>` | 路徑字串 | 限定只提交特定路徑下的修改。 |
  | `--type <type>` | 字串 | 強制指定提交類型（如 `feat`、`fix`、`refactor`、`docs`、`test`、`chore`）。 |
  | `--ai-co-author` | 布林旗標 | 在 Commit 訊息末端附上 AI 協作者 Trailer（`Co-authored-by`）。 |
- **實戰範例**：
  ```text
  # 智慧分析所有變更並分組提交
  /dhpk:smart-commit

  # 僅提交前端相關目錄，並強制標註為 refactor
  /dhpk:smart-commit --scope resources/assets/js --type refactor

  # 提交並加入 AI 協作者標記
  /dhpk:smart-commit --ai-co-author
  ```

#### 10. create-pr（建立 Pull Request）

- **定位**：自動從當前分支與 Commit 歷程提取 Ticket 編號，生成符合專案風格的 PR 標題與說明本文。
- **呼叫語法**：`/dhpk:create-pr [--head=<branch>] [--base=<branch>] [--title=<text>] [--execute] [--dry-run]`
- **參數說明**：
  | 參數 | 類型 | 預設值 | 說明 |
  |---|---|---|---|
  | `--dry-run` | 布林旗標 | 啟用 | 僅輸出建議的 `gh pr create` 指令預覽，不執行修改。 |
  | `--execute` | 布林旗標 | 關閉 | 實際執行 `gh pr create` 並回傳建立成功的 PR 網址。 |
  | `--head=<branch>` | 字串 | 當前分支 | 來源分支。 |
  | `--base=<branch>` | 字串 | `develop` 或 `main` | 目標分支（預設為專案設定的 Target Branch）。 |
  | `--title=<text>` | 字串 | 自動產生 | 自訂 PR 標題（覆寫自動產生的 Ticket 格式標題）。 |
- **實戰範例**：
  ```text
  # 預覽 PR 標題與內文（乾跑模式）
  /dhpk:create-pr

  # 正式執行建立目標為 develop 的 PR
  /dhpk:create-pr --execute

  # 指定目標分支並自訂標題
  /dhpk:create-pr --base=main --title="feat: [PROJ-890] 重構訂單支付處理管線" --execute
  ```

#### 11. dhpk-deploy-list（跨技術棧部署清單產生器）

- **定位**：從 Git 歷史中萃取發布清單，過濾測試與 CI 檔案，依技術棧 Preset（Yii、Laravel、Node、Python 等）分群輸出確定性的上線檔案檢查清單。
- **呼叫語法**：`dhpk-deploy-list --tag <[TAG]> --description "<text>" [options]`
- **參數說明**：
  | 參數 | 類型 | 必填 | 說明 |
  |---|---|---|---|
  | `--tag <[TAG]>` | 字串 | 是 | 發布標籤元資料（格式必須為中括號，如 `[PROD-20261006]`）。 |
  | `--description "<text>"` | 字串 | 是 | 發布簡要說明。 |
  | `--deploy-commits <shas>` | 逗號分隔字串 | 否 | 指定 Commit SHA 清單，將其 Diff 作為主要部署群組。 |
  | `--anchor "<string>"` | 字串 | 否 | 以程式碼內的標記字串搜尋異動檔案（與 `--deploy-commits` 互斥）。 |
  | `--base <ref>` / `--head <ref>` | Git ref | 否 | 比對的 Git 範圍（預設 `main..HEAD`）。 |
  | `--preset <preset>` | 字串 | 否 | 指定技術棧規則（`php-yii`、`laravel`、`node`、`python`、`generic`）。 |
  | `--lang <zh-TW\|en>` | 字串 | 否 | 輸出語言（預設 `en`）。 |
  | `--auto-detect-tag` | 布林旗標 | 否 | 在 Commit 訊息中自動搜尋標籤並填入 `--deploy-commits`。 |
- **實戰範例**：
  ```text
  # 產生常規上線清單（以當前分支比對 main）
  dhpk-deploy-list --tag="[RELEASE-1.4.0]" --description="會員中心資料改版" --lang=zh-TW

  # 指定特定上線 Commits
  dhpk-deploy-list --tag="[HOTFIX-20261006]" --description="修正結帳計算浮點數精度" --deploy-commits="a1b2c3d,e4f5a6b" --lang=zh-TW
  ```

#### 12. opsx-apply-resume（長任務跨 Context 狀態保存與接續）

- **定位**：在長時間大型 OpenSpec 任務接近 Token 上限時保存現場快照，或在開啟新 Session 後恢復執行進度與門禁證據。
- **呼叫語法**：`/dhpk:opsx-apply-resume [<change-id>]`
- **參數說明**：
  | 參數 | 類型 | 說明 |
  |---|---|---|
  | `<change-id>` | 字串（可選） | 目標 OpenSpec Change 名稱。若省略，自動偵測最近一次進行中的 Change。 |
- **實戰範例**：
  ```text
  # 在當前 Session 上下文耗盡前執行儲存
  /dhpk:opsx-apply-resume change-refactor-auth-v2

  # 在新 Session 中接續未完任務
  /dhpk:opsx-apply-resume
  ```

## 同步 Codex CLI 內容

同時使用 Claude Code 與 Codex CLI 的 project：

以下 `${CLAUDE_PLUGIN_ROOT}` 形式適用於 Claude Code plugin-runtime shell；普通 terminal 請使用
[更新／移除](#更新移除) 中的 persistent-checkout 形式。

```bash
# From any project root and a persistent local dhpk checkout:
DHPK_ROOT=/absolute/path/to/dhpk
bash "$DHPK_ROOT/scripts/hooks/install-codex-skills.sh"
```

在 Claude plugin-runtime shell 內可用 `${CLAUDE_PLUGIN_ROOT}` 作為等價 root。普通 terminal
必須明確設定 `DHPK_ROOT`；不要把 ephemeral marketplace-cache path 複製到 project command。

此 script 是支援的 Codex distribution path，預設採 hybrid，另有整體實體化 fallback：

- **`--copy`（portable supported fallback）**：將 `.codex/` managed entry 全部實體化。project 可能搬移、
  archive 或離開 plugin source tree 時建議使用；copy 不依賴 plugin checkout 持續存在。
- **Hybrid（預設，source-checkout dependent）**：skill 與 supporting asset 連回 plugin
  source，但 agent TOML 一律為實體檔。linked entry 重新 sync 快且會跟隨 source checkout，
  但 plugin root/cache 被搬移、
  清理或刪除就會斷。Marketplace cache 只要仍存在就可用；`--update` 可採用新的 owned plugin
  root。若 source lifetime 不保證，請使用 `--copy`。[Issue #88](https://github.com/hmj1026/dhpk/issues/88)
  曾由 source lifetime 斷裂造成。

兩種 mode 都會在 `.codex/.dhpk-installed.json` 記錄 version、source-fingerprint、per-entry
mode 與 schema-v3 managed-entry provenance；skill entry 也包含 stable inventory id 與目前 public `dhpk-*` name。
Plugin 更新後以 `--update` 重新執行。Unowned collision 會保留；`--migrate` 只重新命名
receipt-owned、未修改的 legacy destination；edited、third-party、retargeted、malformed 或
ambiguous path 仍會報告 conflict。`--uninstall` 只移除未修改且 receipt-owned 的 entry。
Codex tree 是 canonical Claude package 的 curated subset，不是第二份完整 inventory。
`codex/agents/` 有 15 個 direct role：4 個手動維護 generic role 與由 canonical Claude agent
產生的 11 個 role。雙 harness 模型請看 `codex/guidance.md` 與 `codex/README.md`。

Generated role 可能依賴共用的 prompt-defense、trap-sheet、artifact-contract
或 execution-policy。這些 support file 由 `manifests/distribution-inventory.json` 的
`supporting_assets` section mapping，複製到 `.codex/dhpk/`，並用同一份 schema-v3 receipt 追蹤。
Runtime projection validator 會拒絕 unreachable reference 或 Claude plugin-root path。

### Codex Plugin Marketplace（實驗性支援等級）

Repository 提供 Codex plugin manifest 與 marketplace wrapper，底層是 tracked、physical 的
`plugins/dhpk/` publication package，由 `manifests/distribution-inventory.json` 的明確
`codex-native` surface 產生，零 symlink。這條 route 只能使用全新的 disposable
isolated `CODEX_HOME`，且不得建立 project-local `.codex/` projection；兩個 surface
雖然分開發布／取得，runtime activation 仍互斥：

```bash
codex plugin marketplace add hmj1026/dhpk   # or a local path during development
codex plugin add dhpk@dhpk
codex plugin list
```

上述是取決於 CLI 支援的 repository command；官方 Codex 文件不是這條
dhpk-specific install route 的證明。

實驗性生命週期指令（marketplace upgrade 適用於已設定的 Git marketplace；local-path development
marketplace 請先 refresh 或重新加入 local source，再重新安裝）：

```bash
codex plugin marketplace upgrade dhpk
codex plugin remove dhpk@dhpk
codex plugin add dhpk@dhpk        # reinstall from the refreshed snapshot

# Full teardown:
codex plugin remove dhpk@dhpk
codex plugin marketplace remove dhpk
```

`codex plugin list` 只代表管理證據，不代表安裝 cache 內的檔案可運作。真正證據是由
`tests/codex-native-install-smoke.test.js` 驅動 CLI，在隔離的 `CODEX_HOME` 安裝精確的 tracked
`plugins/dhpk/` artifact，刪除 source checkout，並確認 allowlisted native skill 都成為實體
（非 symlink）檔案。Release CONSUMER gate 在有 `codex` CLI 時會執行這份證據；完整 gate model
請看 [`docs/distribution-surfaces.zh-TW.md#codex-native-plugin-package`](./distribution-surfaces.zh-TW.md#codex-native-plugin-package)，
以及 [Issue #88](https://github.com/hmj1026/dhpk/issues/88) 的原始追蹤。

安裝 proof 是必要但不充分的證據：原生 Codex marketplace support 在另外通過升級決策前仍是
**experimental**（見 [ADR-0006](./adr/0006-codex-native-publication-artifact.md)）。兩個
package 分開發布／取得，但 runtime activation 互斥。Production 工作請使用
`install-codex-skills.sh` 作為 canonical project-local sync route，不要在同一個 host
啟用 native package。

若 native plugin 已啟用而要採用 project-local sync，請手動執行
`codex plugin remove dhpk@dhpk`，再啟動新的 Codex session。Installer 會在
install、update、migrate 與 plan 前查詢 `codex plugin list --json`：若明確回報
native plugin 已 enabled，會在寫入前阻擋，`--force` 不能繞過；`--uninstall` 仍可用。
若 query 缺少或不受支援，結果回報 `providerCheck: UNAVAILABLE`，sync 可繼續；installer
不會自動移除 global plugin。不要刪除整個 `.codex/` 目錄。

細節請看 `.codex-plugin/README.md` 與 `plugins/dhpk/README.md`。

## 遷移現有專案

如果 project 已有自己的 `.claude/` harness，以下是 legacy hook 相容性遷移計畫；
新的 review 工作使用上方所述的建議性 reviewer trigger table：

1. **Phase A — baseline**：先保存安裝前 hook output 與測試結果。
2. **Phase B — install (parallel)**：設定 `userConfig.review_agents` 指向既有 agent 後安裝 plugin，兩組 hook 並行。
3. **Phase C — discovery**：確認 `/agents` 與 `/plugin details dhpk@dhpk` 顯示預期元件。
4. **Phase D — hook parity**：比較 plugin-side safety hook 與 project-side hook，記錄預期差異；不要新增 legacy sentinel route。
5. **Phase E — cutover**：透過 `.claude/settings.local.json`（`"hooks": {}`）停用 project hook，執行 regression test。
6. **Phase F — cleanup**：刪除 plugin 已提供的 project file，保留 project-specific override。

每個 phase 都有 rollback gate。刪除任何檔案前先建立 `pre-dhpk-migration` tag。

## 開發

若要直接迭代 plugin source（不走 install/reinstall loop），對 working tree 啟動 Claude Code：

```bash
git clone https://github.com/hmj1026/dhpk ~/projects/dhpk
claude --plugin-dir ~/projects/dhpk
```

修改 plugin file 後，hooks、MCP、LSP 可用 `/reload-plugins` 套用；monitor 與 skill listing
則需要重啟 session。

Marketplace install path（`claude plugin install`）會將 plugin 複製到
`~/.claude/plugins/cache/`；source repository 的修改要等到
`claude plugin update -y dhpk@dhpk` 才會反映（project scope 安裝則使用加上
`--scope project` 的對應指令）。

### npm script 快速指令

Root `package.json` 為 private、零 dependency，提供兩類指令。

**套件安裝者（`bin`）**：可透過 `npx` 或全域安裝後使用：

| 指令 | 用途 |
|------|------|
| `dhpk-install <claude\|cursor\|codex-sync\|agy-plugin> <plan\|status\|verify>` | 規劃、查詢或驗證安裝面 |
| `dhpk harness ...` | Harness facade |
| `dhpk distribution <surface> <generate\|preview\|validate\|verify>` | 分發套件操作 |

**開發者（clone 後在 repo 內 `npm run`）**：

| 分類 | 指令 | 執行內容 |
|------|------|----------|
| 安裝 | `npm run setup` | 互動式安裝（`scripts/install.sh`） |
| | `npm run setup:dry-run` | 非互動式安裝 dry run |
| | `npm run setup:status` | `dhpk-install claude status --scope user` |
| | `npm run dhpk-install -- <surface> <action>` | `scripts/dhpk-install.js` |
| 測試 | `npm test` | 完整測試（`tests/run-all.js`） |
| | `npm run test:hooks` | Hook 測試 |
| | `npm run test:one -- tests/<name>.test.js` | 單一測試檔 |
| 驗證 | `npm run validate` | 所有 CI validator（`validate:*`） |
| | `npm run check:generated` | 產生的 manifest、marketplace、skill resource、package drift 檢查 |
| | `npm run check:portability` | 可攜性檢查 |
| | `npm run catalog:check` | `catalog.js --check all` |
| | `npm run ci` | `validate` + `check:generated` + `catalog:check` + `test` |
| 產生（會寫檔） | `npm run gen:all` | 先 `catalog:write`，再 `gen:manifest`、`gen:marketplace`、`gen:codex-agents` |

注意事項：
- `catalog:write` 必須先於其他 generator；`gen:all` 已維持此順序。
- 未定義任何 npm lifecycle script（`install`、`postinstall`、`prepare` 等），安裝套件不會執行開發者腳本。
- 發版腳本與 `gen-distribution-inventory.js --write` 刻意不提供，請手動執行。
- `package.json` 的版本納入 release version lockstep。
