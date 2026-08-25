# 基本操作

> **語言**： [English](./basic-operations.md) · **繁體中文**

本頁說明 dhpk 的操作生命週期：安裝、日常指令流程、自動 Review 週期，以及
如何將既有專案遷移到 dhpk。Codex/Cursor 的安裝、狀態與回滾細節請看
[平台安裝 SSOT](./platform-installation.zh-TW.md)；完整的 `userConfig` 旋鈕請看
[`docs/configuration.zh-TW.md`](./configuration.zh-TW.md)。

## 決策階梯

新請求依序執行：**檢查** repository 與 session 狀態 → **確認** 已安裝的
surface → **選擇** Claude、支援的 Codex sync 或實驗性的原生 Codex surface →
透過 `/dhpk:do` 或明確 skill **路由** → 以 TDD 與編輯前 impact check
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

## 分發面政策

dhpk 刻意提供多個不同支援等級的 surface：

| Surface | 等級 | 意義 |
|---|---|---|
| Claude marketplace | Supported | 主要 consumer 安裝與更新路徑。 |
| `claude --plugin-dir` | Development-only | Working-tree 迭代，不是 release channel。 |
| `scripts/install.sh` | Convenience wrapper | 執行 Claude 安裝契約，不是另一個分發管道。 |
| `install-codex-skills.sh` | Supported | 穩定的 Codex project sync 路徑。 |
| `install-cursor-harness.sh` | Supported | 穩定的 Cursor project-local sync 路徑（`.cursor/`）。 |
| Codex plugin marketplace | Experimental | 有真實 CLI 安裝證據的實體 publication package；在另一次升級決策前維持 Experimental。 |
| Antigravity / AGY sync | Adapter/package | Antigravity 使用 `.agent` mapping；AGY 使用原生 plugin package 與 validator。 |

Plugin 管理指令（`claude plugin …`、`codex plugin …`）與 skill invocation 分開。
Claude workflow 從 `/dhpk:do` 或明確 skill 進入；Codex 使用 project-local `.codex/`
projection；Cursor project-local 檔案由 `install-cursor-harness.sh` 安裝到 `.cursor/`。

## 安裝

