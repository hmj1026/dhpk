# GitHub Issues 2026-07-28 調查紀錄

## 問題描述

- **預期行為**：逐項檢視目前 open GitHub issues；已由目前程式與測試證實解決的 issue 關閉；仍存在的缺陷保留開啟並分群進入 OpenSpec change。
- **實際行為**：目前 open issues 為 #108、#107、#106、#93、#91、#90、#88、#87。四項已有現行規範與回歸測試證據；四項仍有靜態或發布面缺口。
- **環境**：`develop`、HEAD `3333af0`、2026-07-28；GitHub CLI 已登入。沙盒內 GitHub API 連線受限，使用核准的唯讀外部查詢取得 issue 清單，關閉操作另有明確授權。

## 調查進度

- [x] Phase 1: 問題釐清
- [x] Phase 2: 證據蒐集
- [x] Phase 3: 根因分析
- [x] Phase 4: 修正方案設計
- [x] Phase 5: 知識文件化

## 已解決並關閉

| Issue | 判定 | 證據 |
|---|---|---|
| #87 | 已解決 | `node tests/invocation-precedence.test.js`：10/10；現行 routing 明確區分 `/opsx:*` human command 與 `openspec-*` Skill ID。 |
| #90 | 已解決 | `node tests/parallel-dispatch-contract.test.js`：7/7；global/shared validator、ratchet 與 path-scoped verification contract 已明確化。 |
| #91 | 已解決 | `node tests/parallel-dispatch-scope.test.js`：3/3；assigned scope 與禁止 sibling cleanup 的 contract 已存在。 |
| #93 | 已解決 | `rules/execution-policy.md` 將 Judgment-Dense Standardizable Batch 列為預設 fast-worker route；同一組 parallel contract tests 通過。 |

## 仍存在與根因

### #106

`skills/opsx-apply-goal/references/goal-templates.md:50-54,71-74` 只嘗試
`CLAUDE_PLUGIN_ROOT` 與已安裝 cache，找不到時直接輸出
`POLICY-UNRESOLVED`；沒有固定的 `./rules/execution-policy.md` fallback。
目前機器因 cache 存在而未現場重現，但 self-hosted `--plugin-dir` 且無 cache
的靜態路徑仍未覆蓋，故不能視為已修復。

### #107

`agents/codex-fast-worker.md` 與 `agents/agy-fast-worker.md` 具備
"never ... fall back to editing the files yourself" 的一般規則，但沒有
mid-batch timeout、remaining-file re-dispatch、第二次 timeout 的 PARTIAL／BLOCKED
決策。根因是 timeout 被當成一般 backend failure，沒有保存 partial completion
ledger。

### #108

`agents/doc-reviewer.md` 與 `agents/code-reviewer.md` 只引用 shared reviewer
contract，沒有要求掃描同一批次中語意耦合的 spec/design 文件是否重複同一 finding。
`goal-templates.md` 的 `POLICY-UNRESOLVED` fallback 也沒有明確要求每次 reviewer
dispatch（含 confirm-only）寫入 canonical artifact path。根因是 fallback 只保留
短版 gate，未保留最高價值的 artifact-backed review obligation。

### #88

正式 `.codex-plugin/plugin.json` 指向 `./codex/skills/`，其中有 15 個 symlink；
`plugins/dhpk/.codex-plugin/plugin.json` 指向 `../../codex/skills/`。目前的
`codex-native-experimental-gate` 以測試刻意證明兩個正式 manifest 仍 fail，只有
暫存 physical candidate 通過 clean-install smoke。根因是候選 package generator
尚未接到實際 publication artifact／retention policy。

## 驗證命令

- `node tests/invocation-precedence.test.js` → PASS 10/10
- `node tests/parallel-dispatch-contract.test.js` → PASS 7/7
- `node tests/parallel-dispatch-scope.test.js` → PASS 3/3
- `node tests/codex-native-package-validate.test.js` → PASS 4/4
- `node tests/gen-codex-native-package.test.js` → PASS 3/3
- `node tests/codex-native-experimental-gate.test.js` → PASS 3/3，並證明 #88 尚未關閉
- `node scripts/ci/validate-plugin.js` → PASS
- `node scripts/ci/catalog.js --check all` → PASS

## 阻礙與缺口

- [x] GitHub open issue 清單已取得。
- [x] 已解決 issue 已加證據留言並關閉。
- [ ] #106 的無 cache live reproduction 仍需在乾淨 `--plugin-dir` 環境補跑；此缺口不阻擋規格建立，因靜態 fallback 缺失已確認。
- [ ] #88 的 Codex marketplace 實際發布／consumer cache proof 必須在實作 change 完成後取得；目前僅有 staged candidate proof。
