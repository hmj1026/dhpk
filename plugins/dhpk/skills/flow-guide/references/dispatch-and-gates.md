# Dispatch And Gates

workflow type 確定後，若需要 planning/implementation dispatch、post-implementation checklist、next command 或流程圖才讀取本檔。

沿用能說明範圍、outcomes、evidence、ownership、dependencies 與 gaps 的既有計畫。只有必要 planning outcome 仍缺失或 caller 明確要求 consult 時，才使用 root `Planning-Phase Agent` table 選擇適用的 planner。Task/file count 不會單獨要求 planner 或 worker。Read this file for implementation dispatch, reviewer batching, failure handling, next commands, and diagrams. Planning completion is an adequate reused plan, the specific missing outcome resolved, an explicit consult result, or a recorded `none` when no planning outcome is needed.

Claude 的預設 discovery artifact 是由 inventory 產生的實體化 `minimal`
profile；`full` 與 `compat-v1` 必須明確 opt-in。Codex MCP surface 已完成
retirement，現行 capability 預設走 current-model；`codex exec`、Codex CLI
worker/reasoner/bridge 與外部 `codex app-server` plugin 仍是明確選用的獨立
transport。

## Implementation-Phase Agent

SSOT 是 `@rules/execution-policy.md` 的 *Implementation dispatch*；本表只列典型調用：

| Workflow Type | 條件 | 調用（`orchestration_dispatch=on`） |
|---|---|---|
| Bug Investigation & Fix | 根因未知 | `subagent_type=dhpk:deep-reasoner`，產出 fix spec 交給下一列 |
| Feature / Bug Fix | 機械式、規格明確，且分派有助於 ownership、focus 或 concurrency | shared selector 解出的 `dhpk:fast-worker` / `dhpk:codex-fast-worker` / `dhpk:agy-fast-worker` |
| Feature / Bug Fix | caller 明確要求獨立第二視角或自足規格任務 | `subagent_type=dhpk:dhpk-codex-bridge`，一次性 CLI `codex exec`、輸出隔離、原文轉述；不得透過已退休的 `--codex` flag 隱式啟用 |
| Feature / Bug Fix | scope、ownership 與所需 verification 已明確，且 coordination need 低 | 無，inline；file count 不單獨決定 |
| Lightweight Maintenance | — | 無，inline patch |

禁止用 `general-purpose` 做實作 dispatch。`orchestration_dispatch=off` 時仍在
本技能選定的 Feature 或 Bug branch 內直接實作，並保留相同的 RED 與驗證，
並建議派遣 reviewer。

## Post-Implementation Agent Gates

回覆必須列出 `@rules/execution-policy.md` → *Post-implementation agent gate (SSOT)* 定義的 implementation specialist 與建議派遣的 reviewer。每個 implementation wave 的適用 reviewer 合併成一批 parallel batch；reviewer 為建議性質，非強制 gate；`tdd-guide` 與 `e2e-runner` 不是 post-edit reviewer。

Reviewer 有 findings 時：合併成一份 fix-spec；CRITICAL 須在回報完成前修正；依 ownership、coupling、context locality、verification needs 與 coordination benefit 選擇 inline 或 selector-resolved fast worker；TDD/E2E 修正回到原 specialist 的驗證命令。

## Next Commands By Workflow

| Workflow Type | Planning | Next Command | Outcomes to carry |
|---|---|---|---|
| Bug Investigation & Fix（根因未知且無適用診斷 evidence） | 只追查會改變修復路徑的根因缺口 | 若需要追蹤規格則 `/opsx:new`；否則採用充分的 issue / report / plan | 症狀、root cause、影響範圍與 regression / verification gaps |
| Feature Delivery（跨模組且尚未決定邊界） | 取得必要的 architecture / dependency outcome | 若需要追蹤規格則 `/opsx:new`；否則採用已批准 plan | 範圍、行為、依賴與驗收 outcomes |
| Feature Delivery（計畫與決策已充分） | 沿用已確認 evidence；只補必要缺口 | `/opsx:apply` 或 `$flow-drive`，依選定 owner | 已確認的 plan、acceptance 與必要 verification |
| Lightweight Maintenance | 不需額外 planning，除非發現會影響修改的未知項 | Read → Edit | targeted verification 與明確 skip 項目 |

若輸入含有已退休的 `--codex`，依 [codex-mode](codex-mode.md) 回報
`DEPRECATED_CODEX_FLAG` 並停止，不得把它轉譯成 `codex exec`、worker、
reasoner 或 app-server。新流程預設使用 Codex-free route；CLI 後端與第二
意見都必須由 caller 以明確選項指定。

## Workflow Diagrams

輸出 handoff 時附上對應流程圖：

**Feature Delivery:**
```
Requirements → [Reuse plan / OpenSpec when needed] → [TDD when required] → Implement → Review
                  │                       │       │          │
                  ▼                       ▼       ▼          ▼
             /opsx:new 或 brief plan  tdd-guide (conditional)  Edit   applicable reviewers
                                                                   (one parallel batch)
```

**Bug Investigation & Fix:**
```
Investigate → [Reuse diagnosis / OpenSpec when needed] → [TDD when required] → Implement → Review
     │            │                     │       │             │
     ▼            ▼                     ▼       ▼             ▼
code-trace /opsx:new 或 brief plan tdd-guide (conditional) Edit  applicable reviewers
                                                                   (one parallel batch)
```

**Lightweight Maintenance:**
```
Inspect → Patch → Review
   │        │        │
   ▼        ▼        ▼
  Read    Edit    recommended reviewer(s)
```
