# dhpk — Claude Code 開發 Harness 插件套件

> **語言**: [English](./README.md) · **繁體中文**

通用、安裝即用的 Claude Code harness。內含 **15 個角色導向 agent**、約 75 個指令（codex / openspec / gitnexus / git / 專案工作流）、約 60 個核心 skill 加上跨專案的 `deploy-list` 部署清單產生器、**5-slot sentinel 驅動的 review hook**（code / db / sec / frontend / doc）、statusline、harness 腳本，以及**四個可選用的技術棧模組**（`php-5.6`、`yii-1.1`、`phpunit-5.7`、`js`）。模組可透過 **wrapper-dispatch** 模型在 runtime 提供 hook（詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)）。內附平行的 Codex CLI 樹，適用於雙助理（Claude + Codex）專案。

## 前置需求

| 工具 | 狀態 | 用途 |
|------|------|------|
| `bash` | 必要 | 所有 hook 與輔助腳本 |
| `git` | 必要 | Sentinel／artifact 路徑解析；`git rev-parse --show-toplevel` |
| `python3` | 啟用 `modules` 時為必要 | 在 `post-edit-remind` 與 `session-start` 中解析 `module.yaml` |
| `jq` | 選用（有 python3 後援） | 較快的 JSON payload 擷取 |
| `docker` | 選用 | 僅在 `userConfig.docker_containers` 非空時會被使用 |
| Codex MCP server | 選用 | 僅在你使用 14 個 `codex-*` skill 時才需要（需另行安裝） |
| Codex CLI 執行檔 | 選用 | 僅在執行 `install-codex-skills.sh` 且希望 Codex 真正載入同步內容時才需要 |

缺少選用工具會以優雅退化處理（腳本 no-op 或跳過該功能）。缺少必要工具則會在 SessionStart 或第一個 hook 觸發時以單行 `[hook-name] WARN: …` 寫到 stderr，方便你採取行動。

## 安裝

### 互動式（推薦）

依序帶你選技術棧／版本、設定 docker 前置條件、覆寫 review agent、選 hook profile，最後幫你執行 `claude plugin install`。

```bash
claude plugin marketplace add ~/projects/dhpk
bash ~/projects/dhpk/scripts/install.sh
```

加 `--dry-run` 只印出組好的 `claude plugin install …` 指令，不實際執行。

安裝後，可隨時在 Claude Code 內重新設定：

```
/dhpk:setup           # 重跑同一份問答
/dhpk:setup --show    # 印出目前生效設定
```

### 手動／非互動

如果你已經知道要填什麼：

```bash
claude plugin marketplace add ~/projects/dhpk
claude plugin install dhpk@dhpk
# 或帶選項
claude plugin install dhpk@dhpk \
  --plugin-option modules=php-5.6,yii-1.1,phpunit-5.7 \
  --plugin-option docker_containers=php-fpm,mysql \
  --plugin-option hook_profile=standard
```

可用的技術棧／版本列在 `manifests/module-catalog.json`（SSOT）。精選組合在 `manifests/install-profiles.json`。Docker 前置須知請見 [`docs/docker-setup.md`](./docs/docker-setup.md)。

任何時候都可以驗證 manifest：

```bash
claude plugin validate ~/projects/dhpk --strict
```

