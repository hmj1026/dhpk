# Cursor project-local validation 修正方案（Issue #285）

## 決策摘要

建議把 `cursor-sync` project-local surface 納入 `multi_ai_sync` 的既有
configured-target 與 Cursor validator，但保留它與 `cursor-plugin` package
route 的獨立證據邊界。修正先以 consumer fixture 寫出 RED regression test，
再以最小共用 resolver/validator 分支實作；receipt、projection、package 與
runtime 不互相代替。

本案根因已確認，因此依 `rules/execution-policy.md` 的 **Bug Fix（known
root cause）** 路由執行 `inspect → TDD RED → patch → focused verify`，不另開
OpenSpec change。這份文件是實作 handoff，不是 production code 變更授權。

## 不變條件與驗收邊界

- `cursor-plugin` package route（`plugins/dhpk-agent`、`plugins/dhpk-cursor`
  或其受支援 package roots）維持既有驗證結果與 ownership。
- `cursor-sync` project-local route 以 consumer root 的
  `.cursor/.dhpk-installed.json` schema-v3 receipt 搭配 `.cursor/` projection
  作為結構證據；`state=current`、版本與 managed entries 必須通過明確檢查。
- package/structure evidence 與 launch/runtime evidence 分列；receipt 不得
  被升級成 runtime PASS。
- 明確要求但沒有任何 Cursor surface 仍為 `BLOCKED`；未要求且沒有 marker
  仍為 `NOT_CONFIGURED`。
- malformed、stale、版本不相容或 receipt/projection 不一致必須是
  `FAIL`（不能以 `SKIP_INCOMPATIBLE` 掩蓋）。
- native hook/agent 等能力仍依 capability matrix 回報
  `SKIP_INCOMPATIBLE`，並保留 capability、reason、fallback。
- source checkout 的 package validation 與 consumer project-local validation
  必須能在報告中辨識，不可用 source package PASS 代替 consumer gate。

## 方案比較

### 方案 A — 共用 Cursor surface resolver/validator（建議）

在 `multi_ai_sync_lib` 增加 bounded 的 project-local receipt/projection
判定，讓 `resolve_configured_targets()` 把有效 receipt 視為 Cursor
configured marker；`validate_cursor()` 依 surface 分支驗證 package roots 或
consumer `.cursor/` projection，並在結果中保留兩者的獨立 evidence。可抽出
小型 helper 供兩處共用，避免只新增 marker 而把目前案例從 `BLOCKED` 變成
`FAIL`。

優點是修正現有資料流的兩個 divergence、維持現有 CLI 與 gate semantics，且
可用 fixture 覆蓋 package 與 project-local 兩條路由。風險是需要精確定義
receipt schema 與 projection completeness，並同步任何由 canonical source
生成的 mirror/projection；可用 malformed/stale/incomplete fixtures 限縮風險。

### 方案 B — 建立獨立 cursor-sync validator，再由 `multi_ai_sync` bridge

把 receipt/schema/projection 驗證放在既有 Cursor sync/release gate helper，
`multi_ai_sync` 只消費其結構化結果。

優點是可重用既有 installer/release gate 邏輯；缺點是跨 Python/JavaScript
邊界與 exit/status mapping 較大，容易再次混淆 source package、consumer
structure、runtime 三種證據，回歸範圍也較廣。除非方案 A 發現已有穩定的跨語言
contract，否則不作第一個修補波次。

### 方案 C — 將 `multi_ai_sync --root` 限定為 package-only，文件化現況

不修改 validator，只說明 consumer project-local receipt 必須改用其他
command 驗證。

此方案與 `mapping.py`、`docs/platform-installation.md`、inventory 的
`cursor-sync` surface 及 archived harness design 不一致，會保留一個已支援
route 被 explicit validation 錯誤阻擋的缺陷，因此拒絕。

## 建議實作切片與測試

唯一下一個動作：在 `tests/multi-ai-sync-cursor-capabilities.test.js`
（必要時新增同一 test family 的 fixture helper）先加入 consumer project-local
receipt 的 RED fixture，確認目前 command/validator 會失敗，然後才修改
`skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/sources.py`、
`validation.py` 及其必要的 canonical/generated projection。

RED/GREEN 應至少覆蓋：

1. current schema-v3 receipt + 完整 `.cursor/` projection：Cursor configured，
   結構檢查 `PASS`，不要求 consumer-local package root。
2. explicit `--targets cursor` 且 receipt/projection 缺失：仍為 `BLOCKED`。
3. malformed、stale 或 projection 不一致：為 `FAIL`，並提供 bounded reason。
4. source/package route：既有 package fixture 結果不變。
5. native 不相容 capability：仍為 policy-backed `SKIP_INCOMPATIBLE`。
6. consumer receipt/structure PASS 不會把 launch/runtime row 升級為 PASS。

驗證順序：先跑 targeted Node/Python tests 與原始 red command，再跑相關
`multi-ai-sync` contract/parity tests、`git diff --check`；任何 source/generated
projection 變更都要再做 scope review。若測試只能證明結構，報告必須明確標記
runtime 為 `NOT_RUN` 或原有獨立結果。

## 回滾與風險控制

- 變更限定在 resolver、Cursor validation、對應測試與必要的生成 projection；
  不碰 consumer receipt、不改 package installer 或 launch probe。
- 若 receipt schema/managed-entry contract 無法在現有規格中無歧義判定，停止
  patch，保留 `needs-info` 並補要求；不可用寬鬆 marker 讓 gate 假綠。
- 若修正造成既有 package route 回歸，回退新增的 project-local branch，保留
  RED fixture 與本調查紀錄，重新縮小介面後再送第二波。
- 實作完成後才進入 project policy 的 review、archive/changelog、Draft PR 與
  CI terminal watch；本 triage handoff 階段不 commit、不開 PR。

## Handoff

- Issue：[#285](https://github.com/hmj1026/dhpk/issues/285)
- 調查紀錄：[investigation.md](./investigation.md)
- 實作入口：`/implement`（known-root-cause bug，先 TDD RED）
- 目前決策：`Decision: CLEAR`；實作選擇已定，尚未授權本文件階段修改
  production code。
