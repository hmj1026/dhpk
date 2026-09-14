# Flow Drive / Flow Guide 參數與 Reference Runtime 審計

日期：2026-09-11  
範圍：`skills/flow-drive`、`skills/flow-guide`、inventory、各平台 projection/compiler，以及相關測試與政策文件。  
方法：分開核對 canonical 宣告、inventory contract、可執行 helper、projection closure 與 isolated package smoke；不把 Markdown 或 generated metadata 當成 runtime wiring。

## 結論

目前狀態是「discovery/metadata 大致 PASS，standalone execution NOT READY」。

- `flow-drive` 的 syntax、inventory usage、政策文字都存在，但沒有自己的 invocation parser、argument validator 或 dispatch adapter；主要旗標靠模型讀政策後自行執行，屬 PARTIAL。
- `flow-guide` 的 route table、v3 result model、help/next helper 各自存在，但沒有統一 action runner；`rules`/`close` 依賴模型讀文件。
- source checkout 的 focused tests 全過，但獨立 package 的 helper 依賴 checkout 外 `scripts/lib/*`；Claude profile 只 materialize `SKILL.md`，AGY 只對 internal runtime skills 複製 scripts，造成 reference/script closure 不一致。
- `route --go` 有 correctness defect：availability 缺省為 `not-configured` 時仍可能回 `disposition=ready`，違反只 handoff 給 available implicit-eligible target 的宣告。

## 參數與 action 接線矩陣

### `flow-drive`