插件開發請見 [§ 開發](#開發)。

## 你會得到什麼

| 元件 | 數量 | 說明 |
|------|----:|------|
| Agents | 15 | 14 個可呼叫 + 1 份 `INDEX.md`。其中 5 個為 sentinel 驅動的 reviewer（code / db / sec / **frontend** / **doc**），其餘為情境型（architect、tdd-guide、refactor-cleaner、ui-ux-verifier、performance-analyzer、doc-updater、docs-lookup、harness-reviser、harness-optimizer） |
| Commands | ~75 | `dhpk:opsx:*`、`dhpk:codex-*`、`dhpk:review-pending`、`dhpk:smart-commit`、`dhpk:ts-check-status`（JS 模組）等 |
| 核心 skills | ~60 加上 | openspec-*、codex-*、gitnexus、tool-routing、dhpk-execution-policy、**deploy-list**（跨專案部署清單產生器）、**execution-checklist**（任務收尾自檢） |
| 技術棧模組 | 4 | `php-5.6`、`yii-1.1`、`phpunit-5.7`、`js`（選用；詳見下方「模組」） |
| Hooks | 5 個事件 | PreToolUse（Edit、Bash + dispatcher）、PostToolUse（Edit + dispatcher + async crlf-fix）、SessionStart、Stop（stop-review-reminder + reap-stale-sentinels） |
| Hook dispatcher | 2 | `post-edit-dispatch.sh`、`pre-bash-dispatch.sh` — 分派到啟用模組的 hook |
| Harness 腳本 | 5 | precommit-runner、verify-runner、harness-audit、codemap generator、dep-audit |
| Codex 雙軌 | 24 skills + 5 agents | 由 `install-codex-skills.sh` 同步進專案的 `.codex/` |

## userConfig

九個旋鈕，全部可在安裝時用 `--plugin-option <key>=<value>` 設定：

| Key | 預設值 | 用途 |
|-----|--------|------|
| `hook_profile` | `standard` | `minimal` 抑制 Stop 提醒；`strict` 增加額外警告 |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer","frontend-reviewer","doc-reviewer"]` | 被 sentinel 提醒呼叫的 5 個 agent。可覆寫指向你專案特定的 agent；傳入較短的清單會縮減覆蓋範圍。 |
| `docker_containers` | `[]` | 在 SessionStart 檢查的 container 名稱。空陣列代表停用該檢查。第一筆會輸出為 `DHPK_PHP_CONTAINER`；第二筆為 `DHPK_MYSQL_CONTAINER`。 |
| `modules` | `[]` | 要啟用的技術棧模組。內附：`php-5.6`、`yii-1.1`、`phpunit-5.7`、`js`。模組的 `requires:` 在 SessionStart 驗證（僅警告、不阻擋）。 |
| `review_trigger_extra_paths` | `[]` | 每個 reviewer slot 的額外路徑前綴。格式：`<slot>:<prefix>`，slot 屬於 `code\|db\|sec\|fe\|doc`。例：`code:protected/`、`fe:resources/views/`。 |
| `reap_stale_mcp_processes` | `false` | 設 `true` 時，SessionStart 會 reap 舊的 `gitnexus mcp` process（只留最新）。僅 gitnexus MCP 使用者需要。 |
| `js_lint_script` | `"lint"` | `js` 模組 pre-commit gate 執行的 npm script 名稱。 |
| `js_typecheck_script` | `"typecheck"` | `js` 模組 pre-commit gate 執行的 npm script 名稱。 |
| `js_check_path` | `"js/"` | `/ts-check-status` 掃描 `// @ts-check` 推進度時的路徑。 |

範例：

```bash
# 以預設值純安裝（5-slot 預設 agent 名稱）。
claude plugin install dhpk@dhpk

# PHP/Yii + JS 全端專案。
claude plugin install dhpk@dhpk \
  --plugin-option modules=php-5.6,yii-1.1,phpunit-5.7,js \
  --plugin-option docker_containers=php-fpm,mysql \
  --plugin-option review_agents=code-reviewer-myproj,db-reviewer-myproj,sec-reviewer-myproj,fe-reviewer-myproj,doc-reviewer-myproj
```

精選的模組組合請見 `manifests/install-profiles.json`。

## 需要 MCP 依賴的 skill

14 個 skill 需要 **Codex MCP server**（`mcp__codex__codex`、`mcp__codex__codex-reply`）：

```
codex-architect       codex-brainstorm     codex-cli-review
codex-code-review     codex-explain        codex-implement
codex-review-doc      codex-review         codex-review-branch
codex-review-fast     codex-security       codex-test-gen
codex-test-review     codex-test-review
```

未安裝 Codex 時，呼叫上述任一 skill 會出現工具權限錯誤。請另行安裝（請參考 Anthropic 的 Codex 文件），安裝後即可使用。

其他 skill（約 50 個）沒有 MCP 依賴。

## 模組

**模組**是有標籤、有版本號的 skill + 參考資料 + hook + trigger 貢獻組合，由 `userConfig.modules` 控管啟用。v0.2.0 內附：

- **`php-5.6`** — PHP 5.6 語言基線。禁止 7.0+ 語法；提供 polyfill 指引。
- **`yii-1.1`** — Yii 1.1 框架：alias autoload、`CActiveRecord` / `CDbCriteria`、`accessRules`、XSS / CSRF 預設。需要 `php-5.6`。
- **`phpunit-5.7`** — PHPUnit 5.7 assertion API 與用法。需要 `php-5.6`。
- **`js`** — JS / TS 工具鏈。ESLint flat-config 分層策略（Tier 1 嚴格 / 1.5 core-exempt / 1.7 deferred-migration / globals）、per-leaf `// @ts-check` 漸進啟用、async post-edit ESLint 反饋、pre-commit `npm run <lint> + <typecheck>` gate。框架無關。

啟用後，模組會：
- 將其 skill 以 `dhpk:<skill-name>` 形式暴露（例如 `dhpk:php-pro`、`dhpk:yii1-security-audit`、`dhpk:js-lint-config`）。
- 為 `post-edit-remind` 貢獻路徑觸發規則，讓 reviewer 在框架特定路徑上觸發。
- 可在 `modules/<m>/hooks/post-edit-*.sh` 與 `modules/<m>/hooks/pre-{bash,commit}-*.sh` 提供 hook，模組啟用時由 dispatcher 分派執行。詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)。
- 在 SessionStart 印出一行模組啟用訊息，讓 Claude 知道該模組已生效。

