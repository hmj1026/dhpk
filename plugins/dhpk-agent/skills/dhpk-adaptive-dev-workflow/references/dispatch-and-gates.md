# Dispatch And Gates

workflow type 確定後，若需要 planning/implementation dispatch、post-implementation checklist、next command 或流程圖才讀取本檔。

Planning follows the root `Planning-Phase Agent` table. Read this file for implementation dispatch, reviewer batching, failure handling, next commands, and diagrams. The planning completion criterion is: required dispatch output is recorded, or the branch is explicitly marked `none`.

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
| Feature / Bug Fix | 機械式、規格明確 | shared selector 解出的 `dhpk:fast-worker` / `dhpk:codex-fast-worker` / `dhpk:agy-fast-worker` |
| Feature / Bug Fix | caller 明確要求獨立第二視角或自足規格任務 | `subagent_type=dhpk:dhpk-codex-bridge`，一次性 CLI `codex exec`、輸出隔離、原文轉述；不得透過已退休的 `--codex` flag 隱式啟用 |
| Feature / Bug Fix | 約 ≤2 檔且無歧義 | 無，inline |
| Lightweight Maintenance | — | 無，inline patch |

禁止用 `general-purpose` 做實作 dispatch。`orchestration_dispatch=off` 時仍在
本技能選定的 Feature 或 Bug branch 內直接實作，並保留相同的 RED、驗證與
review gate。

## Post-Implementation Agent Gates

回覆必須列出 `@rules/execution-policy.md` → *Post-implementation agent gate (SSOT)* 定義的 implementation specialist 與 sentinel reviewer。每個 implementation wave 的適用 reviewer 合併成一批 parallel batch；`tdd-guide` 與 `e2e-runner` 不是無條件 post-edit gate。

Gate 失敗時：findings 合併成一份 fix-spec；超過 inline bound 才交給 selector-resolved fast worker；已知 findings 只做一次 confirm-only 複查；TDD/E2E 修正回到原 specialist 的驗證命令。

## Next Commands By Workflow

| Workflow Type | Planning | Next Command | Artifacts Required |
|---|---|---|---|
| Bug Investigation & Fix（根因未知） | `dhpk-root-cause-investigation` skill | `/opsx:new` 或 brief plan | work-item + legacy-ref + RED |
| Feature Delivery（跨模組） | `dhpk:architect` | `/opsx:new` 或 brief plan | profile + work-item + legacy-ref + RED |
| Feature Delivery（一般） | — | `/opsx:new` 或 brief plan | profile + work-item + legacy-ref + RED |
| Lightweight Maintenance | — | Read → Edit | targeted verification only |

若輸入含有已退休的 `--codex`，依 [codex-mode](https://github.com/hmj1026/dhpk/blob/main/skills/dhpk-adaptive-dev-workflow/references/codex-mode.md) 回報
`DEPRECATED_CODEX_FLAG` 並停止，不得把它轉譯成 `codex exec`、worker、
reasoner 或 app-server。新流程預設使用 Codex-free route；CLI 後端與第二
意見都必須由 caller 以明確選項指定。

## Workflow Diagrams

輸出 handoff 時附上對應流程圖：

**Feature Delivery:**
```
Requirements → OpenSpec or Brief Plan → [TDD when required] → Implement → Review
                  │                       │       │          │
                  ▼                       ▼       ▼          ▼
             /opsx:new 或 brief plan  tdd-guide (conditional)  Edit   applicable reviewers
                                                                   (one parallel batch)
```

**Bug Investigation & Fix:**
```
Investigate → OpenSpec or Brief Plan → [TDD when required] → Implement → Review
     │            │                     │       │             │
     ▼            ▼                     ▼       ▼             ▼
bug-investigation /opsx:new 或 brief plan tdd-guide (conditional) Edit  applicable reviewers
                                                                   (one parallel batch)
```

**Lightweight Maintenance:**
```
Inspect → Patch → Review
   │        │        │
   ▼        ▼        ▼
  Read    Edit    applicable sentinel reviewer(s)
```
