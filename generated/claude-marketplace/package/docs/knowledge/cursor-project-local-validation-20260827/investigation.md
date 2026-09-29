# Cursor project-local validation false BLOCKED 調查紀錄（Issue #285）

## 問題描述

- **預期行為**：consumer 專案已由 `install-cursor-harness.sh` 產生有效的
  `.cursor/.dhpk-installed.json` schema-v3 receipt 與 `.cursor/` projection
  時，`multi_ai_sync validate --targets cursor` 應辨識 Cursor target，並將
  project-local sync 的結構證據與 Cursor-native package 證據分開呈現。
- **實際行為**：`/home/paul/projects/zdpos-217` 的 receipt 存在且為
  `state=current`、`plugin_version=0.48.3`，但 validation 回報 Cursor
  `BLOCKED`，因 shared configured-target resolver 看不到 Cursor marker。
- **影響範圍**：只影響以 consumer project root 執行、且使用 supported
  Cursor project-local sync 的 explicit Cursor validation；source checkout
  的 package route 仍可回報 Cursor package `PASS`。不影響既有 Cursor
  package validator、installer 或 launch-scoped runtime probe。
- **環境**：`develop`，dhpk HEAD
  `e2176d27751432c53df98af115e7a8f1633e5ec1`；consumer
  `/home/paul/projects/zdpos-217`；2026-08-27（Asia/Taipei）。

## 調查進度

- [x] Phase 1: 問題釐清
- [x] Phase 2: 證據蒐集
- [x] Phase 3: 根因分析
- [x] Phase 4: 修正方案設計
- [x] Phase 5: 知識文件化

## Phase 1 — 症狀與重現

Issue 原始 command：

```text
python3 -B skills/dhpk-cross-agent-sync/scripts/multi_ai_sync.py \
  --root /home/paul/projects/zdpos-217 validate \
  --targets cursor --format json
```

目前重跑結果：exit `2`；top-level `gate=BLOCKED`、`legacy_gate=FAIL`；
Claude row 為 `PASS`，Cursor row 為 `final_status=BLOCKED`、
`smoke_ok=false`、`hook_case_state=BLOCKED`、
`multi_agent_case_state=BLOCKED`，原因為：
`Cursor package markers are absent (explicitly requested)`。

同一 consumer 的 read-only filesystem evidence：

- `.cursor/.dhpk-installed.json` 存在。
- receipt `schema_version=3`、`state=current`、`plugin_version=0.48.3`、
  `mode=symlink`、`transaction.final=true`。
- receipt 的 managed entries 為 agents 31、commands 39、rules 5、skills 60、
  supporting assets 36。
- local Cursor packages 位於 `$HOME/.cursor/plugins/local/`，不位於
  consumer 的 `.cursor/plugins/local/`；這符合文件化的雙路徑 contract。

## Phase 2 — 證據蒐集

### 執行證據

| 證據 | 結果 |
|---|---|
| `resolve_configured_targets('/home/paul/projects/zdpos-217')` | `cursor=false`，雖然 receipt 存在 |
| `resolve_configured_targets('/home/paul/projects/dhpk')` | `cursor=true`，因 source package manifest 存在 |
| 對 consumer 直接呼叫 `validate_cursor(..., {'present': True, 'requested': True})` | `final_status=FAIL`、`config_load_ok=false`、`smoke_ok=false` |
| 對 dhpk source checkout 直接呼叫 `validate_cursor(..., {'present': True, 'requested': True})` | Cursor row `PASS`；package route 可找到 `plugins/dhpk-agent` 與 `plugins/dhpk-cursor` |
| package validators、installer test、launch probe（Issue #285） | 均 `PASS`；這些是獨立 package/runtime evidence |

### 程式與規格證據

- `skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/sources.py:18-39`
  的 Cursor configured marker 只檢查 package manifests：
  `plugins/dhpk-agent/plugin.json`、`.cursor-plugin/plugin.json`、以及
  `.cursor/plugins/local/*` manifests，未檢查 supported project-local
  receipt `.cursor/.dhpk-installed.json`。
