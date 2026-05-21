---
name: multi-ai-sync
description: "Compare and synchronize Claude-first agent configuration across Codex, Gemini, and Antigravity (.agent). Generate read-only plans, create OpenSpec tasks, apply safe sync changes with dry-run preview and writable-path fallback, and validate post-sync results. Use when aligning `.claude` skills, commands, hooks, agents, or orchestration rules to other AI platforms, when comparing multi-platform agent setup drift, or when preparing a Claude-to-Codex/Gemini/.agent migration. Also matches requests such as `sync claude to codex`, `align multi-platform AI config`, `同步 claude 技能到 codex`, or `對齊多 AI 設定`. Not for single-platform edits, reverse sync, or missing `.claude` source."
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

若 Preflight 失敗，先回報阻塞（原因/已嘗試/下一步），不要直接進 Step 1。

### Step 1: 產生差異計畫（只讀）

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py plan --format markdown
```

輸出會包含：
- Coverage summary
- Mapping matrix
- Migration candidates (`adapted`)
- Skip register (`skip-incompatible`)
- 證據來源 URL

若要機器可讀格式：

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py plan --format json --output /tmp/multi-ai-sync-plan.json
```

### Step 2: 審核後生成 OpenSpec tasks

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py openspec-tasks \
  --plan /tmp/multi-ai-sync-plan.json \
  --change-name claude-sync-YYYY-MM-DD \
  --output openspec/changes/claude-sync-YYYY-MM-DD/tasks.md
```

只會把 `adapted` 項目轉成待執行任務；`skip-incompatible` 會保留在註記區。

### Step 3: 套用同步

先 dry-run，再實際套用：

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py apply \
  --plan /tmp/multi-ai-sync-plan.json \
  --dry-run \
  --format markdown \
  --output /tmp/multi-ai-sync-apply-dryrun.md
```

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py apply \
  --plan /tmp/multi-ai-sync-plan.json \
  --format markdown \
  --update-tasks openspec/changes/claude-sync-YYYY-MM-DD/tasks.md \
  --manual-draft-output artifacts/multi-ai-sync-manual-draft-YYYY-MM-DD.md \
  --output artifacts/multi-ai-sync-apply-YYYY-MM-DD.md
```

`apply` 預設策略：
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

### Step 4: 最後驗證 Gate（必要）

```bash
python3 -B .codex/skills/multi-ai-sync/scripts/multi_ai_sync.py validate --format markdown
```

Gate 檢查：
- 設定可載入（config/frontmatter/toml/json 基礎解析）
- 平台 smoke 檢查
- hooks 代表案例
- multi-agent 代表案例

Gate 判讀：
- `PASS`：Config+Smoke 全 OK，代表案例無 FAIL/SKIP
- `PARTIAL`：Config+Smoke 全 OK，但代表案例有 SKIP（含 skip-incompatible）
- `FAIL`：任一 Config/Smoke FAIL，或代表案例 FAIL

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
- `apply_sync.py`: v1 legacy，已棄用
- `mapping.py` / `sources.py` / `validation.py` / `constants.py` / `utils.py`: 內部模組

## 何時停止並回報

- 找不到主來源 (`.claude`) 或結構不完整
- 目標平台資料結構異常（無法安全判定）
- 官方文件與 Context7 訊息衝突且無法裁決

回報格式包含：阻塞原因、已嘗試、下一步建議。