### 新增模組

```bash
mkdir -p modules/<stack>-<version>/{skills,references}
cat > modules/<stack>-<version>/module.yaml <<'EOF'
name: <stack>-<version>
display_name: "..."
version: 0.1.0
description: "..."
requires: []
triggers:
  code: { extensions: [], paths: [] }
  db:   { extensions: [], paths: [] }
  sec:  { extensions: [], paths: [] }
provides:
  skills: []
EOF
```

至少新增一個 `modules/<stack>-<version>/skills/<name>/SKILL.md`。接著在 `.claude-plugin/plugin.json` 註冊路徑：

```json
"skills": [..., "./modules/<stack>-<version>/skills/"]
```

在 manifest 中 bump 插件 `version`。執行 `claude plugin validate ~/projects/dhpk --strict`。並在本 README 中說明新模組。

每模組獨立的 hook 自 v0.2.0 起透過 wrapper-dispatch 模型支援。把腳本放在 `modules/<stack>-<version>/hooks/`：

- `post-edit-*.sh` — 由 `scripts/hooks/post-edit-dispatch.sh` 在模組啟用時（背景）執行。
- `pre-bash-*.sh` / `pre-commit-*.sh` — 由 `scripts/hooks/pre-bash-dispatch.sh` 同步執行（可阻擋）。

Dispatcher 契約與 `js` 模組的完整範例詳見 [`docs/hook-extension.md`](./docs/hook-extension.md)。

### 模組參考資料中的外部路徑佔位符

模組 `references/*.md` 可能包含專案特定的路徑佔位符：

- `<framework-source>` — 框架原始碼本機 checkout（例如 Yii framework）。
- `<project-root>` — 你的專案根目錄。
- `<container-workdir>` — docker container 內的 `-w` 工作目錄。
- `<docker-bind-mount>` — bind-mount 進 container 的主機路徑。

當你在專案筆記中引用模組內容時，請替換掉這些佔位符。

## 接上 statusline

