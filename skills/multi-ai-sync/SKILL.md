---
name: multi-ai-sync
description: 'Compare and synchronize Claude-first agent configuration across Codex, Gemini, and Antigravity (.agent). Includes a pre-sync compliance gate (harness-adapter-compliance.js, 60% threshold) and post-sync Gemini frontmatter translation (gemini-adapt-agents.js). Generate read-only plans, create OpenSpec tasks, apply safe sync changes with dry-run preview and writable-path fallback, and validate post-sync results. Use when aligning `.claude` skills, commands, hooks, agents, or orchestration rules to other AI platforms, when comparing multi-platform agent setup drift, or when preparing a Claude-to-Codex/Gemini/.agent migration. Also matches requests such as `sync claude to codex`, `align multi-platform AI config`, `同步 claude 技能到 codex`, or `對齊多 AI 設定`. Not for single-platform edits, reverse sync, or missing `.claude` source.'
---

# Multi AI Sync (Claude First)

以 `Claude` 為主來源，對齊到 `Codex`、`Gemini`、`Antigravity(.agent)`。

## When NOT to Use

- 反向同步（以 Codex/Gemini 為來源覆寫 Claude）→ 此技能僅支援 Claude-first
- 單一平台內的檔案編輯或格式調整（不涉及跨平台對齊）
- 只修改單個 command/skill 而非全局對齊
- `.claude` 主來源目錄不存在或結構不完整

## 核心規則

1. `Claude` 有的功能項目都必須進入檢查矩陣。
2. 目標平台無對應能力：標記 `skip-incompatible`，不得硬套。
3. 目標平台有近似能力：依目標平台規範移植（優先 Context7，官方文件為最終裁決）。
4. 先出計畫供審核，核准後才生成與執行 tasks。
5. 最後必跑 `Post-Sync Validation Gate`（Smoke + 代表流程）。

## 能力範圍

- `skills`
- `commands/workflows`
- `agents/config`
- `hooks`
- `multi-agents`（含 `agent-definitions`（`.claude/agents/`）與 `orchestration-rules`（`.claude/rules/`），需人工審核）

## 執行流程

### Step 0: Preflight（必要）

```bash
# 0-1. 確認主來源可讀（含 symlink）
test -e .claude && test -e CLAUDE.md

# 0-2. 檢查主要目標路徑可寫性（避免執行中途才失敗）
test -w .gemini && test -w .agent

# 0-3. Codex skills 路徑若不可寫，apply 會自動 fallback
test -w .codex/skills || echo ".codex/skills not writable; will fallback"
```

**Output:** 明確列出三項檢查結果（✅/❌）

若 Preflight 失敗，先回報阻塞（原因/已嘗試/下一步），不要直接進 Step 1。

**重點：** 必須清楚記錄 Preflight 檢查的通過/失敗狀態。

### Phase 0: Pre-Sync Compliance Gate（必要）

在進入差異計畫前，先對 `.codex/` 與 `.gemini/` 各跑一次 compliance 評分，作為「是否值得花時間 sync」的客觀門檻。

```bash
# Score both adapter directories using the 7-dimension rubric (harness-audit.js engine).
# Default threshold is 60% of max_score.
node .claude/scripts/harness-adapter-compliance.js --target codex  --format json > /tmp/sync-codex-compliance.json
node .claude/scripts/harness-adapter-compliance.js --target gemini --format json > /tmp/sync-gemini-compliance.json
```

讀取兩支 JSON 的 `passes_threshold` 與 `score_pct`：

| 結果 | 動作 |
|---|---|
| 兩者皆 `passes_threshold: true` | 繼續 Step 1（顯示分數摘要） |
| 任一為 `false` | **halt**：印出該 target 的 `top_actions[]`、`failed_checks[]` 摘要、與「<target> compliance <score_pct>% below threshold 60%」訊息 |
| 用戶以 `--force` 觸發 | 警告 `WARNING: compliance below threshold, --force in effect` 後繼續 |