dhpk 遵循標準的 [Claude Code plugin distribution model](https://docs.claude.com/en/docs/claude-code/plugins)：
同一個 marketplace + manifest 提供兩個 surface，請選擇適合自己的方式：

- **Terminal** — `claude plugin marketplace add …` / `claude plugin install …`
- **Claude Code session 內** — `/plugin marketplace add …` / `/plugin install …`
  （或互動式 `/plugin` browser）

兩個 surface 都讀取本 repository 的 `.claude-plugin/marketplace.json`，結果相同。

### Path A — GitHub（推薦）

不需要 clone，適合一般使用者。

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

腳本會引導 stack／版本、Docker 前置條件、review-agent override 與 hook profile，
最後替你執行 `claude plugin install`。加上 `--dry-run` 可只印出解析後的安裝指令。

隨時驗證 local checkout：

```bash
claude plugin validate ~/projects/dhpk --strict
```

`node scripts/ci/validate-plugin.js` 與 `node scripts/ci/validate-skills.js --strict`
是快速 source gate，不代表官方 consumer。Claude CLI 可用時，保留
`claude plugin validate <manifest> --strict` 及其 exit code 作為官方證據；CLI 不可用時
記錄 `NOT RUN`，不要宣稱 official PASS。Release consumer gate 會將非零官方結果視為
blocking，並驗證 consumer-shaped staged package（開發用 root `CLAUDE.md` 不屬於 shipped
plugin surface）。

若要在 plugin 開發時直接使用 working tree、避免反覆 reinstall，請看
[§ 開發](#開發)。

### 更新／移除

```bash
claude plugin update dhpk@dhpk         # 從 marketplace 取得最新版本
claude plugin uninstall dhpk@dhpk      # 移除 plugin
claude plugin marketplace remove dhpk  # 移除 marketplace 設定
```

在 Claude Code 內也可使用 `/plugin update dhpk@dhpk`、`/plugin uninstall dhpk@dhpk`、
`/plugin marketplace remove dhpk`。

使用支援的 Codex projection 時，先更新 Claude，再重新整理 project-local 檔案。
`CLAUDE_PLUGIN_ROOT` 只在 Claude Code plugin runtime（hooks、commands、Bash tools）內
自動 export；普通 terminal 請明確指定持久 checkout，例如 `DHPK_ROOT=/absolute/path/to/dhpk`，
不要把 ephemeral marketplace cache path 寫進 project command。

```bash
claude plugin update dhpk@dhpk
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

使用者工作流只有一個安全 front door，以及幾個明確的出口：

```text
inspect → verify surface → route → plan/classify → implement → review → verify → handoff
```

當你知道成果但不知道要用哪個 skill，使用 `/dhpk:do`；已知道完整流程時，使用
明確 command 或 skill。Plugin 管理（`claude plugin …`、`codex plugin …`）只安裝／
更新 surface，不會呼叫 workflow。

### 選擇入口

| 需求 | 入口 | 完成訊號 |
|---|---|---|
| 只看會執行什麼 | `/dhpk:do --route-only <task>` | `Route only: /...`（或 bounded classification／task prompt）；不執行 downstream。 |
| 功能、Bug、重構或大型變更 | `/dhpk:do <task>` | 一個 workflow classification 與一個命名的下一個 route。 |
| 檢查程式或 execution flow | `/dhpk:do trace the <area> flow` 或 `dhpk-codebase-exploration` | 有檔案／symbol 引用的證據說明。 |
| Review 既有修改 | `/dhpk:review-pending` 或 `/dhpk:dhpk-change-review` | Reviewer verdict 加上新鮮 artifact，或明確 blocker。 |
| Commit、PR 或 release | `/dhpk:smart-commit`、`/dhpk:create-pr` 或 `/dhpk:dhpk-release-creator` | 明確的 command 結果；不會自動 commit、push 或 merge。 |

`/dhpk:do` 可以呼叫 `implicit-eligible` target。若路由選到 `explicit-only` target，
會印出確切的直接 invocation 後停止；route confidence 不能越過 target 的 invocation
class。Route table 是 deterministic fast path；ambiguous compound request 會使用有界
classification，不會猜測。

### 執行前先檢查路由

```text
/dhpk:do --route-only implement a password-reset email flow
/dhpk:do --route-only fix the login redirect loop
```

`--route-only` 會在 matching 前移除自己與支援的 mode flags。使用者看到的 deterministic
match 是 `Route only: /<skill> (<label>).`；bounded classification 則是
`Route only: /<chosen> because <reason>.`，空輸入會要求 task description。底層 route
helper 另外提供 validator 使用的 machine-readable `MATCH<TAB>skill<TAB>label`、
`NO_MATCH` 與 `NO_QUERY`。兩種形式都不會呼叫 OpenSpec、planner、architect、worker 或選定的 skill。

### 主要交付流程——功能與 Bug

```text
/dhpk:do implement a password-reset email flow
/dhpk:do fix the login redirect loop
```

Adaptive workflow 會先 classification，再載入分支所需 context。Feature work 進入
TDD RED → GREEN → REFACTOR；Bug work 記錄 root-cause evidence，並在修正前建立
regression-test RED gate。Repository 提供 GitNexus 時，既有 symbol 會先做 pre-edit
impact analysis；`cx` 的 overview／definition／references 是主要 navigation fallback。

只有在本次 invocation 改變決策時才加入 modifier：

| Modifier | 效果與邊界 |
|---|---|
| `--plan[=<model>[:<effort>]]` | 只在 implementation-class route 加入 planner critique；authoring route 由 `--openspec` 優先。 |
| `--openspec` / `--opsx` | 將 feature／bug authoring route 送到外部 OpenSpec artifact creation，然後停在人類 Review；其他 route 會忽略。 |
| `--worker=<claude\|codex\|agy\|auto>` | 只選本次 invocation 的 mechanical worker；優先序為 flag → `fast_worker_backend` → shipped `claude`，不會持久化設定。 |
| `--reasoner=<claude\|codex>[:<model>[:<effort>]]` | 為 implementation-class route 選 reasoning backend；其他 route 會明確訊息後忽略。 |
| `--codex` | 在支援的 workflow 啟用 session 的 Codex peer path；它與 worker selector 不同。 |

`--worker=codex` 是選 Codex CLI mechanical worker；`CODEX=on` 則加入獨立 Codex MCP
peer，供高風險 reasoning／Review 使用。只有選定 executable 缺少時才允許 configured
Claude fallback；authentication、task、execution 與 verification failure 都維持 blocked。

### OpenSpec 生命週期邊界

不明確或跨 session 的工作先記錄 wayfinder checkpoint，再用 `/opsx:new` 或 `/opsx:ff`
建立 `openspec/changes/<change-id>/` artifacts。通過 Planning Review Gate 後，以
`$dhpk:openspec-apply-change <change>` 或 repository 的外部 OpenSpec apply entry 實作。
Plan、validator 通過或全綠測試都不是 archive evidence。完成仍需 task checkbox、適用的
verification gate、Review obligation 與 human-only action 都已解決；archive、issue closure
與 release publication 仍是分開的步驟。

### Review、驗證與交接

每次 Edit／Write／MultiEdit 後，default hooks 只建立適用的 `.pending-*` review sentinel
並保持 review debt 可見，不會默默執行 formatter、lint、lockfile 或 Stop advisory script。
`/dhpk:review-pending` 可立即啟動 pending reviewer；`sentinel_commit_gate` 決定 open
sentinel 對 commit 是 warn 或 block。

```text
/dhpk:review-pending
/dhpk:precommit
/dhpk:verify
/dhpk:smart-commit
/dhpk:create-pr
```

每次 handoff 都要只報一個下一步 command、涵蓋的 files／evidence，以及任何 `BLOCKED`、
`NOT_RUN`、`UNAVAILABLE` 或 `NO_SHIP`。Release 或 consumer 結果必須將 structural／package
證據與 live runtime proof 分開；請看 [`docs/harness-workflow.md`](./harness-workflow.md)。

### 明確的長時間 OpenSpec session

只有既有 change 需要產生有界、可貼上的 `/goal` session 時才使用：

```text
/dhpk:dhpk-opsx-apply-goal my-change-id --max-duration 2h
```

`<change-id>` 是 `openspec/changes/` 下的 directory name，不是自由文字。
`--turns N`、`--max-duration`、`--min-coverage`、`--codex`、`--smoke`、`--no-smoke` 與
`--dry-run` 都可約束產生的 session。turn／time limit 會寫 `.resume-note.md`；human-only
work 標為 `[blocked: <reason>]`；hard-rule conflict 會以 file:line evidence 寫入
`.hard-rule-escalation.md`。Generated goal 保留 selector-resolved worker、適用的 specialist
reviewer 與 completion gate，不會為了約 4,000 UTF-8-byte 的 paste ceiling 而刪除必要 gate。

### 獨立協助工作流

```text
/dhpk:spec-mine user-authentication
/dhpk:do write E2E tests for the checkout flow
/dhpk:harness-audit
/dhpk:harness-govern
/dhpk:harness-govern --fix
```

`spec-mine` 將 brownfield behavioral spec 寫入 `openspec/specs/`。E2E 工作由 `e2e-runner`
負責，只能寫 spec、helper、fixture 與 artifact；application failure 會回傳 worker-ready
fix spec。Harness audit 是 read-only；govern 只有在加上 `--fix` 時才會修改。Structural change
也會路由 `doc-updater` 更新 codemap 與使用者文件。

### Implementation dispatch

`orchestration_dispatch=on`（預設）時，reasoning-heavy work 交給 `deep-reasoner`；mechanical
work 透過 shared selector 交給 `fast-worker`、`codex-fast-worker` 或 `agy-fast-worker`。
最多兩個檔案且 specification 清楚的 implementation step 可留在 inline；更大的明確批次
使用一個指定的 worker scope。TDD 負責 RED 與 scoped verification；phase 結束執行完整的
適用 suite。完整 dispatch 與 reviewer batching 規則在
[`rules/execution-policy.md`](../rules/execution-policy.md)。

### Codex 雙助理協作

dhpk **預設不使用 Codex**。`CODEX=on` 會在高風險 implementation decision 與支援的 Review
skill 加入 blind independent Codex peer。Direct Codex-delegation skill
（`dhpk-codex-architect`（含 `--mode adversarial`）、`dhpk-codex-implement`、`dhpk-change-review`）
不需 `/dhpk:do` 也可直接呼叫。MCP backend 需要 `mcp__codex__codex`／
`mcp__codex__codex-reply`；可選 CLI backend 只需要 `codex` executable。設定與 failure boundary
在 [`docs/configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕`](./configuration.zh-TW.md#codex-mcp-依賴並非-userconfig-旋鈕)。

這與下方的 Codex CLI content sync 不同；後者只是將 curated projection mirror 到 `.codex/`，
不需要 MCP server。

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

此 script 是支援的 Codex distribution path，有兩種 mode：

- **`--copy`（portable supported fallback）**：在 `.codex/` 產生實體檔案。project 可能搬移、
  archive 或離開 plugin source tree 時建議使用；copy 不依賴 plugin checkout 持續存在。
- **Symlink（預設，source-checkout dependent）**：將 `.codex/` entry 連回 plugin 的
  `codex/skills/` tree。重新 sync 快且會跟隨 source checkout，但 plugin root/cache 被搬移、
  清理或刪除就會斷。Marketplace cache 只要仍存在就可用；`--update` 可採用新的 owned plugin
  root。若 source lifetime 不保證，請使用 `--copy`。[Issue #88](https://github.com/hmj1026/dhpk/issues/88)
  曾由 source lifetime 斷裂造成。

兩種 mode 都會在 `.codex/.dhpk-installed.json` 記錄 version、source-fingerprint 與 schema-v3
managed-entry provenance；skill entry 也包含 stable inventory id 與目前 public `dhpk-*` name。
Plugin 更新後以 `--update` 重新執行。Unowned collision 會保留；`--migrate` 只重新命名
receipt-owned、未修改的 legacy destination；edited、third-party、retargeted、malformed 或
ambiguous path 仍會報告 conflict。`--uninstall` 只移除未修改且 receipt-owned 的 entry。
Codex tree 是 canonical Claude package 的 curated subset，不是第二份完整 inventory。
`codex/agents/` 有 16 個 direct role：4 個手動維護 generic role 與由 canonical Claude agent
產生的 12 個 role。雙 harness 模型請看 `codex/AGENTS.md` 與 `codex/README.md`。

Generated role 可能依賴共用的 prompt-defense、trap-sheet、reviewer-contract、artifact-contract
或 execution-policy。這些 support file 由 `manifests/distribution-inventory.json` 的
`supporting_assets` section mapping，複製到 `.codex/dhpk/`，並用同一份 schema-v3 receipt 追蹤。
Runtime projection validator 會拒絕 unreachable reference 或 Claude plugin-root path。

### Codex Plugin Marketplace（實驗性支援等級）

Repository 提供 Codex plugin manifest 與 marketplace wrapper，底層是 tracked、physical 的
`plugins/dhpk/` publication package，由 `manifests/distribution-inventory.json` 的明確
`codex-native` surface 產生，零 symlink：

```bash
codex plugin marketplace add hmj1026/dhpk   # or a local path during development
codex plugin add dhpk@dhpk
codex plugin list
```

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
**experimental**（見 [ADR-0006](./adr/0006-codex-native-publication-artifact.md)）。Production
工作請使用 `install-codex-skills.sh`；marketplace package 是 additive，不取代支援的
project-local sync path。

細節請看 `.codex-plugin/README.md` 與 `plugins/dhpk/README.md`。

## 遷移現有專案

如果 project 已有自己的 `.claude/` harness，請依分階段計畫：

1. **Phase A — baseline**：先保存安裝前 hook output 與測試結果。
2. **Phase B — install (parallel)**：設定 `userConfig.review_agents` 指向既有 agent 後安裝 plugin，兩組 hook 並行。
3. **Phase C — discovery**：確認 `/agents` 與 `/plugin details dhpk@dhpk` 顯示預期元件。
4. **Phase D — hook parity**：比較 plugin-side sentinel 與 project-side sentinel，記錄預期差異。
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
`claude plugin update dhpk@dhpk` 才會反映。