插件規格本身沒有 statusline 元件，請在專案的 `.claude/settings.json` 中手動加入：

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/statusline/statusline.sh"
  }
}
```

Statusline 會渲染 `[branch] +staged ~modified | docker:status | profile=<p> | mod=<active> | ⚠ <pending-sentinels>`，並退回到全域 `~/.claude/statusline.sh` 取得 token/模型/rate-limit 行。

## 同步 Codex CLI 內容

同時使用 Claude Code 與 Codex CLI 的專案：

```bash
# 在任意專案根目錄執行：
bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/install-codex-skills.sh"
```

預設以 symlink（或用 `--copy` 複製）把插件的 `codex/{skills,agents}` 連到專案的 `.codex/`。具冪等性 — 插件版本 bump 後可用 `--update` 重跑。雙 harness 模型詳見 `codex/AGENTS.md` 與 `codex/README.md`。

## 遷移現有專案

若專案已有自己的 `.claude/` harness，請依分階段計畫進行：

1. **階段 A — baseline**：快照安裝前的 hook 輸出與測試結果。
2. **階段 B — 並行安裝**：以 `userConfig.review_agents` 指向專案既有 agent 安裝插件。兩套 hook 並行觸發。
3. **階段 C — 探索**：確認 `/agents` 與 `/plugin details dhpk` 顯示預期的元件。
4. **階段 D — hook 對齊**：比對插件側 sentinel 與專案側差異。記錄所有預期內的差異。
5. **階段 E — 切換**：透過 `.claude/settings.local.json`（`"hooks": {}`）停用專案內建 hook；跑回歸測試。
6. **階段 F — 清理**：刪除已由插件提供的專案內檔案；保留專案特定的覆寫。

每個階段都有 rollback gate。刪除任何東西前，先 tag `pre-dhpk-migration`。

## 儲存庫結構

```
dhpk/
├── .claude-plugin/
│   ├── marketplace.json          # 單一條目的 marketplace（plugins[0].source: "./"）
│   └── plugin.json               # 含 userConfig 的插件 manifest
├── agents/                       # 13 個角色 agent（INDEX.md 為導覽用）
├── commands/                     # ~74 個 slash 指令，含 opsx/
│   └── opsx/                     # 10 個 OpenSpec workflow 包裝
├── skills/                       # ~59 個核心 skill（openspec-*、codex-*、tool-routing、dhpk-execution-policy 等）
├── modules/                      # 可選用的技術棧模組
│   ├── php-5.6/{module.yaml, skills/, references/}
│   ├── yii-1.1/...
│   ├── phpunit-5.7/...
│   └── js/{module.yaml, hooks/, skills/, commands/, references/}
├── hooks/hooks.json              # PreToolUse / PostToolUse / SessionStart / Stop 連線設定
├── scripts/
│   ├── hooks/                    # 核心 hook，含 post-edit-dispatch.sh、pre-bash-dispatch.sh、reap-stale-sentinels.sh、_lib/{payload,portable-sed}.sh
│   ├── statusline/statusline.sh
│   ├── codemaps/、lib/、opsx-apply-resume/、validate/
│   └── （harness-audit、precommit-runner、verify-runner、gemini-adapt-agents、dep-audit）
├── docs/
│   ├── hook-extension.md         # wrapper-dispatch 契約 + 模組 hook 撰寫指南
│   ├── recommended-permissions.md
│   ├── docker-setup.md、subagent-prompt-template.md
├── codex/                        # Codex CLI 雙軌（Claude Code 不會自動載入）
│   ├── AGENTS.md                 # Codex 專屬指引
│   ├── README.md                 # 如何同步進專案
│   ├── skills/、agents/、config.toml.example
├── manifests/install-profiles.json  # 精選模組組合
├── openspec/                     # 本 repo 自身的 OpenSpec config + changes
├── README.md、README.zh-TW.md、CHANGELOG.md、LICENSE、.gitignore
```

## 開發

要迭代插件本身，請用 `--plugin-dir` 就地載入：

```bash
claude --plugin-dir ~/projects/dhpk
```

對插件檔案的編輯，需要 `/reload-plugins` 後才會生效（hook、MCP、LSP），或重啟 session（monitor、skill 列表）。

Marketplace 安裝路徑（`claude plugin install`）會把插件複製到 `~/.claude/plugins/cache/`，所以對原始 repo 的編輯在那裡不會生效，必須 `claude plugin update dhpk` 才會更新。

## 授權

採用 [MIT License](./LICENSE) 釋出。Copyright (c) 2026 Paul.