**Asset profile manifest 參考**：哪些 asset 該 sync 由 `.claude/manifests/triple-platform.json` 宣告（profile = `triple` / `claude-only` / `codex-only` / `gemini-only` / `skip-incompatible`）。Plan 階段必須讀取此 manifest，並只把 `triple` profile 列入比對。

### Step 1: 產生差異計畫（只讀）

**關鍵決定：** 先判斷使用者意圖
- **計畫模式**（plan-only）：「先給我差異計畫」、「我只想看計畫」 → 停在 Step 1，不繼續
- **完整流程**：「同步」、「幫我...同步」 → 繼續進 Step 2-4

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py plan --format markdown
```

**必須輸出：**
- Coverage summary（對齊覆蓋率統計）
- Mapping matrix（項目對應矩陣）
- Migration candidates（`adapted` 項目清單）
- Skip register（`skip-incompatible` 項目清單）
- 證據來源 URL
- **多語言混合**（中文 + English 技術術語）

若要機器可讀格式：

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py plan --format json --output /tmp/multi-ai-sync-plan.json
```

**Plan-only 模式判斷：** 如果使用者要求「只給計畫」，則執行此步後停止，不進 Step 2/3/4。

### Step 2: 審核後生成 OpenSpec tasks

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py openspec-tasks \
  --plan /tmp/multi-ai-sync-plan.json \
  --change-name claude-sync-YYYY-MM-DD \
  --output openspec/changes/claude-sync-YYYY-MM-DD/tasks.md
```

只會把 `adapted` 項目轉成待執行任務；`skip-incompatible` 會保留在註記區。

### Step 3: 套用同步

**重點：必須執行 dry-run，再執行實際套用**

#### 3-1. 執行 Dry-Run（預演）

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py apply \
  --plan /tmp/multi-ai-sync-plan.json \
  --dry-run \
  --format markdown \
  --output /tmp/multi-ai-sync-apply-dryrun.md
```

**必須輸出：** 明確記錄「dry-run 預演結果」，顯示：
- 將被修改的檔案清單
- 預期的變更內容（不實際執行）
- 潛在風險警告

#### 3-2. 執行實際套用

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py apply \
  --plan /tmp/multi-ai-sync-plan.json \
  --format markdown \
  --update-tasks openspec/changes/claude-sync-YYYY-MM-DD/tasks.md \
  --manual-draft-output artifacts/multi-ai-sync-manual-draft-YYYY-MM-DD.md \
  --output artifacts/multi-ai-sync-apply-YYYY-MM-DD.md
```

**必須輸出：** 詳細的應用報告，包含：
- 實際執行的變更摘要
- 每個 target 平台的成功/失敗狀態
- 手動審核項目的草稿

#### 套用策略

- 可自動套用：`skills`、`commands/workflows`
- 需人工審核：`agents`、`config`、`multi-agents`
- `.codex/skills` 不可寫：自動 fallback 到 `artifacts/codex-skills-fallback`（可用 `--codex-skills-fallback-roots` 覆寫）
- `--update-tasks`：依 apply 結果自動勾選 OpenSpec tasks
- `--manual-draft-output`：輸出 manual 項目的 reviewer-ready 草稿
- apply 報告會內建 target/category breakdown（便於大批量檢視）

可在同步前後跑內建自測（converter/regression）：

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py self-test --format markdown
```

建議同步後補做一個 TOML parse 檢查（Gemini commands）：

```bash
python3 - <<'PY'
import glob, tomllib
errors = []
for path in sorted(glob.glob('.gemini/commands/**/*.toml', recursive=True)):
    with open(path, 'rb') as f:
        try:
            tomllib.load(f)
        except Exception as e:
            errors.append((path, str(e)))
print("errors", len(errors))
for item in errors[:20]:
    print(item[0], item[1])
PY
```

