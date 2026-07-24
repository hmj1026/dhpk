---
name: multi-ai-sync
description: "Compare Claude-first configuration across Codex, Gemini, and Antigravity. Produce reviewable plans, OpenSpec tasks, dry-run/apply reports, and PASS/PARTIAL/FAIL validation. Use when aligning cross-platform skills, commands, agents, hooks, or orchestration. Not for reverse sync, single-platform edits, or missing Claude source."
---

# Multi AI Sync (Claude First)

以 `Claude` 為 source of truth，對齊 `Codex`、`Gemini`、`Antigravity (.agent)`。

## When NOT to Use

- 反向同步，或以單一 target 覆寫 Claude。
- 單一平台內的檔案編輯或格式調整。
- 只修改一個 command/skill，而不是檢查跨平台對齊。
- `.claude` 或 `CLAUDE.md` 不存在、不可讀，或結構不完整。

## Operating Contract

1. 把 Claude source 的每個 feature 放入 mapping matrix。
2. 無穩定等價能力使用 `skip-incompatible`，不可硬套。
3. 近似能力使用 `adapted`，保留 evidence 與人工審核界線。
4. 先產生 read-only plan；核准前不得建立 tasks 或 mutation。
5. apply 前必須 dry-run；完成後必須跑 validation gate。
6. Codex agent parity 使用 canonical `agent_sync.py` / `apply_sync.py`
   helpers 產生 reviewer-ready TOML 草稿、mirror Markdown、mirrored
   references 與 sync manifest；這些 artifact 仍受 dry-run/apply/validation
   safety gates 管制。

每個 mapping 必須有 `status`、`reason`、`evidence_urls`、`source_path`、
`target_path`。Status semantics 與 risk policy 見 References。

## Workflow

### Step 0: Resolve runtime and preflight

先讀 `references/runtime-entrypoints.md`，依 harness 設定 `SYNC_CLI`；
entrypoint script 是 `multi_ai_sync.py`。若 working directory 不是 repository
root，所有 subcommand 前加 `--root <repo-root>`。

檢查並回報：source 可讀；plan-only 的缺少 target root 可標記 `WARN`；apply
必須有可寫 target 或明確 fallback；無法安全判定的 target 標記 `BLOCKED`。

**完成條件：** 每項都有 `PASS`、`WARN` 或 `BLOCKED` 及 operation。Source
`BLOCKED` 時停止；plan-only 的 target `WARN` 可進入 Step 1。

### Step 1: Smoke gate

```bash
python3 -B "$SYNC_CLI" self-test --format markdown
```

失敗時停止並列出 failing cases；此 CLI 不提供 bypass。

**完成條件：** self-test 報告 `failed: 0`。

### Step 2: Generate a read-only plan

讀 `references/execution-contract.md` 的 plan command 與 report contract，
再產生 markdown/JSON plan。Plan 必須包含 coverage、mapping、`adapted`
candidates、`skip-incompatible` register、source arbitration 與 evidence URLs。

plan-only 在輸出 plan 後停止並回報沒有 mutation；完整同步停在 approval gate。

**完成條件：** 每個 feature 有 decision contract，且已標記 plan-only 或
approval-pending。

### Step 3: Generate reviewable tasks

取得核准後，依 `execution-contract.md` 產生 OpenSpec `tasks.md`。只把
`adapted` 轉成 tasks；skip register 不得變成自動 mutation。

**完成條件：** tasks 可追溯到 plan，含 status/reason/evidence，且未修改
target files。

### Step 4: Dry-run, then apply

依 `execution-contract.md` 先產生並檢查 dry-run，再執行核准的 apply。Report
必須區分 applied、manual、failed；`.codex/skills` 唯讀時記錄 fallback。
Codex target 的 `adapted` agent mapping 可由 `agent_sync.py` 生成
`.codex/agents/*.toml` 草稿、mirror Markdown 與 `.codex/agents/sync-manifest.json`，
但仍需人工覆核 target role 指令。

**完成條件：** dry-run 與核准範圍一致，正式 report 不把 partial apply 宣稱
為完成。

### Step 5: Validation gate

依 `execution-contract.md` 執行 validation，檢查 config/frontmatter/TOML/JSON
loadability、platform smoke、hooks 與 multi-agent representative cases。
Codex validation 同時檢查 agent role 必要欄位、sync manifest、mirrored
references、coverage keywords 與 self-contained runtime contract。

- `PASS`: config/smoke 通過，沒有代表案例 `FAIL` 或 `SKIP`。
- `PARTIAL`: config/smoke 通過，但有明確 incompatible skip。
- `FAIL`: config/smoke 失敗，或代表案例失敗。

**完成條件：** 回報 Gate、failed/skipped 摘要、evidence 路徑與下一步。

## Output

- Preflight status 與 operation。
- Plan、核准後 OpenSpec tasks、dry-run/apply reports。
- 每個 mapping 的 decision contract。
- Validation Gate：`PASS`、`PARTIAL` 或 `FAIL`，含失敗與跳過摘要。

## Verification

- self-test 為 `failed: 0`。
- plan-only 沒有執行 tasks 或 apply。
- apply 前存在 dry-run report。
- 最終 Gate 與實際 failed/skipped 項目一致。

## References

- `references/runtime-entrypoints.md`: 依 harness resolve `SYNC_CLI`。
- `references/execution-contract.md`: command templates、report fields、exit semantics。
- `references/platform-mapping.md`: target capability、path mapping、status。
- `references/capability-sources.md`: Context7 與 official evidence。
- `references/risk-policy.md`: approval、incompatibility、validation gates。
- `references/improvement-todo.md`: 工具鏈回顧；`source-conflicts.json`: arbitration registry。
- `scripts/multi_ai_sync_lib/agent_sync.py`: Claude-to-Codex agent parity
  bundle 與 sync manifest helpers。
- `scripts/multi_ai_sync_lib/apply_sync.py`: deprecated v1 apply reference；
  active implementation is `apply_sync_v2.py`。

## Stop and report

以 `blocker / attempted / next step` 回報並停止：source 缺失、self-test 失敗、
target 無法安全判定、apply 沒有 writable route、source evidence 無法裁決，
或 dry-run/apply/validation 失敗。