- `skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/sources.py:42-66`
  將上述布林值交給 `resolve_target_membership()`；explicit `--targets cursor`
  在 `present=false` 時必然走 `BLOCKED`。
- `skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/validation.py:963-974`
  的 `_cursor_package_roots()` 只尋找 source/plugin package roots，不尋找
  consumer `.cursor/skills`、`.cursor/agents`、`.cursor/rules` 或 receipt。
- `skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/validation.py:1022-1060`
  的 `validate_cursor()` 在 membership 通過後仍只用 package roots 設定
  `config_ok` 與 `smoke_ok`；因此單純把 receipt 加入 marker 仍會把本案例
  轉成 `FAIL`，不能只改一個 marker list。
- `skills/dhpk-cross-agent-sync/scripts/multi_ai_sync_lib/mapping.py:102-149`
  已將 Cursor target 定義為 `.cursor/skills`、`.cursor/commands`、
  `.cursor/agents`、`.cursor/rules` 與 `.cursor/hooks`，與 project-local
  installer 的輸出 surface 一致。
- `docs/platform-installation.md:471-567` 將 `.cursor/.dhpk-installed.json`
  定義為 supported project-local sync 的 schema-v3 receipt，並明確與
  `plugins/dhpk-cursor/` marketplace route 分離。
- `openspec/changes/archive/2026-08-16-add-cursor-project-local-harness/design.md`
  定義 `cursor-sync` 是獨立 surface，來源是 repo 內 `cursor/` projection，
  目的地是 consumer `.cursor/`，receipt 是 `.cursor/.dhpk-installed.json`。

## Phase 3 — 根因確認

### 資料流

```text
consumer .cursor/.dhpk-installed.json
  → resolve_configured_targets()
  → resolve_target_membership()
  → run_validation()
  → validate_cursor()
  → Cursor row / top-level gate
```

第一個 divergence 發生在 `resolve_configured_targets()`：project-local
receipt 是文件與 installer contract 的配置證據，但不在 resolver 的 Cursor
marker set，所以 `present=false`。這直接觸發
`validate_cursor()` 的 early return，根本尚未檢查 consumer projection。

第二個獨立 divergence 由最小 discriminating check 確認：將 membership
暫時設成 `present=true` 後，`validate_cursor()` 仍因 `_cursor_package_roots()`
不看 project-local `.cursor/` 而回報 `config_load_ok=false`、`smoke_ok=false`。
因此根因不是單一遺漏字串，而是 `cursor-sync` surface 已存在，卻仍沿用
只支援 `cursor-plugin`/Agent Plugin package 的 validator implementation。

**確認根因**：`multi_ai_sync` 的 configured-target resolver 與 Cursor
validator 沒有實作已文件化的 `cursor-sync` project-local receipt/projection
contract；它們只實作 package-root contract，造成 supported consumer route
被錯誤分類為 explicit-target `BLOCKED`（若繞過第一層則為 `FAIL`）。

## Phase 4 — 修正邊界

本次調查不修改 production code，也不把 package/runtime PASS 互相替代。
修正必須保留 `cursor-plugin` 與 `cursor-sync` 的獨立 ownership、native
capability 的 `SKIP_INCOMPATIBLE` 語意，以及 receipt 不等於 runtime proof
的既有規則。

## Phase 5 — 知識文件化

- 本文件保留 symptom-specific red loop、first divergence 與最小確認結果。
- 修正選項與唯一 handoff 見同目錄的 `solution-proposal.md`。
- 沒有資料表或跨層資料庫流，因此不新增 `related-tables.md`；現有
  `docs/platform-installation.md`、`openspec/specs/multi-ai-configured-platform-validation/spec.md`
  與 archived Cursor project-local design 是後續實作的規格來源。

## 阻礙與缺口

- [x] 已在真實 consumer root 重現 explicit Cursor `BLOCKED`。
- [x] 已確認 receipt 存在且 current，並與 package/runtime evidence 分離。
- [x] 已定位 resolver 與 validator 的兩個 divergence。
- [ ] 尚未實作修正或新增回歸測試；下一步是依方案 A 先寫 RED fixture。
- [ ] dhpk worktree 原有 `.gitignore` 修改屬既有 user WIP，本調查未修改。