### Phase 3.5: Post-Sync Frontmatter Translation（必要，Step 3 apply 完成後、Step 4 validate 之前）

在 sync 寫入 `.gemini/agents/` 之後、進入最後驗證 Gate 之前，自動翻譯 frontmatter 為 Gemini CLI 認識的格式。

```bash
node .claude/scripts/gemini-adapt-agents.js .gemini/agents
```

腳本行為：
- 翻譯 `tools:` 名稱（`Read → read_file`、`Edit → replace`、`Bash → run_shell_command` 等）。
- 剝除 `color:` 等不支援欄位。
- 是 idempotent：對已翻譯的檔案重跑為 no-op，stdout 報「Updated 0 agent file(s); N already compatible」。

**錯誤處理**：
- 翻譯腳本以非零 exit code 結束時（例如目錄被外部刪除），skill MUST 顯示錯誤訊息，但不視為 sync 失敗 — 已同步的 `.gemini/agents/*.md` 保留，僅 frontmatter 未翻譯。最終狀態標為「sync OK / translate FAILED」並進入 Step 4 驗證。

**Sync 報告**：apply 報告 MUST 加一行「Translated N .gemini/agents/*.md frontmatter entries」，N 來自翻譯腳本的 stdout。

### Step 4: 最後驗證 Gate（必要）

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py validate --format markdown
```

**必須輸出：** 明確的驗證結果

Gate 檢查項目：
- 設定可載入（config/frontmatter/toml/json 基礎解析）
- 平台 smoke 檢查
- hooks 代表案例
- multi-agent 代表案例

**Gate 狀態判讀：**
- `PASS`：Config+Smoke 全 OK，代表案例無 FAIL/SKIP
- `PARTIAL`：Config+Smoke 全 OK，但代表案例有 SKIP（含 skip-incompatible）
- `FAIL`：任一 Config/Smoke FAIL，或代表案例 FAIL

**回報內容：** 必須清楚陳述最終驗證狀態，附上失敗項目的摘要及建議

## Output

預期交付物（至少包含以下項目）：
- 差異計畫：`plan --format markdown/json` 產出，含 coverage、mapping、skip register、evidence URLs
- OpenSpec tasks：`openspec-tasks` 產出 `tasks.md`，僅納入 `adapted` 項目
- 套用報告：`apply` 產出 dry-run/正式報告，含 target/category breakdown 與 manual draft（若有）
- 驗證結果：`validate` 產出 Gate（`PASS | PARTIAL | FAIL`）與失敗摘要

## 決策輸出契約

每個對齊項目必須有：
- `status`: `equivalent | adapted | skip-incompatible`
- `reason`: 判斷原因
- `evidence_urls`: 來源證據
- `source_path` / `target_path`

## 參考檔案

- `references/platform-mapping.md`: 平台能力與路徑映射
- `references/capability-sources.md`: Context7 與官方文件來源
- `references/risk-policy.md`: 風險分級與審核 gate
- `references/improvement-todo.md`: 技能優化待辦與回顧（持續更新）
- `references/source-conflicts.json`: 衝突登記冊（Context7 vs 官方文件衝突時手動覆寫，初始為空 `{"entries": []}`)

## Scripts 結構

入口：`scripts/multi_ai_sync.py`，委派至 `multi_ai_sync_lib/` 子模組。
- `cli.py`: CLI 路由（plan/openspec-tasks/apply/validate/self-test）
- `apply_sync_v2.py`: 套用邏輯（active）
- `mapping.py` / `sources.py` / `validation.py` / `constants.py` / `utils.py`: 內部模組

## 何時停止並回報

- 找不到主來源 (`.claude`) 或結構不完整
- 目標平台資料結構異常（無法安全判定）
- 官方文件與 Context7 訊息衝突且無法裁決

回報格式包含：阻塞原因、已嘗試、下一步建議。