Canonical syntax 在 [`skills/flow-drive/SKILL.md`](../../skills/flow-drive/SKILL.md#L1-L7)；machine-readable usage 在 [`manifests/distribution-inventory.json`](../../manifests/distribution-inventory.json#L1403-L1505)。

| 參數 | 判定 | 證據與缺口 |
|---|---|---|
| `<confirmed-spec-or-change-id>` | PARTIAL | 宣告存在，但沒有 parser 驗證非空/格式，也沒有 resolver 證明 spec/OpenSpec artifact 與 acceptance boundary 存在。 |
| `--plan[=<model>:<effort>]` | PARTIAL | SKILL 宣告、政策要求 planner；沒有 parser、model/effort grammar、planner dispatch adapter 或 flag 行為測試。 |
| `--worker=<claude\|codex\|agy\|auto>` | PARTIAL | 政策與其他 runtime selector 存在；flow-drive 沒有把 flag 解析、傳入 selector、保存選擇與輸出 identity/evidence 的 seam。 |
| `--reasoner=<backend>:<model>:<effort>` | PARTIAL | 政策描述 reasoner selector；沒有三段 parser、allowlist、adapter 或 invalid-value contract test。 |
| `--architect` | PARTIAL | 有文字層 architecture boundary；沒有 flag → architect dispatch 或 receipt。 |
| `--no-architect` | PARTIAL | 沒有與 `--architect` 的互斥/precedence 定義與測試。 |
| `--codex` | PARTIAL | route parser 會 diagnostic，但直接 `$flow-drive … --codex` 沒有 flow-drive parser 保證 fail closed；inventory 仍列出此 retired option。 |
| `--cross-provider` | MISSING / contract drift | [`docs/basic-operations.md`](../../docs/basic-operations.md#L313-L331) 宣告此參數，但 canonical `argument-hint` 與 inventory syntax/options 沒有；selector/policy 有，public flow-drive contract 沒有。 |

`flow-drive` 目前只有 `SKILL.md` 與 Codex metadata，沒有 scripts、schema 或 references，因此不能在 package 內自行驗證 flags。現有 ownership test 把 routing implementation 放在 flow-guide，卻沒有提供 flow-drive 的替代 intake seam。

### `flow-guide`

Public contract 在 [`skills/flow-guide/SKILL.md`](../../skills/flow-guide/SKILL.md#L1-L7)；action criteria 與 references 在 [`SKILL.md`](../../skills/flow-guide/SKILL.md#L23-L137)。

| action/parameter | 判定 | 證據與缺口 |
|---|---|---|
| `help [skill]` | PARTIAL | `usage-card.js` 有 `--json/--root/--catalog/--inventory` parser；但以 [`../../../scripts/lib/skill-usage`](../../skills/flow-guide/scripts/usage-card.js#L8-L16) 為硬依賴，native/agent package 沒有該檔，isolated execution 會 `MODULE_NOT_FOUND`。 |
| `route [--go] [query]` | PARTIAL | route table、`pre-route.sh`、v3 schema/parser 存在；`route-result.js` 只有 module exports，沒有 CLI/action runner，repo production code 也沒有消費它。 |
| `route --go` | FAIL | [`computeAvailability()`](../../skills/flow-guide/scripts/route-result.js#L203-L216) 缺省回 `not-configured`，但 [`resolveDisposition()`](../../skills/flow-guide/scripts/route-result.js#L227-L235) 沒有 fail closed，可能回 `ready`；也沒有 handoff consumer。 |
| `rules [query]` | MISSING（standalone） | 只要求讀 `rules/execution-policy.md`，沒有 query selector/helper；native、agent、Claude profile package 不攜帶 root policy。 |
| `next [query]` | PARTIAL | `analyze.js` 可讀 git/worktree/review state；public query 沒傳入 analyzer，且硬依賴 repo-root `scripts/lib/utils.js` 與 `feature-resolver.js`。 |
| `close [query]` | PARTIAL | 有 checklist/reference，但沒有 parser、evidence collector 或 deterministic gate resolver，結果依賴模型推理。 |
| action exactly-one | PARTIAL | SKILL 要求 Choose exactly one action，但沒有 runtime parser 強制 action set、query scope 或 `--go` 只能套 route。 |

明確 stale reference：[`rules/execution-policy-kernel.md`](../../rules/execution-policy-kernel.md#L21-L27) 指向不存在的 `skills/flow-drive/scripts/route-result.js`；實際 router 在 `skills/flow-guide/scripts/route-result.js`。

## Projection / reference 現況

`skills/<name>` 是唯一可編輯的 authoring source（single source of truth, SSOT），`manifests/distribution-inventory.json` 管理 identity/surface/profile；問題是不同 compiler 對 runtime dependency closure 的規則不一致。

| Surface | 現行投影 | 風險 |
|---|---|---|
| Codex native | 遞迴複製完整 skill tree | 帶出 flow-guide scripts/references，但 helper 仍 import package 外 `scripts/lib/skill-usage`。 |
| Agent plugin | physical skill tree，含 references/scripts | 同樣依賴 package 外 root helpers；沒有 declared dependency closure。 |
| AGY | selected skills 複製 references；scripts 只給 `internal_runtime_skills` | flow-guide 非 internal runtime，故 help/route/next scripts 不出包，SKILL 卻要求使用它們。 |
| Claude profile | capability bundle 只輸出 `skills/<name>/SKILL.md` | flow-guide refs/scripts 與 flow-drive policy/docs 缺席，profile 不能獨立解路徑。 |
| Cursor sync | symlink whole canonical dirs（`--copy` 可物理化） | checkout 尚在時可用；斷開 source 或 cache 後仍受外部 helper/policy 依賴。 |

`implementation-dispatch.md` 有跨平台 parity 檢查，但只確認 copy bytes 一致，沒有確認其指向的 policy/runtime helper 存在；reference parity PASS 不等於 closure PASS。`projects-index.md` 的 generic → project override fallback 則是合理設計，應保留。

## 建議的單一來源 + standalone 架構

「專屬內容只有一份」應定義為一份可編輯 authoring SSOT，加上 N 份唯讀、可重建、digest-bound 的 distribution projection；離線、可搬移的獨立 plugin 與所有安裝位置共用同一 physical file 不可能同時成立。

### Canonical layout

```text
skills/flow-guide/
  SKILL.md
  skill-package.json          # dhpk.skill-package.v1
  references/                  # workflow policy/detail 的唯一 authoring SSOT
  scripts/
    action-runner.js           # help/route/rules/next/close 統一入口
    _lib/                      # flow-guide 最小 runtime helper
skills/flow-drive/
  SKILL.md
  skill-package.json           # requires: flow-guide，宣告 option schema
rules/execution-policy.md      # generated thin adapter/pointer，不是第二份 normative copy
manifests/distribution-inventory.json
```

先把 normative workflow policy 移到 flow-guide references（或明確 versioned `workflow-kernel` package），root rule 改成 generated adapter；這是 dependency-direction 變更，應先寫 ADR（architecture decision record）。若未來有第三個以上 workflow skill 共用 kernel，再抽 `packages/workflow-core/`，目前先採較小改動方案避免 premature abstraction。

每個 `skill-package.json` 建議記錄：`capabilityVersion`、`generatorVersion`、`entryDigest`、`resources[]`（path/kind/digest/required）、`requires[]`（id/semver/closureDigest）與 `fallback[]`。所有 compiler 共用 `projectSkillClosure()`，不能再由平台自行決定是否複製 scripts。

### Deterministic fallback priority

1. package-local、manifest 宣告且 digest 驗證通過的 resource。
2. 同 package 的 declared dependency closure，且 closure digest 相符。
3. receipt-owned project-local projection（symlink/copy），source root、commit/tree、digest 必須相符。
4. 只有明確 development mode 才能用 canonical checkout root（`DHPK_SOURCE_ROOT` + marker + commit/tree verification）；禁止 ambient upward search。
5. 找不到時回 `BLOCKED_RESOURCE_MISSING` / `NOT_AVAILABLE`；不可靜默讀 sibling、home cache 或網路。GitHub URL 只能作文件連結。

### Migration / verification phases

1. 先加 package manifest、closure compiler、isolated-closure validator；先把目前 Claude/AGY/native 缺口變成可重現 FAIL。
2. 將 `skill-usage`、`utils`、`feature-resolver`、file-classification 等 flow-guide 必需 helper 收斂到 flow-guide `scripts/_lib/` 或 versioned workflow runtime，移除 `../../../scripts/lib` 與 upward walk-up。
3. 加入統一 action runner：exactly-one action；`--go` 只允許 route；`not-configured` 必須 BLOCKED/UNAVAILABLE；輸出 typed report。
4. 為 flow-drive 建 immutable invocation context/schema，解析 spec id 與 flags，再交給既有 selector/policy/architect/reasoner adapter；補 happy/invalid/conflict/retired tests。
5. 所有 surface 重新 materialize，receipt 記錄 `closureDigest` 與 per-file digests；在 source checkout 不可用的隔離副本執行五個 flow-guide actions 與 flow-drive option resolution。
6. 舊 receipt 保留一個 release 的讀取相容；之後 mixed closure digest fail closed；consumer migration 使用 receipt-aware `--migrate --update`。

## 本次驗證

```text
flow-guide-ownership: 9/9
flow-guide-usage-help: 6/6
reference-route-policy: 7/7
reference-integrity: 8/8
validate-commands: 12/12
workflow-docs: 3/3
codex-runtime-contract: 19/19
documentation-platform-parity: 9/9
gen-skill-usage --check: PASS (13 entries)
```

直接執行 copied/native `usage-card.js` 觀察到 `MODULE_NOT_FOUND`；`route-result.js` 直接以 Node 執行沒有 CLI output；isolated Claude profile 缺少 flow-guide references/scripts。這些是 standalone runtime evidence，沒有被 source-tree focused tests 覆蓋。

本報告只新增研究紀錄，沒有修改技能、inventory、generator 或平台 package；下一步應由 maintainer 先確認 ADR 與 closure boundary，再進 implementation plan。
