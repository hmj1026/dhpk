# Dispatch And Gates

workflow type 確定後，若需要 planning/implementation dispatch、post-implementation checklist、next command 或流程圖才讀取本檔。

Planning follows the root `Planning-Phase Agent` table. Read this file for implementation dispatch, reviewer batching, failure handling, next commands, and diagrams. The planning completion criterion is: required dispatch output is recorded, or the branch is explicitly marked `none`.

## Implementation-Phase Agent

SSOT 是 `@rules/execution-policy.md` 的 *Implementation dispatch*；本表只列典型調用：

| Workflow Type | 條件 | 調用（`orchestration_dispatch=on`） |
|---|---|---|
| Bug Investigation & Fix | 根因未知 | `subagent_type=dhpk:deep-reasoner`，產出 fix spec 交給下一列 |
| Feature / Bug Fix | 機械式、規格明確 | shared selector 解出的 `dhpk:fast-worker` / `dhpk:codex-fast-worker` / `dhpk:agy-fast-worker` |
| Feature / Bug Fix | 獨立第二視角或 CODEX=on 的自足規格任務 | `subagent_type=dhpk:codex-bridge`，一次性 `codex exec`、輸出隔離、原文轉述 |
| Feature / Bug Fix | 約 ≤2 檔且無歧義 | 無，inline |
| Lightweight Maintenance | — | 無，inline patch |

禁止用 `general-purpose` 做實作 dispatch。`orchestration_dispatch=off` 時回到 `dhpk:bug-fix` / `dhpk:feature-dev` 內直接實作。

## Post-Implementation Agent Gates

回覆必須列出 `@rules/execution-policy.md` → *Post-implementation agent gate (SSOT)* 定義的 implementation specialist 與 sentinel reviewer。每個 implementation wave 的適用 reviewer 合併成一批 parallel batch；`tdd-guide` 與 `e2e-runner` 不是無條件 post-edit gate。

Gate 失敗時：findings 合併成一份 fix-spec；超過 inline bound 才交給 selector-resolved fast worker；已知 findings 只做一次 confirm-only 複查；TDD/E2E 修正回到原 specialist 的驗證命令。

## Next Commands By Workflow

| Workflow Type | Planning | Next Command | Artifacts Required |
|---|---|---|---|
| Bug Investigation & Fix（根因未知） | `bug-investigation` skill | `/opsx:new` 或 brief plan | work-item + legacy-ref + RED |
| Feature Delivery（跨模組） | `dhpk:architect` | `/opsx:new` 或 brief plan | profile + work-item + legacy-ref + RED |
| Feature Delivery（一般） | — | `/opsx:new` 或 brief plan | profile + work-item + legacy-ref + RED |
| Lightweight Maintenance | — | Read → Edit | targeted verification only |

若使用 `--codex`，依 [codex-mode](codex-mode.md) 替換 planning/review 命令並在下游命令保留 `--codex`。

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
